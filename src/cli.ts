#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs as parseArgsFromNode } from 'node:util';
import { extractAslFromTemplate } from './cfn';
import { runGitlabComment } from './ci/gitlab';
import type { ExecutionMode } from './ci/execution';
import { generateDiff, generateMermaidDiff } from './diff';
import { generateExecution, generateMermaidExecution } from './execution';
import { generateHtmlAsync, generateMermaid, generateSvg } from './index';
import { exportPng } from './png';
import {
    collectStateData,
    resolveViewerTheme,
    wrapSvgInInteractiveHtml,
} from './renderers';
import { embedIcons } from './utils/iconEmbedder';
import type {
    AslDefinition,
    DiagramFormat,
    DiffOutput,
    ExecutionOutput,
    ExecutionStateStatus,
    LayoutDirection,
    MermaidDiffOutput,
    MermaidExecutionOutput,
    ThemeOption,
} from './types';

/** Placement of AWS service icons relative to the node label. */
export type IconPosition = 'left' | 'top' | 'right';

export interface CliArgs {
    collapse: string[] | boolean | null;
    diff: string | null;
    execution: string | null;
    format: DiagramFormat;
    hideCatch: boolean;
    hideVariables: boolean;
    iconPosition: IconPosition | null;
    iconSize: number | null;
    input: string | null;
    layout: LayoutDirection;
    output: string | null;
    resolveCfn: boolean;
    resource: string | null;
    showHelp: boolean;
    showIcons: boolean;
    showVersion: boolean;
    theme: ThemeOption;
}

const HELP_TEXT = `sfn-diagram — generate diagrams from AWS Step Functions ASL definitions

Usage:
  sfn-diagram <input> [options]
  sfn-diagram - [options]            (read ASL from stdin)
  sfn-diagram comment gitlab [options]   (post a diagram/diff to a GitLab merge
                                          request from CI — see --help there)

Options:
  --format <svg|mermaid|png|html>  Output format (default: svg)
  -o, --output <path>              Output file path (required for png; stdout otherwise)
  --theme <light|dark>             Color theme for SVG/PNG (default: light)
  --layout <TB|LR|RL|BT>           Graph layout direction (default: TB)
  --hide-catch                     Drop error-handler (Catch) branches from the diagram
  --hide-variables                 Drop the "$var" annotations for ASL Assign blocks
  --collapse[=names]               Collapse Parallel/Map containers into placeholders
                                   (bare flag collapses all; --collapse=Name1,Name2
                                   collapses only those states)
  --show-icons                     Draw AWS service icons on Task states
  --icon-position <left|top|right> Icon placement relative to the label (default: left)
  --icon-size <pixels>             Icon size in pixels (default: 24)
  --diff <baseline>                Compare the input (head) against a baseline definition;
                                   added/modified/removed states are highlighted
  --execution <history.json>       Overlay a GetExecutionHistory result on the diagram
  --resolve-cfn                    Treat the input as a CloudFormation/SAM/CDK template
                                   (JSON templates are detected automatically)
  --resource <logicalId>           State machine to extract when the template has several
  -h, --help                       Show this help and exit
  -v, --version                    Show version and exit

Notes:
  --diff and --execution are mutually exclusive, and both support
  --format svg, mermaid and html (not png). Their change/status summary is written to
  stderr, so the diagram itself still pipes cleanly on stdout.

  --format html produces a self-contained interactive viewer: drag to pan, wheel to
  zoom, "/" to search states, and click a state to inspect its raw ASL. AWS service
  icons are inlined, so the file works offline.

  --collapse applies to --format svg, mermaid and html, and to --diff (except
  --diff --format mermaid). It has no effect on --execution overlays, which build
  their graph separately — the same limitation --hide-catch has there.

Examples:
  sfn-diagram state.asl.json --format svg -o diagram.svg
  sfn-diagram state.asl.json --format mermaid > diagram.mmd
  cat state.asl.json | sfn-diagram - --format png -o diagram.png
  sfn-diagram state.asl.json --format html -o diagram.html
  sfn-diagram state.asl.json --show-icons --icon-position top -o diagram.svg
  sfn-diagram head.asl.json --diff base.asl.json --format mermaid > diff.mmd
  sfn-diagram state.asl.json --execution history.json -o run.svg
  cdk synth > template.json && sfn-diagram template.json --format mermaid
  sfn-diagram template.yaml --resolve-cfn --resource MyMachine -o diagram.svg
`;

