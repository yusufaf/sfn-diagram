import * as core from '@actions/core'
import * as github from '@actions/github'
import {
    assembleCommentBody,
    buildAslFileSection,
    buildExecutionOverlaySection,
    formatStateList,
    isAslDefinition,
    matchesPatterns,
    parseAslJson,
    renderAslFileSection,
} from 'sfn-diagram/ci'
import type { AslFileSection, OverlayCandidate } from 'sfn-diagram/ci'
import type { AslDefinition } from 'sfn-diagram'
import { fetchExecutionForOverlay } from './sfn.js'
import type { ExecutionMode } from './sfn.js'

const COMMENT_PREFIX = '<!-- sfn-diagram-action:'
const EXECUTION_MODES: ExecutionMode[] = ['off', 'latest', 'latest-failed']

interface GetFileAtRefParams {
    octokit: ReturnType<typeof github.getOctokit>
    owner: string
    path: string
    ref: string
    repo: string
}

export { formatStateList, isAslDefinition, matchesPatterns }
export const parseAsl = parseAslJson

async function getFileAtRef(params: GetFileAtRefParams): Promise<string | null> {
    const { octokit, owner, path, ref, repo } = params
    try {
        const response = await octokit.rest.repos.getContent({ owner, path, ref, repo })
        const data = response.data
        if (Array.isArray(data) || data.type !== 'file') return null
        return Buffer.from(data.content, 'base64').toString('utf-8')
    } catch {
        return null
    }
}

export async function run(): Promise<void> {
    const token = core.getInput('github-token', { required: true })
    const aslGlobRaw = core.getInput('asl-glob') || '**/*.asl.json,**/*.asl'
    const commentTag = core.getInput('comment-tag') || 'sfn-diagram-preview'

    const executionModeRaw = (core.getInput('execution-mode') || 'off').trim()
    const stateMachineArn = core.getInput('state-machine-arn').trim()
    const awsRegion = core.getInput('aws-region').trim() || undefined

    let executionMode: ExecutionMode = 'off'
    if (EXECUTION_MODES.includes(executionModeRaw as ExecutionMode)) {
        executionMode = executionModeRaw as ExecutionMode
    } else {
        core.warning(`Unknown execution-mode "${executionModeRaw}"; expected one of ${EXECUTION_MODES.join(', ')}. Disabling overlay.`)
    }
    if (executionMode !== 'off' && !stateMachineArn) {
        core.warning('execution-mode is set but state-machine-arn is empty; skipping the execution overlay.')
        executionMode = 'off'
    }

    const patterns = aslGlobRaw.split(',').map((pattern) => pattern.trim())
    const { context } = github

    if (!context.payload.pull_request) {
        core.info('Not a pull_request event — skipping')
        return
    }

    const pr = context.payload.pull_request as {
        base: { sha: string }
        head: { sha: string }
        number: number
    }

    const owner = context.repo.owner
    const repo = context.repo.repo
    const pullNumber = pr.number
    const baseSha = pr.base.sha
    const headSha = pr.head.sha

    const octokit = github.getOctokit(token)

    const { data: changedFiles } = await octokit.rest.pulls.listFiles({
        owner,
        pull_number: pullNumber,
        repo,
    })

    const aslFiles = changedFiles.filter(
        (file) => file.status !== 'unchanged' && matchesPatterns(file.filename, patterns),
    )

    if (aslFiles.length === 0) {
        core.info('No ASL files changed in this PR')
        return
    }

    const sections: AslFileSection[] = []
    const overlayCandidates: OverlayCandidate[] = []

    for (const file of aslFiles) {
        const { filename, status } = file

        const beforeContent =
            status === 'added'
                ? null
                : await getFileAtRef({ octokit, owner, path: filename, ref: baseSha, repo })

        const afterContent =
            status === 'removed'
                ? null
                : await getFileAtRef({ octokit, owner, path: filename, ref: headSha, repo })

        const beforeAsl: AslDefinition | null = beforeContent ? parseAslJson(beforeContent) : null
        const afterAsl: AslDefinition | null = afterContent ? parseAslJson(afterContent) : null

        if (!beforeAsl && !afterAsl) {
            core.info(`Skipping ${filename}: not a valid ASL definition`)
            continue
        }

        if (afterAsl) {
            overlayCandidates.push({ afterAsl, filename })
        }

        const section = buildAslFileSection({ afterAsl, beforeAsl, filename })
        if (section) sections.push(section)
    }

    const bodySections = sections.map((section) => renderAslFileSection(section))

    if (executionMode !== 'off') {
        const overlay = await buildExecutionOverlaySection({
            candidates: overlayCandidates,
            fetchExecution: fetchExecutionForOverlay,
            mode: executionMode,
            region: awsRegion,
            stateMachineArn,
        })
        if (overlay.log) {
            const logFn = overlay.log.level === 'warning' ? core.warning : core.info
            logFn(overlay.log.message)
        }
        if (overlay.section) {
            bodySections.push(overlay.section)
        }
    }

    if (bodySections.length === 0) {
        core.info('No valid ASL definitions found in changed files')
        return
    }

    const marker = `${COMMENT_PREFIX}${commentTag}-->`
    const body = assembleCommentBody({ marker, sections: bodySections })

    const { data: existingComments } = await octokit.rest.issues.listComments({
        issue_number: pullNumber,
        owner,
        repo,
    })

    const existing = existingComments.find((comment) => comment.body?.startsWith(marker))

    if (existing) {
        await octokit.rest.issues.updateComment({
            body,
            comment_id: existing.id,
            owner,
            repo,
        })
        core.info(`Updated existing PR comment #${existing.id}`)
    } else {
        await octokit.rest.issues.createComment({
            body,
            issue_number: pullNumber,
            owner,
            repo,
        })
        core.info('Created new PR comment')
    }
}
