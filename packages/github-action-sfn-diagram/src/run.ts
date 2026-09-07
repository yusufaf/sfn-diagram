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
    renderExecutionOverlaySection,
} from 'sfn-diagram/ci'
import type { AslFileSection, ExecutionOverlaySection, OverlayCandidate } from 'sfn-diagram/ci'
import type { AslDefinition } from 'sfn-diagram'
import { fetchExecutionForOverlay } from './sfn.js'
import type { ExecutionMode } from './sfn.js'

const COMMENT_PREFIX = '<!-- sfn-diagram-action:'
const EXECUTION_MODES: ExecutionMode[] = ['off', 'latest', 'latest-failed']

/**
 * GitHub rejects an issue/PR comment body longer than this with a raw 422.
 * Measured against the fully assembled body, so no safety margin is needed.
 */
const MAX_COMMENT_CHARS = 65_536

/** Shown in place of a dropped diagram, once inlining it would push the comment past GitHub's size limit. */
const DIAGRAM_TOO_LARGE_NOTE =
    "> 📎 **Diagram omitted** — inlining it would push this comment past GitHub's 65,536-character comment limit. " +
    'Shrink it with the `hide-catch` or `collapse` inputs, or open the file\'s diagram locally with the `sfn-diagram` CLI.'

/** Sentinel key for the execution-overlay renderable, distinguishable from a real filename. */
const EXECUTION_OVERLAY_KEY = '\u0000execution-overlay'

interface CommentRenderable {
    key: string
    mermaidLength: number
    render: (includeDiagram: boolean) => string
}

export interface BuildBoundedCommentBodyParams {
    marker: string
    /** Defaults to MAX_COMMENT_CHARS; overridable so tests can use a small budget. */
    maxChars?: number
    omissionNote?: string
    overlaySection: ExecutionOverlaySection | null
    sections: AslFileSection[]
}

export interface BoundedCommentBody {
    body: string
    /** How many whole file sections had to be dropped (headers and all). */
    droppedSections: number
    /** Filenames whose diagram was dropped, largest first. */
    omittedDiagrams: string[]
}

function assembleRenderables(params: {
    extraSection?: string
    marker: string
    omitted: Set<string>
    renderables: CommentRenderable[]
}): string {
    const { extraSection, marker, omitted, renderables } = params
    const sections = renderables.map((renderable) => renderable.render(!omitted.has(renderable.key)))
    if (extraSection) sections.push(extraSection)
    return assembleCommentBody({ marker, sections })
}

function droppedSectionsNote(params: { droppedSections: number; maxChars: number }): string {
    const { droppedSections, maxChars } = params
    return `> ⚠️ **${droppedSections} more changed file(s) omitted** — the comment hit GitHub's ${maxChars}-character limit.`
}

/**
 * Assembles a PR comment body that fits within GitHub's comment size limit, degrading
 * gracefully rather than posting a body that gets rejected with a raw 422: first every
 * diagram is inlined; if that doesn't fit, diagrams are omitted largest-first (in favor
 * of a placeholder note) until it does; if even that isn't enough, whole file sections
 * are dropped from the end until the body fits or nothing is left.
 */
export function buildBoundedCommentBody(params: BuildBoundedCommentBodyParams): BoundedCommentBody {
    const { marker, maxChars = MAX_COMMENT_CHARS, omissionNote, overlaySection, sections } = params

    const renderables: CommentRenderable[] = sections.map((section) => ({
        key: section.filename,
        mermaidLength: section.mermaidCode.length,
        render: (includeDiagram) => renderAslFileSection(section, { includeDiagram, omissionNote }),
    }))
    if (overlaySection) {
        renderables.push({
            key: EXECUTION_OVERLAY_KEY,
            mermaidLength: overlaySection.mermaidCode.length,
            render: (includeDiagram) => renderExecutionOverlaySection(overlaySection, { includeDiagram, omissionNote }),
        })
    }

    const omitted = new Set<string>()
    const omittedDiagrams = (): string[] =>
        [...renderables]
            .sort((a, b) => b.mermaidLength - a.mermaidLength)
            .filter((renderable) => omitted.has(renderable.key) && renderable.key !== EXECUTION_OVERLAY_KEY)
            .map((renderable) => renderable.key)

    let body = assembleRenderables({ marker, omitted, renderables })
    if (body.length <= maxChars) {
        return { body, droppedSections: 0, omittedDiagrams: [] }
    }

    const byMermaidLengthDesc = [...renderables].sort((a, b) => b.mermaidLength - a.mermaidLength)
    for (const renderable of byMermaidLengthDesc) {
        omitted.add(renderable.key)
        body = assembleRenderables({ marker, omitted, renderables })
        if (body.length <= maxChars) {
            return { body, droppedSections: 0, omittedDiagrams: omittedDiagrams() }
        }
    }

    let remaining = [...renderables]
    let droppedSections = 0
    while (remaining.length > 0) {
        remaining = remaining.slice(0, -1)
        droppedSections += 1
        const note = droppedSectionsNote({ droppedSections, maxChars })
        body = assembleRenderables({ extraSection: note, marker, omitted, renderables: remaining })
        if (body.length <= maxChars) {
            return { body, droppedSections, omittedDiagrams: omittedDiagrams() }
        }
    }

    const note = droppedSectionsNote({ droppedSections: renderables.length, maxChars })
    return {
        body: assembleCommentBody({ marker, sections: [note] }),
        droppedSections: renderables.length,
        omittedDiagrams: omittedDiagrams(),
    }
}