const COMMENT_GITLAB_HELP_TEXT = `sfn-diagram comment gitlab — post a Step Functions diagram/diff to a GitLab merge request

Run from a GitLab CI job on a merge request pipeline. Reads GitLab's predefined
CI/CD variables, diffs the ASL files changed since the merge request's base
commit via git (no API token needed for that), and — when GITLAB_TOKEN or
SFN_DIAGRAM_GITLAB_TOKEN is set — posts (or updates) one merge request note.
With no token, it still renders and writes artifacts, then exits 0; set one of
those CI/CD variables (masked, scope "api") to enable commenting.

Requires "GIT_DEPTH: 0" (or a sufficiently deep clone) in the job, so the
merge request's base commit is reachable.

GitLab renders Mermaid natively, but caps it at roughly 2000 characters shared
across the whole page. Once the combined diagrams exceed that budget, this
command drops the inline Mermaid and writes SVG files to --output-dir instead
— expose them with "artifacts: expose_as" in the job so they show up on the
merge request widget.

Options:
  --asl-glob <patterns>             Comma-separated globs matching ASL files
                                     (default: **/*.asl.json,**/*.asl)
  --comment-tag <tag>                Marker used to find/update this run's note
                                     on later pushes (default: sfn-diagram-preview)
  --theme <light|dark>               Theme for the SVG fallback artifacts (default: light)
  --hide-catch                       Drop error-handler (Catch) branches from added/deleted
                                     diagrams (a diff diagram is unaffected — see the docs)
  --output-dir <path>                Where SVG fallback artifacts are written
                                     (default: sfn-diagram-artifacts)
  --execution-mode <off|latest|latest-failed>
                                     Optionally overlay a real execution (default: off)
  --state-machine-arn <arn>          Required when --execution-mode is not off
  --aws-region <region>              AWS region for the Step Functions client
  -h, --help                         Show this help and exit

Example .gitlab-ci.yml:
  sfn-preview:
    stage: test
    image: ghcr.io/yusufaf/sfn-diagram:1
    variables:
      GIT_DEPTH: 0
    rules:
      - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    script:
      - sfn-diagram comment gitlab
    artifacts:
      expose_as: 'Step Functions diagram'
      paths: [sfn-diagram-artifacts/]
      when: on_success
`;

/** `node:util.parseArgs` option spec backing {@link parseArgs}. */
const OPTION_SPEC = {
    collapse: { type: 'string' },
    diff: { type: 'string' },
    execution: { type: 'string' },
    format: { type: 'string' },
    help: { short: 'h', type: 'boolean' },
    'hide-catch': { type: 'boolean' },
    'hide-variables': { type: 'boolean' },
    'icon-position': { type: 'string' },
    'icon-size': { type: 'string' },
    layout: { type: 'string' },
    output: { short: 'o', type: 'string' },
    'resolve-cfn': { type: 'boolean' },
    resource: { type: 'string' },
    'show-icons': { type: 'boolean' },
    theme: { type: 'string' },
    version: { short: 'v', type: 'boolean' },
} as const;

const VALID_FORMATS: readonly DiagramFormat[] = [
    'svg',
    'mermaid',
    'png',
    'html',
];
const VALID_ICON_POSITIONS: readonly IconPosition[] = ['left', 'top', 'right'];
const VALID_LAYOUTS: readonly LayoutDirection[] = ['TB', 'LR', 'RL', 'BT'];
const VALID_THEMES = ['light', 'dark'] as const;

