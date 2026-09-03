import * as core from '@actions/core'
import * as github from '@actions/github'
import { minimatch } from 'minimatch'
import { generateMermaid, generateMermaidDiff, generateMermaidExecution } from 'sfn-diagram'
import type { AslDefinition } from 'sfn-diagram'
import { fetchExecutionForOverlay } from './sfn.js'
import type { ExecutionMode } from './sfn.js'

const COMMENT_PREFIX = '<!-- sfn-diagram-action:'
const EXECUTION_MODES: ExecutionMode[] = ['off', 'latest', 'latest-failed']

/** An added/modified ASL file whose after-state can be overlaid with an execution. */
interface OverlayCandidate {
    afterAsl: AslDefinition
    filename: string
}

interface BuildExecutionOverlayParams {
    candidates: OverlayCandidate[]
    mode: Exclude<ExecutionMode, 'off'>
    region?: string
    stateMachineArn: string
}

interface GetFileAtRefParams {
    octokit: ReturnType<typeof github.getOctokit>
    owner: string
    path: string
    ref: string
    repo: string
}

export function isAslDefinition(obj: unknown): obj is AslDefinition {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'StartAt' in obj &&
        'States' in obj &&
        typeof (obj as Record<string, unknown>).StartAt === 'string'
    )
}

export function parseAsl(content: string): AslDefinition | null {
    try {
        const parsed: unknown = JSON.parse(content)
        return isAslDefinition(parsed) ? parsed : null
    } catch {
        return null
    }
}

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

export function matchesPatterns(filepath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => minimatch(filepath, pattern, { matchBase: true }))
}

export function formatStateList(names: string[]): string {
    return names.map((name) => `\`${name}\``).join(', ')
}

/**
 * Builds the execution-overlay comment section, or returns `null` (logging why)
 * when it can't. Requires exactly one changed definition so the single
 * `state-machine-arn` maps unambiguously to a diagram.
 */
async function buildExecutionOverlaySection(
    params: BuildExecutionOverlayParams,
): Promise<string | null> {
    const { candidates, mode, region, stateMachineArn } = params

    if (candidates.length === 0) {
        core.info('Execution overlay: no added/modified ASL definition to overlay — skipping')
        return null
    }
    if (candidates.length > 1) {
        core.warning(
            'Execution overlay: multiple ASL files changed; a single state-machine-arn cannot ' +
                'be mapped to them — skipping. Limit the PR to one state machine or unset execution-mode.',
        )
        return null
    }

    const [candidate] = candidates

    let execution
    try {
        execution = await fetchExecutionForOverlay({ mode, region, stateMachineArn })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        core.warning(`Execution overlay: failed to fetch execution history — ${message}`)
        return null
    }

    if (!execution) {
        core.info(
            `Execution overlay: no ${mode === 'latest-failed' ? 'failed ' : ''}execution found for ${stateMachineArn}`,
        )
        return null
    }

    const { code, metadata } = generateMermaidExecution({
        aslDefinition: candidate.afterAsl,
        history: execution.events,
    })

    const summary = [
        `✅ ${metadata.succeeded.length}`,
        `❌ ${metadata.failed.length}`,
        `🟠 ${metadata.caught.length}`,
        `⚪ ${metadata.notReached.length}`,
    ].join(' · ')

    let section = `### 🎬 Execution overlay — \`${candidate.filename}\`\n\n`
    section += `> Most recent${mode === 'latest-failed' ? ' **failed**' : ''} execution: \`${execution.executionArn}\`\n`
    section += `> Status: **${execution.status ?? metadata.executionStatus}** — ${summary} (succeeded · failed · caught · not reached)\n\n`
    section += `<details open>\n<summary>📊 Execution diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`

    return section
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

    const sections: string[] = []
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

        const beforeAsl = beforeContent ? parseAsl(beforeContent) : null
        const afterAsl = afterContent ? parseAsl(afterContent) : null

        if (!beforeAsl && !afterAsl) {
            core.info(`Skipping ${filename}: not a valid ASL definition`)
            continue
        }

        if (afterAsl) {
            overlayCandidates.push({ afterAsl, filename })
        }

        let section = `### \`${filename}\`\n\n`

        if (!afterAsl && beforeAsl) {
            section += '> ⚠️ **File deleted**\n\n'
            const { code } = generateMermaid({ aslDefinition: beforeAsl })
            section += `<details>\n<summary>📊 Before diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`
        } else if (afterAsl && !beforeAsl) {
            section += '> ✨ **New file**\n\n'
            const { code } = generateMermaid({ aslDefinition: afterAsl })
            section += `<details>\n<summary>📊 Diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`
        } else if (afterAsl && beforeAsl) {
            const diff = generateMermaidDiff({ after: afterAsl, before: beforeAsl })
            const { added, modified, removed, unchanged } = diff.metadata

            const rows: string[] = []
            if (added.length > 0) rows.push(`| ➕ Added | ${formatStateList(added)} |`)
            if (modified.length > 0) rows.push(`| ✏️ Modified | ${formatStateList(modified)} |`)
            if (removed.length > 0) rows.push(`| ❌ Removed | ${formatStateList(removed)} |`)
            if (rows.length === 0) {
                rows.push(`| ✅ No changes | ${unchanged.length} state${unchanged.length !== 1 ? 's' : ''} unchanged |`)
            }

            section += `| | States |\n|---|---|\n${rows.join('\n')}\n\n`

            // Diff diagram: added states are green, modified yellow, removed red.
            // Expanded by default since the highlighted change is the point.
            section += `<details open>\n<summary>📊 Diagram (changes highlighted)</summary>\n\n\`\`\`mermaid\n${diff.code}\n\`\`\`\n\n</details>\n`
        }

        sections.push(section)
    }

    if (executionMode !== 'off') {
        const overlaySection = await buildExecutionOverlaySection({
            candidates: overlayCandidates,
            mode: executionMode,
            region: awsRegion,
            stateMachineArn,
        })
        if (overlaySection) {
            sections.push(overlaySection)
        }
    }

    if (sections.length === 0) {
        core.info('No valid ASL definitions found in changed files')
        return
    }

    const marker = `${COMMENT_PREFIX}${commentTag}-->`
    const body = [
        marker,
        '## 🔀 Step Functions Diagram Changes',
        '',
        sections.join('\n---\n\n'),
        '',
        '*Diagrams by [sfn-diagram](https://sfn.yusufaf.dev) — ' +
            '[try the playground](https://sfn.yusufaf.dev/playground/) · ' +
            '[source](https://github.com/yusufaf/sfn-diagram)*',
    ].join('\n')

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
