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
import { lintAsl } from '../lint';
import type { AslDefinition, LintDiagnostic, CatchHandling, LayoutDirection, ThemeOption } from '../types';
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

/** Escape the characters that would end or restyle a Markdown table cell / inline code span. */
function escapeMarkdownCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Shown in place of the diagram when the definition has lint errors the renderer would reject. */
export const LINT_ERROR_DIAGRAM_NOTE =
    '> ❌ Diagram omitted — the definition has errors Step Functions would reject';

function hasLintErrors(diagnostics: LintDiagnostic[]): boolean {
    return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/**
 * A collapsed `<details>` block listing every {@link lintAsl} finding for the
 * after-state of a file, or an empty string when the definition is clean.
 *
 * Collapsed by default: the diagram is what the comment is for, and a warning
 * such as an unreachable state is worth a glance, not a wall of text above it.
 * Errors — a definition Step Functions would reject — are counted separately in
 * the summary line so they are not mistaken for advice.
 */
export function buildLintSection(diagnostics: LintDiagnostic[]): string {
    if (diagnostics.length === 0) return '';

    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warnings = diagnostics.length - errors;
    const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
    const summary = [
        errors > 0 ? `❌ ${plural(errors, 'error')}` : '',
        warnings > 0 ? `⚠️ ${plural(warnings, 'warning')}` : '',
    ]
        .filter(Boolean)
        .join(', ');

    const rows = diagnostics.map(
        ({ code, message, path, severity }) =>
            `| ${severity === 'error' ? '❌' : '⚠️'} | \`${escapeMarkdownCell(path || '/')}\` | ${escapeMarkdownCell(message)} | \`${code}\` |`,
    );

    return (
        `<details>\n<summary>🔍 Lint: ${summary}</summary>\n\n` +
        `| | Path | Finding | Rule |\n|---|---|---|---|\n${rows.join('\n')}\n\n</details>\n\n`
    );
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
    /**
     * Mermaid source for this file's diagram (plain, or diff-highlighted for a modified
     * file). Empty when the definition has lint errors: the renderer would reject it,
     * so the header carries the findings and {@link LINT_ERROR_DIAGRAM_NOTE} instead.
     */
    mermaidCode: string;
    /** Label for the collapsible `<summary>`. */
    mermaidLabel: string;
    /** Diff sections default to expanded (`<details open>`); plain diagrams stay collapsed. */
    mermaidOpenByDefault: boolean;
}

/** Render options forwarded to the underlying Mermaid generators for one file's section. */
export interface BuildAslFileSectionOptions {
    /** Drop error-handler (Catch) branches. Plain (added/deleted) diagrams only — a diff diagram is unaffected. */
    catchHandling?: CatchHandling;
    /** Collapse Parallel/Map containers: `true` for all, or the named ones. Plain diagrams only. */
    collapse?: boolean | string[];
    layout?: LayoutDirection;
    theme?: ThemeOption;
}

/**
 * Builds one report section for a changed ASL file: a plain diagram for an
 * added or deleted file, or a diff-highlighted diagram plus a change-summary
 * table for a modified file. Returns `null` when neither side parsed as ASL.
 *
 * The definition is linted before it is drawn. Any error-severity finding means
 * the renderer would throw on it, so the section then carries the lint table and
 * {@link LINT_ERROR_DIAGRAM_NOTE} with no diagram — a broken definition should
 * produce a comment saying what is broken, not a failed CI job.
 */
export function buildAslFileSection(
    change: AslFileChange,
    options: BuildAslFileSectionOptions = {},
): AslFileSection | null {
    const { afterAsl, beforeAsl, filename } = change;

    if (!afterAsl && !beforeAsl) {
        return null;
    }

    if (!afterAsl && beforeAsl) {
        const deletedHeader = `### \`${filename}\`\n\n> ⚠️ **File deleted**\n\n`;
        if (hasLintErrors(lintAsl({ definition: beforeAsl }))) {
            return {
                afterAsl: null,
                filename,
                header: `${deletedHeader}${LINT_ERROR_DIAGRAM_NOTE}\n\n`,
                mermaidCode: '',
                mermaidLabel: '📊 Before diagram',
                mermaidOpenByDefault: false,
            };
        }
        const { code } = generateMermaid({
            aslDefinition: beforeAsl,
            ...options,
        });
        return {
            afterAsl: null,
            filename,
            header: deletedHeader,
            mermaidCode: code,
            mermaidLabel: '📊 Before diagram',
            mermaidOpenByDefault: false,
        };
    }

    const diagnostics = lintAsl({ definition: afterAsl as AslDefinition });
    const lintSection = buildLintSection(diagnostics);

    if (afterAsl && !beforeAsl) {
        const newHeader = `### \`${filename}\`\n\n> ✨ **New file**\n\n${lintSection}`;
        if (hasLintErrors(diagnostics)) {
            return {
                afterAsl,
                filename,
                header: `${newHeader}${LINT_ERROR_DIAGRAM_NOTE}\n\n`,
                mermaidCode: '',
                mermaidLabel: '📊 Diagram',
                mermaidOpenByDefault: false,
            };
        }
        const { code } = generateMermaid({
            aslDefinition: afterAsl,
            ...options,
        });
        return {
            afterAsl,
            filename,
            header: newHeader,
            mermaidCode: code,
            mermaidLabel: '📊 Diagram',
            mermaidOpenByDefault: false,
        };
    }

    if (hasLintErrors(diagnostics)) {
        return {
            afterAsl,
            filename,
            header: `### \`${filename}\`\n\n${lintSection}${LINT_ERROR_DIAGRAM_NOTE}\n\n`,
            mermaidCode: '',
            mermaidLabel: '📊 Diagram (changes highlighted)',
            mermaidOpenByDefault: true,
        };
    }

    // A diff renders a merged before/after graph with a per-state status map;
    // dropping (catchHandling) or collapsing states would desynchronise that
    // map, so only layout/theme reach a diff section — catchHandling/collapse
    // have no effect here, only on the plain (added/deleted) branches above.
    const diff = generateMermaidDiff({
        after: afterAsl as AslDefinition,
        before: beforeAsl as AslDefinition,
        layout: options.layout,
        theme: options.theme,
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
        header: `### \`${filename}\`\n\n| | States |\n|---|---|\n${rows.join('\n')}\n\n${lintSection}`,
        mermaidCode: diff.code,
        mermaidLabel: '📊 Diagram (changes highlighted)',
        mermaidOpenByDefault: true,
    };
}

export const DEFAULT_DIAGRAM_OMISSION_NOTE =
    '> 📎 Diagram omitted — the diagram was too large to inline';

export const DEFAULT_EXECUTION_DIAGRAM_OMISSION_NOTE =
    '> 📎 Execution diagram omitted — the diagram was too large to inline';

/** Options for {@link renderAslFileSection}. */
export interface RenderAslFileSectionOptions {
    includeDiagram: boolean;
    /** Markdown line shown in place of the fenced diagram when includeDiagram is false. */
    omissionNote?: string;
}

/**
 * Renders a file section to Markdown. Pass `includeDiagram: false` to drop
 * the fenced Mermaid block in favor of a placeholder line — for platforms
 * with a diagram-size budget, once a report has crossed it.
 */
export function renderAslFileSection(
    section: AslFileSection,
    options: RenderAslFileSectionOptions = { includeDiagram: true },
): string {
    // No diagram to include or omit: the header already explains why.
    if (section.mermaidCode === '') {
        return section.header;
    }
    if (!options.includeDiagram) {
        return `${section.header}${options.omissionNote ?? DEFAULT_DIAGRAM_OMISSION_NOTE}\n`;
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

/** Options for {@link renderExecutionOverlaySection}. */
export interface RenderExecutionOverlaySectionOptions {
    includeDiagram: boolean;
    omissionNote?: string;
}

/**
 * Renders an execution-overlay section to Markdown. Pass `includeDiagram:
 * false` to drop the fenced Mermaid block once a report has crossed a
 * platform's diagram-size budget — mirrors `renderAslFileSection`.
 */
export function renderExecutionOverlaySection(
    section: ExecutionOverlaySection,
    options: RenderExecutionOverlaySectionOptions = { includeDiagram: true }
): string {
    if (!options.includeDiagram) {
        return `${section.header}${options.omissionNote ?? DEFAULT_EXECUTION_DIAGRAM_OMISSION_NOTE}\n`;
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
