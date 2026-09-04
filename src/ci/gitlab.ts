/**
 * GitLab merge request integration: detects the CI/CD-provided merge request
 * context, discovers changed ASL files via git (no API/token needed for
 * that), and posts (or updates) one MR note per merge request. Node-only.
 *
 * GitLab renders Mermaid natively in MR notes, but caps it at ~2000
 * characters *shared across the whole page* (every Mermaid block on it, not
 * just this one) — a moderately sized state machine can single-handedly
 * exceed that. Past `MAX_INLINE_MERMAID_CHARS`, this module drops the inline
 * diagrams in favor of SVG files written to `outputDir`, which the caller's
 * `.gitlab-ci.yml` is expected to expose via `artifacts: expose_as`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDiff } from '../diff';
import { generateSvg } from '../index';
import type { AslDefinition, CatchHandling, ThemeOption } from '../types';
import {
    assembleCommentBody,
    buildAslFileSection,
    buildExecutionOverlaySection,
    parseAslJson,
    renderAslFileSection,
} from './buildReport';
import type { AslFileSection, OverlayCandidate } from './buildReport';
import {
    getChangedAslFiles,
    readFileAtGitRef,
    readWorkingTreeFile,
} from './changedFiles';
import { fetchExecutionForOverlay } from './execution';
import type { ExecutionMode } from './execution';

/** Roughly half of GitLab's ~2000-char page-wide Mermaid budget, leaving headroom for other bots/diagrams on the same MR. */
export const MAX_INLINE_MERMAID_CHARS = 1800;

export interface GitlabMergeRequestContext {
    apiUrl: string;
    mergeRequestIid: number;
    projectId: string;
}

/**
 * Reads the merge request's API coordinates from GitLab CI's predefined
 * variables. `CI_MERGE_REQUEST_IID` is set in merge request pipelines; a
 * branch pipeline instead gets `CI_OPEN_MERGE_REQUESTS`
 * (`group/project!iid[,...]`), whose first entry's IID is used as a fallback.
 * Returns `null` when the context can't be determined.
 */
export function detectGitlabMergeRequestContext(
    env: NodeJS.ProcessEnv = process.env,
): GitlabMergeRequestContext | null {
    const apiUrl = env.CI_API_V4_URL;
    const projectId = env.CI_MERGE_REQUEST_PROJECT_ID ?? env.CI_PROJECT_ID;
    if (!apiUrl || !projectId) return null;

    if (env.CI_MERGE_REQUEST_IID) {
        return {
            apiUrl,
            mergeRequestIid: Number(env.CI_MERGE_REQUEST_IID),
            projectId,
        };
    }

    const firstOpenMr = env.CI_OPEN_MERGE_REQUESTS?.split(',')[0]?.trim();
    const match = firstOpenMr?.match(/!(\d+)$/);
    if (match) {
        return { apiUrl, mergeRequestIid: Number(match[1]), projectId };
    }

    return null;
}

/** `GITLAB_TOKEN` is the convention several GitLab-integrated tools (Infracost, reviewdog, Danger) already use. */
export function resolveGitlabToken(
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    return env.GITLAB_TOKEN || env.SFN_DIAGRAM_GITLAB_TOKEN || null;
}