interface ExpectEnumParams<Value extends string> {
    allowed: readonly Value[];
    flag: string;
    value: string;
}

/** Validate a flag's value against a fixed set of choices, or throw a `CliError`. */
function expectEnum<Value extends string>(
    params: ExpectEnumParams<Value>,
): Value {
    const { allowed, flag, value } = params;
    if (!allowed.includes(value as Value)) {
        throw new CliError(
            `Invalid ${flag}: ${value}. Expected one of: ${allowed.join(', ')}`,
            2,
        );
    }
    return value as Value;
}

/** Split a `--collapse=Name1,Name2` value into trimmed, non-empty state names. */
function parseCollapseNames(value: string): string[] {
    return value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}

/**
 * Placeholder inline value for a bare `--collapse`, distinguishable from a genuinely
 * empty `--collapse=` (which means "collapse nothing", i.e. an empty name list —
 * see the `collapse` mapping below). Not a character a real flag value would contain.
 */
const BARE_COLLAPSE_SENTINEL = '\u0000';
export function parseArgs(argv: string[]): CliArgs {
    // A bare `--collapse` declared as a string option would otherwise swallow the
    // next token — including the input path — as its value. Rewriting it to an
    // explicit sentinel inline value keeps it non-greedy without colliding with an
    // explicit `--collapse=` (empty string) meaning something different.
    //
    // Skip this rewrite for any `--collapse` occurring after a literal `--`
    // terminator, where it's a positional value (e.g. a file named `--collapse`),
    // not a flag.
    const terminatorIndex = argv.indexOf('--');
    const normalizedArgv = argv.map((arg, index) =>
        arg === '--collapse' &&
        (terminatorIndex === -1 || index < terminatorIndex)
            ? `--collapse=${BARE_COLLAPSE_SENTINEL}`
            : arg,
    );

    let values: Partial<Record<keyof typeof OPTION_SPEC, string | boolean>>;
    let positionals: string[];
    try {
        ({ positionals, values } = parseArgsFromNode({
            allowPositionals: true,
            args: normalizedArgv,
            options: OPTION_SPEC,
            strict: true,
        }));
    } catch (error) {
        throw remapParseArgsError(error);
    }

    if (positionals.length > 1) {
        throw new CliError(
            `Unexpected positional argument: ${positionals[1]}`,
            2,
        );
    }

    const collapseValue = values.collapse as string | undefined;
    const iconSizeValue = values['icon-size'] as string | undefined;
    let iconSize: number | null = null;
    if (iconSizeValue !== undefined) {
        iconSize = Number(iconSizeValue);
        if (!Number.isFinite(iconSize) || iconSize <= 0) {
            throw new CliError(
                `Invalid --icon-size: ${iconSizeValue}. Expected a positive number of pixels`,
                2,
            );
        }
    }

    return {
        collapse:
            collapseValue === undefined
                ? null
                : collapseValue === BARE_COLLAPSE_SENTINEL
                  ? true
                  : parseCollapseNames(collapseValue),
        diff: (values.diff as string | undefined) ?? null,
        execution: (values.execution as string | undefined) ?? null,
        format:
            values.format === undefined
                ? 'svg'
                : expectEnum({
                      allowed: VALID_FORMATS,
                      flag: '--format',
                      value: values.format as string,
                  }),
        hideCatch: values['hide-catch'] === true,
        hideVariables: values['hide-variables'] === true,
        iconPosition:
            values['icon-position'] === undefined
                ? null
                : expectEnum({
                      allowed: VALID_ICON_POSITIONS,
                      flag: '--icon-position',
                      value: values['icon-position'] as string,
                  }),
        iconSize,
        input: positionals[0] ?? null,
        layout:
            values.layout === undefined
                ? 'TB'
                : expectEnum({
                      allowed: VALID_LAYOUTS,
                      flag: '--layout',
                      value: values.layout as string,
                  }),
        output: (values.output as string | undefined) ?? null,
        resolveCfn: values['resolve-cfn'] === true,
        resource: (values.resource as string | undefined) ?? null,
        showHelp: values.help === true,
        showIcons: values['show-icons'] === true,
        showVersion: values.version === true,
        theme:
            values.theme === undefined
                ? 'light'
                : expectEnum({
                      allowed: VALID_THEMES,
                      flag: '--theme',
                      value: values.theme as string,
                  }),
    };
}

