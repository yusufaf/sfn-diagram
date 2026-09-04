/**
 * Platform-neutral Markdown report building for CI integrations (the GitHub
 * Action, the `sfn-diagram comment gitlab` CLI subcommand, and any future
 * platform). Nothing here talks to a specific forge's API — it turns parsed
 * ASL (before/after pairs, an execution) into Markdown sections a caller then
 * assembles into a comment body and posts however that platform requires.
 */
import { minimatch } from 'minimatch';
import { generateMermaid } from '../index';
import { generateMermaidDiff } from '../diff';
import { generateMermaidExecution } from '../execution';
import type { AslDefinition, CatchHandling } from '../types';
import type {
    ExecutionMode,
    FetchExecutionForOverlayParams,
    OverlayExecution,
} from './execution';

/** An added/modified ASL file whose after-state can be overlaid with an execution. */
export interface OverlayCandidate {
    afterAsl: AslDefinition;
    filename: string;
}

export function isAslDefinition(obj: unknown): obj is AslDefinition {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'StartAt' in obj &&
        'States' in obj &&
        typeof (obj as Record<string, unknown>).StartAt === 'string'
    );
}

/** Parses raw file content into an `AslDefinition`, or `null` if it isn't one. */
export function parseAslJson(content: string): AslDefinition | null {
    try {
        const parsed: unknown = JSON.parse(content);
        return isAslDefinition(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function matchesPatterns(filepath: string, patterns: string[]): boolean {
    return patterns.some((pattern) =>
        minimatch(filepath, pattern, { matchBase: true }),
    );
}

export function formatStateList(names: string[]): string {
    return names.map((name) => `\`${name}\``).join(', ');
}

/** The before/after ASL for one changed file, ready to be turned into a report section. */
export interface AslFileChange {
    afterAsl: AslDefinition | null;
    beforeAsl: AslDefinition | null;
    filename: string;
}

/**
 * One file's report section, split so a caller can decide whether to inline
 * the Mermaid diagram (e.g. GitLab's per-page character budget) or link it
 * elsewhere instead. `header` never counts against such a budget.
 */
export interface AslFileSection {
    /** The `after`-state ASL, when present — a candidate for an execution overlay. */
    afterAsl: AslDefinition | null;
    filename: string;
    /** Filename heading, status callout, and (for a modified file) the change-summary table. */
    header: string;
    /** Mermaid source for this file's diagram (plain, or diff-highlighted for a modified file). */
    mermaidCode: string;
    /** Label for the collapsible `<summary>`. */
    mermaidLabel: string;
    /** Diff sections default to expanded (`<details open>`); plain diagrams stay collapsed. */
    mermaidOpenByDefault: boolean;
}

/**
 * Builds one report section for a changed ASL file: a plain diagram for an
 * added or deleted file, or a diff-highlighted diagram plus a change-summary
 * table for a modified file. Returns `null` when neither side parsed as ASL.
 */
export function buildAslFileSection(
    change: AslFileChange,
    options: { catchHandling?: CatchHandling } = {},
): AslFileSection | null {
    const { afterAsl, beforeAsl, filename } = change;

    if (!afterAsl && !beforeAsl) {
        return null;
    }

    if (!afterAsl && beforeAsl) {
        const { code } = generateMermaid({
            aslDefinition: beforeAsl,
            ...options,
        });
        return {
            afterAsl: null,
            filename,
            header: `### \`${filename}\`\n\n> ⚠️ **File deleted**\n\n`,
            mermaidCode: code,
            mermaidLabel: '📊 Before diagram',
            mermaidOpenByDefault: false,
        };
    }

    if (afterAsl && !beforeAsl) {
        const { code } = generateMermaid({
            aslDefinition: afterAsl,
            ...options,
        });
        return {
            afterAsl,
            filename,
            header: `### \`${filename}\`\n\n> ✨ **New file**\n\n`,
            mermaidCode: code,
            mermaidLabel: '📊 Diagram',
            mermaidOpenByDefault: false,
        };
    }

    // generateMermaidDiff takes no DiagramOptions — `catchHandling` has no effect
    // on a diff section, only on the plain (added/deleted) branches above.
    const diff = generateMermaidDiff({
        after: afterAsl as AslDefinition,
        before: beforeAsl as AslDefinition,
    });
    const { added, modified, removed, unchanged } = diff.metadata;

    const rows: string[] = [];
    if (added.length > 0) rows.push(`| ➕ Added | ${formatStateList(added)} |`);
    if (modified.length > 0)
        rows.push(`| ✏️ Modified | ${formatStateList(modified)} |`);
    if (removed.length > 0)
        rows.push(`| ❌ Removed | ${formatStateList(removed)} |`);
    if (rows.length === 0) {
        rows.push(
            `| ✅ No changes | ${unchanged.length} state${unchanged.length !== 1 ? 's' : ''} unchanged |`,
        );
    }

    return {
        afterAsl,
        filename,
        header: `### \`${filename}\`\n\n| | States |\n|---|---|\n${rows.join('\n')}\n\n`,
        mermaidCode: diff.code,
        mermaidLabel: '📊 Diagram (changes highlighted)',
        mermaidOpenByDefault: true,
    };
}

/**
 * Renders a file section to Markdown. Pass `includeDiagram: false` to drop
 * the fenced Mermaid block in favor of a placeholder line — for platforms
 * with a diagram-size budget, once a report has crossed it.
 */
export function renderAslFileSection(
    section: AslFileSection,
    options: { includeDiagram: boolean } = { includeDiagram: true },
): string {
    if (!options.includeDiagram) {
        return `${section.header}> 📎 Diagram omitted — see the diagram artifact attached to this pipeline\n`;
    }

    const openAttribute = section.mermaidOpenByDefault ? ' open' : '';
    return (
        `${section.header}<details${openAttribute}>\n<summary>${section.mermaidLabel}</summary>\n\n` +
        `\`\`\`mermaid\n${section.mermaidCode}\n\`\`\`\n\n</details>\n`
    );
}

export interface BuildExecutionOverlaySectionParams {
    candidates: OverlayCandidate[];
    /** Injected so callers keep control over how the execution is actually fetched (and tests can mock it). */
    fetchExecution: (
        params: FetchExecutionForOverlayParams,
    ) => Promise<OverlayExecution | undefined>;
    mode: Exclude<ExecutionMode, 'off'>;
    region?: string;
    stateMachineArn: string;
}

/**
 * The execution-overlay section, split the same way `AslFileSection` is —
 * `header` (filename, execution ARN/status, never counts against a
 * diagram-size budget) separate from the Mermaid diagram itself — so a
 * caller can drop the diagram in favor of a placeholder once a budget is
 * exceeded, the same as `renderAslFileSection` does for a changed file.
 */
export interface ExecutionOverlaySection {
    header: string;
    mermaidCode: string;
    mermaidLabel: string;
}

export interface BuildExecutionOverlaySectionResult {
    /** A message the caller may want to surface (e.g. via `core.info`/`core.warning` or stderr). */
    log?: { level: 'info' | 'warning'; message: string };
    section: ExecutionOverlaySection | null;
}

/**
 * Builds the execution-overlay report section, or returns `section: null`
 * (with a `log` explaining why) when it can't. Requires exactly one changed
 * definition so the single `state-machine-arn` maps unambiguously to a diagram.
 */
export async function buildExecutionOverlaySection(
    params: BuildExecutionOverlaySectionParams,
): Promise<BuildExecutionOverlaySectionResult> {
    const { candidates, fetchExecution, mode, region, stateMachineArn } =
        params;

    if (candidates.length === 0) {
        return {
            log: {
                level: 'info',
                message:
                    'Execution overlay: no added/modified ASL definition to overlay — skipping',
            },
            section: null,
        };
    }
    if (candidates.length > 1) {
        return {
            log: {
                level: 'warning',
                message:
                    'Execution overlay: multiple ASL files changed; a single state-machine-arn cannot ' +
                    'be mapped to them — skipping. Limit the change to one state machine or unset execution-mode.',
            },
            section: null,
        };
    }

    const [candidate] = candidates;

    let execution: OverlayExecution | undefined;
    try {
        execution = await fetchExecution({ mode, region, stateMachineArn });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            log: {
                level: 'warning',
                message: `Execution overlay: failed to fetch execution history — ${message}`,
            },
            section: null,
        };
    }

    if (!execution) {
        return {
            log: {
                level: 'info',
                message: `Execution overlay: no ${mode === 'latest-failed' ? 'failed ' : ''}execution found for ${stateMachineArn}`,
            },
            section: null,
        };
    }

    const { code, metadata } = generateMermaidExecution({
        aslDefinition: candidate.afterAsl,
        history: execution.events,
    });

    const summary = [
        `✅ ${metadata.succeeded.length}`,
        `❌ ${metadata.failed.length}`,
        `🟠 ${metadata.caught.length}`,
        `⚪ ${metadata.notReached.length}`,
    ].join(' · ');

    let header = `### 🎬 Execution overlay — \`${candidate.filename}\`\n\n`;
    header += `> Most recent${mode === 'latest-failed' ? ' **failed**' : ''} execution: \`${execution.executionArn}\`\n`;
    header += `> Status: **${execution.status ?? metadata.executionStatus}** — ${summary} (succeeded · failed · caught · not reached)\n\n`;

    return {
        section: { header, mermaidCode: code, mermaidLabel: '📊 Execution diagram' },
    };
}

/**
 * Renders an execution-overlay section to Markdown. Pass `includeDiagram:
 * false` to drop the fenced Mermaid block once a report has crossed a
 * platform's diagram-size budget — mirrors `renderAslFileSection`.
 */
export function renderExecutionOverlaySection(
    section: ExecutionOverlaySection,
    options: { includeDiagram: boolean } = { includeDiagram: true }
): string {
    if (!options.includeDiagram) {
        return `${section.header}> 📎 Execution diagram omitted — GitLab's diagram budget was already used by the changed-file diagrams above\n`;
    }

    return (
        `${section.header}<details open>\n<summary>${section.mermaidLabel}</summary>\n\n` +
        `\`\`\`mermaid\n${section.mermaidCode}\n\`\`\`\n\n</details>\n`
    );
}

export const DEFAULT_REPORT_HEADING: string =
    '## 🔀 Step Functions Diagram Changes';

export const DEFAULT_REPORT_FOOTER: string =
    '*Diagrams by [sfn-diagram](https://sfn.yusufaf.dev) — ' +
    '[try the playground](https://sfn.yusufaf.dev/playground/) · ' +
    '[source](https://github.com/yusufaf/sfn-diagram)*';

export interface AssembleCommentBodyParams {
    footer?: string;
    heading?: string;
    /** An HTML-comment marker prefixing the body, used to find/update the comment on later runs. */
    marker: string;
    /** Already-rendered per-file section Markdown, in the order they should appear. */
    sections: string[];
}

/** Joins a marker, heading, per-file sections, and footer into one comment body. */
export function assembleCommentBody(params: AssembleCommentBodyParams): string {
    const {
        footer = DEFAULT_REPORT_FOOTER,
        heading = DEFAULT_REPORT_HEADING,
        marker,
        sections,
    } = params;
    return [marker, heading, '', sections.join('\n---\n\n'), '', footer].join(
        '\n',
    );
}