export interface UpsertMergeRequestNoteParams {
    apiUrl: string;
    body: string;
    /** Fetch implementation to use — injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    marker: string;
    mergeRequestIid: number;
    projectId: string;
    token: string;
}

export interface UpsertMergeRequestNoteResult {
    action: 'created' | 'updated';
    noteId: number;
}

/**
 * Creates a merge request note, or updates one from a previous run — found by
 * an HTML-comment marker prefixing its body — so re-runs update the same
 * comment instead of piling up new ones.
 */
export async function upsertMergeRequestNote(
    params: UpsertMergeRequestNoteParams,
): Promise<UpsertMergeRequestNoteResult> {
    const {
        apiUrl,
        body,
        fetchImpl = fetch,
        marker,
        mergeRequestIid,
        projectId,
        token,
    } = params;
    const notesUrl = `${apiUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}/notes`;

    const listResponse = await fetchImpl(
        `${notesUrl}?per_page=100&order_by=created_at&sort=desc`,
        {
            headers: { 'PRIVATE-TOKEN': token },
        },
    );
    if (!listResponse.ok) {
        throw new Error(
            `Failed to list merge request notes: ${listResponse.status} ${listResponse.statusText}`,
        );
    }
    const notes = (await listResponse.json()) as {
        body?: string;
        id: number;
    }[];
    const existing = notes.find((note) => note.body?.startsWith(marker));

    if (existing) {
        const response = await fetchImpl(`${notesUrl}/${existing.id}`, {
            body: JSON.stringify({ body }),
            headers: {
                'Content-Type': 'application/json',
                'PRIVATE-TOKEN': token,
            },
            method: 'PUT',
        });
        if (!response.ok) {
            throw new Error(
                `Failed to update merge request note: ${response.status} ${response.statusText}`,
            );
        }
        return { action: 'updated', noteId: existing.id };
    }

    const response = await fetchImpl(notesUrl, {
        body: JSON.stringify({ body }),
        headers: { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': token },
        method: 'POST',
    });
    if (!response.ok) {
        throw new Error(
            `Failed to create merge request note: ${response.status} ${response.statusText}`,
        );
    }
    const created = (await response.json()) as { id: number };
    return { action: 'created', noteId: created.id };
}

export interface RunGitlabCommentParams {
    /** Comma-separated glob patterns matching ASL definition files. */
    aslGlob: string;
    awsRegion?: string;
    /** Drop error-handler (Catch) branches — shrinks plain (added/deleted) diagrams; has no effect on a diff diagram, which takes no render options. */
    catchHandling?: CatchHandling;
    /** Unique tag used to find/update this run's note on later pushes. */
    commentTag: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    executionMode: ExecutionMode;
    /** Injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Where SVG fallback diagrams are written once the report exceeds GitLab's inline Mermaid budget. */
    outputDir: string;
    stateMachineArn: string;
    theme: ThemeOption;
}

export interface RunGitlabCommentResult {
    /** Process exit code the caller should use: `0` success (including "nothing to do" and "no token"), `1` a real failure. */
    exitCode: number;
    logs: { level: 'error' | 'info' | 'warning'; message: string }[];
}

/**
 * Full GitLab merge request integration: discovers ASL files changed in the
 * current merge request via git, builds a diagram/diff report, writes SVG
 * fallback artifacts if the report is too large to inline, and — when
 * `GITLAB_TOKEN`/`SFN_DIAGRAM_GITLAB_TOKEN` is set — posts or updates the MR
 * note. With no token, it renders (and writes artifacts, if needed) but skips
 * commenting and still exits `0`, so the same job works with zero setup.
 */
export async function runGitlabComment(
    params: RunGitlabCommentParams,
): Promise<RunGitlabCommentResult> {
    const {
        aslGlob,
        awsRegion,
        catchHandling,
        commentTag,
        cwd = process.cwd(),
        env = process.env,
        executionMode,
        fetchImpl = fetch,
        outputDir,
        stateMachineArn,
        theme,
    } = params;

    const logs: RunGitlabCommentResult['logs'] = [];
    const log = (
        level: 'error' | 'info' | 'warning',
        message: string,
    ): void => {
        logs.push({ level, message });
    };

    const baseRef = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
    if (!baseRef) {
        log(
            'info',
            'Not running in a merge request pipeline (CI_MERGE_REQUEST_DIFF_BASE_SHA is not set) — skipping',
        );
        return { exitCode: 0, logs };
    }

    const patterns = aslGlob.split(',').map((pattern) => pattern.trim());

    let changedFiles;
    try {
        changedFiles = getChangedAslFiles({ baseRef, cwd, patterns });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(
            'error',
            `Failed to diff against the merge request base (${baseRef}) — is the clone deep enough? ` +
                `Set "GIT_DEPTH: 0" in the job. Underlying error: ${message}`,
        );
        return { exitCode: 1, logs };
    }

    if (changedFiles.length === 0) {
        log('info', 'No ASL files changed in this merge request');
        return { exitCode: 0, logs };
    }

    const sections: AslFileSection[] = [];
    const overlayCandidates: OverlayCandidate[] = [];
    const parsedByFilename = new Map<
        string,
        { afterAsl: AslDefinition | null; beforeAsl: AslDefinition | null }
    >();

    for (const file of changedFiles) {
        const beforeContent =
            file.status === 'added'
                ? null
                : readFileAtGitRef({ cwd, path: file.basePath, ref: baseRef });
        const afterContent =
            file.status === 'removed'
                ? null
                : readWorkingTreeFile({ cwd, path: file.filename });

        const beforeAsl = beforeContent ? parseAslJson(beforeContent) : null;
        const afterAsl = afterContent ? parseAslJson(afterContent) : null;

        if (!beforeAsl && !afterAsl) {
            log(
                'info',
                `Skipping ${file.filename}: not a valid ASL definition`,
            );
            continue;
        }

        parsedByFilename.set(file.filename, { afterAsl, beforeAsl });
        if (afterAsl) {
            overlayCandidates.push({ afterAsl, filename: file.filename });
        }

        const section = buildAslFileSection(
            { afterAsl, beforeAsl, filename: file.filename },
            { catchHandling },
        );
        if (section) sections.push(section);
    }

    if (sections.length === 0) {
        log('info', 'No valid ASL definitions found in changed files');
        return { exitCode: 0, logs };
    }

    const totalMermaidChars = sections.reduce(
        (sum, section) => sum + section.mermaidCode.length,
        0,
    );
    const includeDiagrams = totalMermaidChars <= MAX_INLINE_MERMAID_CHARS;

    const bodySections = sections.map((section) =>
        renderAslFileSection(section, { includeDiagram: includeDiagrams }),
    );

    if (!includeDiagrams) {
        mkdirSync(outputDir, { recursive: true });
        for (const section of sections) {
            const parsed = parsedByFilename.get(section.filename);
            if (!parsed) continue;

            const svg = renderFallbackSvg({ ...parsed, catchHandling, theme });
            if (!svg) continue;

            const artifactPath = join(
                outputDir,
                `${section.filename.replace(/[\\/]/g, '__')}.svg`,
            );
            writeFileSync(artifactPath, svg, 'utf-8');
        }
        log(
            'info',
            `Combined diagrams exceeded GitLab's ~2000-character inline Mermaid budget ` +
                `(${totalMermaidChars} chars) — wrote SVG fallbacks to ${outputDir}/. ` +
                `Expose them with "artifacts: expose_as" in the job so they show up on the merge request widget.`,
        );
    }

    if (executionMode !== 'off') {
        if (!stateMachineArn) {
            log(
                'warning',
                'execution-mode is set but state-machine-arn is empty; skipping the execution overlay.',
            );
        } else {
            const overlay = await buildExecutionOverlaySection({
                candidates: overlayCandidates,
                fetchExecution: fetchExecutionForOverlay,
                mode: executionMode,
                region: awsRegion,
                stateMachineArn,
            });
            if (overlay.log) log(overlay.log.level, overlay.log.message);
            if (overlay.section) bodySections.push(overlay.section);
        }
    }

    const marker = `<!-- sfn-diagram:${commentTag}-->`;
    const body = assembleCommentBody({ marker, sections: bodySections });

    const token = resolveGitlabToken(env);
    if (!token) {
        log(
            'info',
            'No GITLAB_TOKEN (or SFN_DIAGRAM_GITLAB_TOKEN) set — rendered the report but skipped posting a ' +
                'merge request comment. Set one of those CI/CD variables (masked, scope "api") to enable it.',
        );
        return { exitCode: 0, logs };
    }

    const mrContext = detectGitlabMergeRequestContext(env);
    if (!mrContext) {
        log(
            'warning',
            'Could not determine the merge request context (CI_API_V4_URL / CI_MERGE_REQUEST_IID) — skipping comment',
        );
        return { exitCode: 0, logs };
    }

    try {
        const result = await upsertMergeRequestNote({
            apiUrl: mrContext.apiUrl,
            body,
            fetchImpl,
            marker,
            mergeRequestIid: mrContext.mergeRequestIid,
            projectId: mrContext.projectId,
            token,
        });
        log(
            'info',
            `${result.action === 'created' ? 'Created' : 'Updated'} merge request note #${result.noteId}`,
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('error', `Failed to post merge request comment: ${message}`);
        return { exitCode: 1, logs };
    }

    return { exitCode: 0, logs };
}

function renderFallbackSvg(params: {
    afterAsl: AslDefinition | null;
    beforeAsl: AslDefinition | null;
    catchHandling?: CatchHandling;
    theme: ThemeOption;
}): string | null {
    const { afterAsl, beforeAsl, catchHandling, theme } = params;

    if (afterAsl && beforeAsl) {
        return generateDiff({ after: afterAsl, before: beforeAsl, theme }).svg;
    }
    if (afterAsl) {
        return generateSvg({ aslDefinition: afterAsl, catchHandling, theme })
            .svg;
    }
    if (beforeAsl) {
        return generateSvg({ aslDefinition: beforeAsl, catchHandling, theme })
            .svg;
    }
    return null;
}