/**
 * Translate `node:util.parseArgs`'s errors (thrown for an unrecognized flag or a
 * string flag with no value) into the `CliError` shape/wording this CLI has always
 * used, so `run()`'s error output and its tests don't need to know the parser changed.
 */
function remapParseArgsError(error: unknown): CliError {
    if (error instanceof CliError) return error;
    if (!(error instanceof Error) || !('code' in error)) throw error;

    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
        const flag =
            /Unknown option '(.+?)'/.exec(error.message)?.[1] ?? error.message;
        return new CliError(`Unknown flag: ${flag}`, 2);
    }
    if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
        const flag =
            /Option '(?:-\w, )?(--[\w-]+)/.exec(error.message)?.[1] ??
            error.message;
        if (/does not take an argument/.test(error.message)) {
            return new CliError(`Flag ${flag} does not take a value`, 2);
        }
        return new CliError(`Flag ${flag} requires a value`, 2);
    }
    throw error;
}

export class CliError extends Error {
    constructor(
        message: string,
        public exitCode: number,
    ) {
        super(message);
    }
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function readPackageVersion(): string {
    try {
        const url = new URL('../package.json', import.meta.url);
        const packageJson = JSON.parse(readFileSync(url, 'utf-8')) as {
            version: string;
        };
        return packageJson.version;
    } catch {
        return 'unknown';
    }
}

function isCfnTemplate(source: string): boolean {
    try {
        const parsed = JSON.parse(source) as {
            Resources?: Record<string, unknown>;
        };
        const resources = parsed?.Resources;
        return (
            !!resources &&
            Object.values(resources).some(
                (resource) =>
                    (resource as { Type?: string })?.Type ===
                    'AWS::StepFunctions::StateMachine',
            )
        );
    } catch {
        // Non-JSON (e.g. YAML template or raw ASL) — auto-detect stays a no-op;
        // users pass --resolve-cfn for YAML templates.
        return false;
    }
}

async function loadAsl(input: string | null): Promise<string> {
    if (input === null || input === '-') {
        return readStdin();
    }
    return readFileSync(resolve(input), 'utf-8');
}

interface ResolveDefinitionSourceParams {
    resolveCfn: boolean;
    resource: string | null;
    source: string;
}

/**
 * Turn a raw file body into something the generators accept: a CloudFormation/SAM/CDK
 * template is unwrapped to its ASL definition, anything else is passed through as-is.
 * Extraction warnings go to stderr so stdout stays a clean diagram stream.
 */
function resolveDefinitionSource(
    params: ResolveDefinitionSourceParams,
): AslDefinition | string {
    const { resolveCfn, resource, source } = params;
    if (!resolveCfn && !isCfnTemplate(source)) {
        return source;
    }
    const { aslDefinition, warnings } = extractAslFromTemplate({
        resourceId: resource ?? undefined,
        template: source,
    });
    for (const warning of warnings) {
        process.stderr.write(`warning: ${warning}\n`);
    }
    return aslDefinition;
}

/**
 * Formats that have a diff / execution-overlay renderer. `html` qualifies because
 * the overlay SVG is wrapped in the interactive viewer; `png` still does not.
 */
const OVERLAY_FORMATS: DiagramFormat[] = ['html', 'mermaid', 'svg'];

/** Statuses printed in the `--execution` summary, worst outcome first. */
const EXECUTION_STATUS_ORDER: ExecutionStateStatus[] = [
    'failed',
    'caught',
    'running',
    'succeeded',
    'notReached',
];

/** Print the added/modified/removed breakdown of a `--diff` run to stderr. */
function writeDiffSummary(
    metadata: DiffOutput['metadata'] | MermaidDiffOutput['metadata'],
): void {
    const { added, modified, removed, unchanged } = metadata;
    const lines: string[] = [];
    if (added.length > 0) lines.push(`  Added:     ${added.join(', ')}`);
    if (modified.length > 0) lines.push(`  Modified:  ${modified.join(', ')}`);
    if (removed.length > 0) lines.push(`  Removed:   ${removed.join(', ')}`);
    if (lines.length === 0) {
        lines.push(
            `  No changes (${unchanged.length} state${unchanged.length === 1 ? '' : 's'})`,
        );
    } else {
        lines.push(`  Unchanged: ${unchanged.length}`);
    }
    process.stderr.write(`Diff summary:\n${lines.join('\n')}\n`);
}

/** Print the per-status state breakdown of an `--execution` run to stderr. */
function writeExecutionSummary(
    metadata: ExecutionOutput['metadata'] | MermaidExecutionOutput['metadata'],
): void {
    const lines: string[] = [];
    for (const status of EXECUTION_STATUS_ORDER) {
        const names = metadata[status];
        if (names.length > 0) lines.push(`  ${status}: ${names.join(', ')}`);
    }
    process.stderr.write(
        `Execution summary (execution ${metadata.executionStatus}):\n${lines.join('\n')}\n`,
    );
}

export interface CommentGitlabArgs {
    aslGlob: string;
    awsRegion?: string;
    commentTag: string;
    executionMode: ExecutionMode;
    hideCatch: boolean;
    outputDir: string;
    showHelp: boolean;
    stateMachineArn: string;
    theme: ThemeOption;
}

const EXECUTION_MODES: ExecutionMode[] = ['off', 'latest', 'latest-failed'];

export function parseCommentGitlabArgs(argv: string[]): CommentGitlabArgs {
    const args: CommentGitlabArgs = {
        aslGlob: '**/*.asl.json,**/*.asl',
        commentTag: 'sfn-diagram-preview',
        executionMode: 'off',
        hideCatch: false,
        outputDir: 'sfn-diagram-artifacts',
        showHelp: false,
        stateMachineArn: '',
        theme: 'light',
    };

    const expectValue = (flag: string, value: string | undefined): string => {
        if (value === undefined) {
            throw new CliError(`Flag ${flag} requires a value`, 2);
        }
        return value;
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];

        if (arg === '-h' || arg === '--help') {
            args.showHelp = true;
            continue;
        }
        if (arg === '--asl-glob') {
            args.aslGlob = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--comment-tag') {
            args.commentTag = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--theme') {
            const value = expectValue(arg, argv[++index]);
            if (value !== 'light' && value !== 'dark') {
                throw new CliError(
                    `Invalid --theme: ${value} (expected light or dark)`,
                    2,
                );
            }
            args.theme = value;
            continue;
        }
        if (arg === '--hide-catch') {
            args.hideCatch = true;
            continue;
        }
        if (arg === '--output-dir') {
            args.outputDir = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--execution-mode') {
            const value = expectValue(arg, argv[++index]);
            if (!EXECUTION_MODES.includes(value as ExecutionMode)) {
                throw new CliError(
                    `Invalid --execution-mode: ${value} (expected ${EXECUTION_MODES.join(', ')})`,
                    2,
                );
            }
            args.executionMode = value as ExecutionMode;
            continue;
        }
        if (arg === '--state-machine-arn') {
            args.stateMachineArn = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--aws-region') {
            args.awsRegion = expectValue(arg, argv[++index]);
            continue;
        }

        throw new CliError(`Unknown flag: ${arg}`, 2);
    }