/** Items requested per page; the maximum the REST API accepts. */
const LIST_PAGE_SIZE = 100

/**
 * Bounds worst-case pagination to 500 items. Mirrors MAX_NOTE_LIST_PAGES in the
 * GitLab integration: enough for any realistic PR, while keeping a pathological
 * one from making unbounded API calls.
 */
const MAX_LIST_PAGES = 5

interface FindCommentByMarkerParams {
    marker: string
    octokit: ReturnType<typeof github.getOctokit>
    owner: string
    pullNumber: number
    repo: string
}

interface ListChangedFilesParams {
    octokit: ReturnType<typeof github.getOctokit>
    owner: string
    pullNumber: number
    repo: string
}

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

/**
 * Every file in a pull request, paginated. GitHub returns 30 per page by default,
 * so a single unpaginated call silently drops anything a large PR touches beyond
 * the first page - including ASL files this action exists to report on.
 */
async function listChangedFiles(
    params: ListChangedFilesParams,
): Promise<{ filename: string; status: string }[]> {
    const { octokit, owner, pullNumber, repo } = params
    const collected: { filename: string; status: string }[] = []

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const { data } = await octokit.rest.pulls.listFiles({
            owner,
            page,
            per_page: LIST_PAGE_SIZE,
            pull_number: pullNumber,
            repo,
        })
        collected.push(...data)
        if (data.length < LIST_PAGE_SIZE) return collected
    }

    // Reaching the cap with a full final page means there is more to fetch. Say so:
    // silently truncating here is the same no-error, no-warning miss as #155, just
    // at a higher threshold.
    core.warning(
        `Only the first ${collected.length} changed files were examined (page cap ${MAX_LIST_PAGES}); an ASL file beyond that is not reported on.`,
    )

    return collected
}

/**
 * The action's own comment from a previous run, found by its marker prefix.
 *
 * Paginated rather than first-page-only: `issues.listComments` returns oldest
 * first, so on a PR that already had a hundred-plus comments when this action
 * first ran, the marker comment sits past page 1 and never gets found - and the
 * action posts a duplicate instead of updating what is already there. Ascending
 * order is also what makes forward paging safe here: a comment added mid-scan
 * lands at the end, so it cannot shift an unread one onto a page already passed.
 */
async function findCommentByMarker(
    params: FindCommentByMarkerParams,
): Promise<{ body?: string; id: number } | undefined> {
    const { marker, octokit, owner, pullNumber, repo } = params

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const { data } = await octokit.rest.issues.listComments({
            issue_number: pullNumber,
            owner,
            page,
            per_page: LIST_PAGE_SIZE,
            repo,
        })
        const found = data.find((comment) => comment.body?.startsWith(marker))
        if (found) return found
        if (data.length < LIST_PAGE_SIZE) return undefined
    }

    // Gave up rather than ran out - without this the caller cannot tell the two
    // apart, and posts a duplicate comment exactly as it did before #156.
    core.warning(
        `Stopped searching for a previous comment after ${MAX_LIST_PAGES} pages; a new comment will be posted even if one already exists.`,
    )

    return undefined
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

    const changedFiles = await listChangedFiles({ octokit, owner, pullNumber, repo })

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

    if (sections.length === 0) {
        core.info('No valid ASL definitions found in changed files')
        return
    }

    let overlaySection: ExecutionOverlaySection | null = null
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
        overlaySection = overlay.section
    }

    const marker = `${COMMENT_PREFIX}${commentTag}-->`
    const { body, droppedSections, omittedDiagrams } = buildBoundedCommentBody({
        marker,
        omissionNote: DIAGRAM_TOO_LARGE_NOTE,
        overlaySection,
        sections,
    })

    if (omittedDiagrams.length > 0 || droppedSections > 0) {
        core.warning(
            `The comment exceeded GitHub's ${MAX_COMMENT_CHARS.toLocaleString()}-character limit` +
                (omittedDiagrams.length > 0
                    ? `; omitted the diagram(s) for ${omittedDiagrams.join(', ')}`
                    : '') +
                (droppedSections > 0 ? `; dropped ${droppedSections} whole file section(s)` : '') +
                '. Set `hide-catch: true` or `collapse: true` to shrink them.',
        )
    }

    const existing = await findCommentByMarker({ marker, octokit, owner, pullNumber, repo })

    try {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to post PR comment (body length ${body.length}): ${message}`)
    }
}