    return args;
}

async function runCommentGitlab(argv: string[]): Promise<number> {
    let args: CommentGitlabArgs;
    try {
        args = parseCommentGitlabArgs(argv);
    } catch (error) {
        if (error instanceof CliError) {
            process.stderr.write(
                `${error.message}\n\n${COMMENT_GITLAB_HELP_TEXT}`,
            );
            return error.exitCode;
        }
        throw error;
    }

    if (args.showHelp) {
        process.stdout.write(COMMENT_GITLAB_HELP_TEXT);
        return 0;
    }

    if (args.executionMode !== 'off' && !args.stateMachineArn) {
        process.stderr.write(
            '--state-machine-arn is required when --execution-mode is not off\n',
        );
        return 2;
    }

    const { exitCode, logs } = await runGitlabComment({
        aslGlob: args.aslGlob,
        awsRegion: args.awsRegion,
        catchHandling: args.hideCatch ? 'hide' : undefined,
        commentTag: args.commentTag,
        executionMode: args.executionMode,
        outputDir: args.outputDir,
        stateMachineArn: args.stateMachineArn,
        theme: args.theme,
    });

    for (const entry of logs) {
        const stream =
            entry.level === 'error' ? process.stderr : process.stdout;
        stream.write(`${entry.message}\n`);
    }

    return exitCode;
}

export async function run(argv: string[]): Promise<number> {
    if (argv[0] === 'comment' && argv[1] === 'gitlab') {
        return runCommentGitlab(argv.slice(2));
    }

    let args: CliArgs;
    try {
        args = parseArgs(argv);
    } catch (error) {
        if (error instanceof CliError) {
            process.stderr.write(`${error.message}\n\n${HELP_TEXT}`);
            return error.exitCode;
        }
        throw error;
    }

    if (args.showHelp) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (args.showVersion) {
        process.stdout.write(`${readPackageVersion()}\n`);
        return 0;
    }

    if (args.diff !== null && args.execution !== null) {
        process.stderr.write(
            '--diff and --execution cannot be combined; pick one overlay per run\n',
        );
        return 1;
    }
    if (args.diff !== null && !OVERLAY_FORMATS.includes(args.format)) {
        process.stderr.write(
            `--diff supports --format svg, mermaid or html, not ${args.format}\n`,
        );
        return 1;
    }
    if (args.execution !== null && !OVERLAY_FORMATS.includes(args.format)) {
        process.stderr.write(
            `--execution supports --format svg, mermaid or html, not ${args.format}\n`,
        );
        return 1;
    }
    if (args.format === 'png' && !args.output) {
        process.stderr.write('--output is required when --format is png\n');
        return 1;
    }

    let aslSource: string;
    try {
        aslSource = await loadAsl(args.input);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to read input: ${message}\n`);
        return 1;
    }

    let baselineSource: string | null = null;
    if (args.diff !== null) {
        try {
            baselineSource = readFileSync(resolve(args.diff), 'utf-8');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            process.stderr.write(
                `Failed to read --diff baseline: ${message}\n`,
            );
            return 1;
        }
    }

    let historySource: string | null = null;
    if (args.execution !== null) {
        try {
            historySource = readFileSync(resolve(args.execution), 'utf-8');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            process.stderr.write(
                `Failed to read --execution history: ${message}\n`,
            );
            return 1;
        }
    }

    let definitionSource: AslDefinition | string;
    let baselineDefinition: AslDefinition | string | null = null;
    try {
        definitionSource = resolveDefinitionSource({
            resolveCfn: args.resolveCfn,
            resource: args.resource,
            source: aslSource,
        });
        if (baselineSource !== null) {
            baselineDefinition = resolveDefinitionSource({
                resolveCfn: args.resolveCfn,
                resource: args.resource,
                source: baselineSource,
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        return 1;
    }

    const sharedOptions = {
        catchHandling: args.hideCatch ? ('hide' as const) : ('show' as const),
        ...(args.hideVariables ? { showVariables: false } : {}),
        ...(args.collapse !== null ? { collapse: args.collapse } : {}),
    };
    const svgOptions = {
        ...sharedOptions,
        layout: args.layout,
        theme: args.theme,
        ...(args.showIcons ? { showIcons: true } : {}),
        ...(args.iconPosition !== null
            ? { iconPosition: args.iconPosition }
            : {}),
        ...(args.iconSize !== null ? { iconSize: args.iconSize } : {}),
    };

    /**
     * Wrap a diff or execution-overlay SVG in the interactive viewer, so
     * `--format html` is honoured alongside `--diff` / `--execution` rather than
     * silently falling back to raw SVG. Icons are inlined so the document stays
     * offline, matching the plain `--format html` path.
     */
    const toInteractiveHtml = async (
        svg: string,
        nodeCount: number,
    ): Promise<string> =>
        wrapSvgInInteractiveHtml({
            nodeCount,
            stateData: collectStateData({
                definition:
                    typeof definitionSource === 'string'
                        ? (JSON.parse(definitionSource) as AslDefinition)
                        : definitionSource,
            }),
            svg: await embedIcons({ svg }),
            theme: resolveViewerTheme({ theme: args.theme }),
        });

    try {
        if (baselineDefinition !== null) {
            if (args.format === 'mermaid') {
                const result = generateMermaidDiff({
                    after: definitionSource,
                    before: baselineDefinition,
                });
                writeDiffSummary(result.metadata);
                writeOutput(result.code, args.output);
                return 0;
            }

            const result = generateDiff({
                after: definitionSource,
                before: baselineDefinition,
                ...svgOptions,
            });
            writeDiffSummary(result.metadata);
            writeOutput(
                args.format === 'html'
                    ? await toInteractiveHtml(
                          result.svg,
                          result.metadata.nodeCount,
                      )
                    : result.svg,
                args.output,
            );
            return 0;
        }

        if (historySource !== null) {
            if (args.format === 'mermaid') {
                const result = generateMermaidExecution({
                    aslDefinition: definitionSource,
                    history: historySource,
                });
                writeExecutionSummary(result.metadata);
                writeOutput(result.code, args.output);
                return 0;
            }

            const result = generateExecution({
                aslDefinition: definitionSource,
                history: historySource,
                ...svgOptions,
            });
            writeExecutionSummary(result.metadata);
            writeOutput(
                args.format === 'html'
                    ? await toInteractiveHtml(
                          result.svg,
                          result.metadata.nodeCount,
                      )
                    : result.svg,
                args.output,
            );
            return 0;
        }

        if (args.format === 'mermaid') {
            const result = generateMermaid({
                aslDefinition: definitionSource,
                ...sharedOptions,
            });
            writeOutput(result.code, args.output);
            return 0;
        }

        if (args.format === 'svg') {
            const result = generateSvg({
                aslDefinition: definitionSource,
                ...svgOptions,
            });
            writeOutput(result.svg, args.output);
            return 0;
        }

        if (args.format === 'html') {
            const result = await generateHtmlAsync({
                aslDefinition: definitionSource,
                ...svgOptions,
            });
            writeOutput(result.html, args.output);
            return 0;
        }

        const result = await exportPng({
            aslDefinition: definitionSource,
            ...svgOptions,
        });
        writeFileSync(resolve(args.output as string), result.buffer);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        return 1;
    }
}

function writeOutput(content: string, outputPath: string | null): void {
    if (outputPath) {
        writeFileSync(resolve(outputPath), content, 'utf-8');
    } else {
        process.stdout.write(content);
        if (!content.endsWith('\n')) {
            process.stdout.write('\n');
        }
    }
}

// Only execute when invoked directly as the `sfn-diagram` bin, not when
// imported (e.g. by tests). The CLI is built ESM-only (see tsdown.config.ts),
// so comparing this module's URL to the invoked script is safe.
const invokedDirectly =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    void run(process.argv.slice(2)).then((code) => {
        // Set the exit code and let Node unwind on its own rather than calling
        // process.exit(). `--format html` embeds icons over fetch, and tearing the
        // process down while undici's sockets are still open aborts with a libuv
        // assertion (exit 9) on Windows. Unwinding naturally also avoids truncating
        // a large diagram when stdout is a pipe.
        process.exitCode = code;
    });
}
