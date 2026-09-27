import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs as parseArgsFromNode } from 'node:util';
import { extractAslFromTemplate } from './cfn';
import { runGitlabComment } from './ci/gitlab';
import type { ExecutionMode } from './ci/execution';
import { generateDiff, generateMermaidDiff } from './diff';
import { generateExecution, generateMermaidExecution } from './execution';
import { generateHtmlAsync, generateMermaid, generateSvg } from './index';
import { lintAsl } from './lint';
import { exportPng } from './png';
import type {
    AslDefinition,
    CatchLabelStyle,
    CustomTheme,
    DiagramFormat,
    DiffStateSummary,
    EdgePathStyle,
    ExecutionStateStatus,
    ExecutionSummary,
    LayoutDirection,
    LintDiagnostic,
    StylePreset,
    ThemeOption,
} from './types';

/** Placement of AWS service icons relative to the node label. */
export type IconPosition = 'left' | 'top' | 'right';

export interface CliArgs {
    backgroundColor: string | null;
    catchLabelStyle: CatchLabelStyle | null;
    check: boolean;
    collapse: string[] | boolean | null;
    diagramDescription: string | null;
    diagramTitle: string | null;
    diff: string | null;
    edgeStyle: EdgePathStyle | null;
    execution: string | null;
    format: DiagramFormat;
    hideCatch: boolean;
    hideComments: boolean;
    hideVariables: boolean;
    iconPosition: IconPosition | null;
    iconSize: number | null;
    input: string | null;
    layout: LayoutDirection;
    nodeHeight: number | null;
    nodeSeparation: number | null;
    nodeWidth: number | null;
    output: string | null;
    padding: number | null;
    rankSeparation: number | null;
    resolveCfn: boolean;
    resource: string | null;
    showHelp: boolean;
    showIcons: boolean;
    showStateTypes: boolean;
    showVersion: boolean;
    stylePreset: StylePreset | null;
    theme: ThemeOption;
    /**
     * Path to a custom theme JSON file, set when `--theme` was given anything other than
     * `light` or `dark`. When non-null it supersedes {@link CliArgs.theme} entirely, and
     * `theme` keeps its default — `run()` reads the file and resolves the two into one
     * value. Splitting it this way keeps `parseArgs` free of filesystem access, the same
     * way `diff` and `execution` carry a path rather than its contents.
     */
    themeFile: string | null;
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
  --theme <light|dark|path>        Color theme for SVG/PNG/HTML: a built-in name, or a
                                   path to a custom theme JSON file (default: light)
  --layout <TB|LR|RL|BT>           Graph layout direction (default: TB)
  --hide-catch                     Drop error-handler (Catch) branches from the diagram
  --hide-variables                 Drop the "$var" annotations for ASL Assign blocks
  --collapse[=names]               Collapse Parallel/Map containers into placeholders
                                   (bare flag collapses all; --collapse=Name1,Name2
                                   collapses only those states; write \\, for a
                                   comma inside a state name)
  --show-icons                     Draw AWS service icons on Task states
  --icon-position <left|top|right> Icon placement relative to the label (default: left)
  --icon-size <pixels>             Icon size in pixels (default: 24)
  --edge-style <straight|curved|orthogonal>
                                   Edge path style (default: curved)
  --style-preset <aws-standard|enhanced>
                                   Node shapes: AWS parity, or a distinct shape per
                                   state type (default: aws-standard)
  --catch-label-style <error-type|catch-number>
                                   Label on Catch edges: the error name, or "Catch #N"
                                   (default: error-type)
  --show-state-types               Draw each state's type as a label on the node
  --hide-comments                  Don't use a state's Comment as its node label
  --node-width <pixels>            Width of each state node (default: 120)
  --node-height <pixels>           Height of each state node (default: 60)
  --node-separation <pixels>       Separation between nodes in a rank (default: 50)
  --rank-separation <pixels>       Separation between ranks (default: 50)
  --padding <pixels>               Padding around the diagram (default: 20)
  --diagram-title <text>           Accessible name; the SVG's <title> and aria-label
  --diagram-description <text>     Accessible description; the SVG's <desc>
  --background-color <color>       PNG background (default: transparent). Only shows
                                   through when the theme's own background is
                                   transparent; light and dark paint over it.
  --diff <baseline>                Compare the input (head) against a baseline definition;
                                   added/modified/removed states are highlighted
  --execution <history.json>       Overlay a GetExecutionHistory result on the diagram
  --resolve-cfn                    Treat the input as a CloudFormation/SAM/CDK template
                                   (JSON templates are detected automatically)
  --resource <logicalId>           State machine to extract when the template has several
  --check                          Lint the definition instead of drawing it: print every
                                   diagnostic and exit 1 if any is an error
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

  --diff --format mermaid also ignores --hide-comments and --catch-label-style: it
  re-parses the merged definition without them. --theme and --layout do apply.

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
  sfn-diagram state.asl.json --check
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
    'background-color': { type: 'string' },
    'catch-label-style': { type: 'string' },
    check: { type: 'boolean' },
    collapse: { type: 'string' },
    'diagram-description': { type: 'string' },
    'diagram-title': { type: 'string' },
    diff: { type: 'string' },
    'edge-style': { type: 'string' },
    execution: { type: 'string' },
    format: { type: 'string' },
    help: { short: 'h', type: 'boolean' },
    'hide-catch': { type: 'boolean' },
    'hide-comments': { type: 'boolean' },
    'hide-variables': { type: 'boolean' },
    'icon-position': { type: 'string' },
    'icon-size': { type: 'string' },
    layout: { type: 'string' },
    'node-height': { type: 'string' },
    'node-separation': { type: 'string' },
    'node-width': { type: 'string' },
    output: { short: 'o', type: 'string' },
    padding: { type: 'string' },
    'rank-separation': { type: 'string' },
    'resolve-cfn': { type: 'boolean' },
    resource: { type: 'string' },
    'show-icons': { type: 'boolean' },
    'show-state-types': { type: 'boolean' },
    'style-preset': { type: 'string' },
    theme: { type: 'string' },
    version: { short: 'v', type: 'boolean' },
} as const;

const VALID_CATCH_LABEL_STYLES: readonly CatchLabelStyle[] = [
    'error-type',
    'catch-number',
];
const VALID_EDGE_STYLES: readonly EdgePathStyle[] = [
    'straight',
    'curved',
    'orthogonal',
];
const VALID_FORMATS: readonly DiagramFormat[] = [
    'svg',
    'mermaid',
    'png',
    'html',
];
const VALID_ICON_POSITIONS: readonly IconPosition[] = ['left', 'top', 'right'];
const VALID_LAYOUTS: readonly LayoutDirection[] = ['TB', 'LR', 'RL', 'BT'];
const VALID_STYLE_PRESETS: readonly StylePreset[] = [
    'aws-standard',
    'enhanced',
];

/**
 * The built-in theme names `--theme` accepts before falling back to reading its value
 * as a path to a custom theme JSON file.
 */
const BUILT_IN_THEMES: readonly ['light', 'dark'] = ['light', 'dark'];

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

interface ExpectPixelsParams {
    /** Whether 0 is an acceptable value (true for separations and padding). */
    allowZero: boolean;
    flag: string;
    value: string;
}

/**
 * Validate a flag's value as a number of pixels, or throw a `CliError`.
 *
 * A dimension has to be positive to draw anything, while a separation or a padding of
 * zero is a meaningful request, so which side of that line a flag falls on is the
 * caller's to state.
 *
 * @param params - Validation parameters
 * @param params.allowZero - Whether `0` is acceptable: true for separations and padding,
 *   false for a dimension that has to be drawable
 * @param params.flag - Flag name, used in the error message (e.g. `--node-width`)
 * @param params.value - Raw flag value as it arrived on the command line
 *
 * @returns The value as a number.
 *
 * @throws {CliError} With exit code 2 if the value is blank, not a finite number,
 *   negative, or zero when `allowZero` is false.
 *
 * @example
 * ```typescript
 * expectPixels({ allowZero: false, flag: '--node-width', value: '240' }); // 240
 * expectPixels({ allowZero: true, flag: '--padding', value: '0' }); // 0
 * expectPixels({ allowZero: false, flag: '--node-width', value: '0' }); // throws
 * ```
 */
function expectPixels(params: ExpectPixelsParams): number {
    const { allowZero, flag, value } = params;
    // Number('') and Number(' ') are both 0, so a blank value would otherwise pass
    // wherever zero is allowed.
    const parsed = value.trim() === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) {
        throw new CliError(
            `Invalid ${flag}: ${value}. Expected a ${allowZero ? 'non-negative' : 'positive'} number of pixels`,
            2,
        );
    }
    return parsed;
}

interface ExpectNonBlankParams {
    flag: string;
    value: string;
}

/**
 * Return a flag's value unchanged, or throw a `CliError` when it is blank.
 *
 * An empty value almost always means an unset shell variable (`--diagram-title
 * "$TITLE"`), and the alternatives are both worse than failing: an empty
 * `diagramTitle` replaces the accessible name with nothing, and an empty `--theme`
 * resolves to the working directory.
 *
 * @param params - Validation parameters
 * @param params.flag - Flag name, used in the error message (e.g. `--diagram-title`)
 * @param params.value - Raw flag value as it arrived on the command line
 *
 * @returns The value as given.
 *
 * @throws {CliError} With exit code 2 when the value is empty or only whitespace.
 *
 * @example
 * ```typescript
 * expectNonBlank({ flag: '--diagram-title', value: 'Order pipeline' }); // 'Order pipeline'
 * expectNonBlank({ flag: '--diagram-title', value: '' }); // throws
 * ```
 */
function expectNonBlank(params: ExpectNonBlankParams): string {
    const { flag, value } = params;
    if (value.trim() === '') {
        throw new CliError(`Invalid ${flag}: expected a non-empty value`, 2);
    }
    return value;
}

/**
 * Split a `--collapse=Name1,Name2` value into trimmed, non-empty state names.
 *
 * A state name may itself contain a comma (unusual, but valid ASL), so a comma
 * preceded by a backslash is kept as part of the name instead of ending it:
 * `--collapse='Fetch\, then merge'` targets the single state `Fetch, then merge`.
 */
function parseCollapseNames(value: string): string[] {
    return value
        .split(/(?<!\\),/)
        .map((name) => name.replaceAll('\\,', ',').trim())
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

    /**
     * Read one pixel-valued flag, or `null` when it was not given. The flag name in the
     * error message is derived from the spec key, so the two cannot drift apart.
     */
    const readPixels = (
        key:
            | 'icon-size'
            | 'node-height'
            | 'node-separation'
            | 'node-width'
            | 'padding'
            | 'rank-separation',
        allowZero: boolean,
    ): number | null => {
        const raw = values[key] as string | undefined;
        return raw === undefined
            ? null
            : expectPixels({ allowZero, flag: `--${key}`, value: raw });
    };

    // `--theme` takes a built-in name or a path to a custom theme JSON file. The path is
    // carried through as-is and read in `run()`, the way `--diff` and `--execution` are,
    // so `parseArgs` stays free of filesystem access.
    const themeValue =
        values.theme === undefined
            ? undefined
            : expectNonBlank({
                  flag: '--theme',
                  value: values.theme as string,
              });
    const isBuiltInTheme = (value: string): value is 'dark' | 'light' =>
        (BUILT_IN_THEMES as readonly string[]).includes(value);

    return {
        backgroundColor:
            values['background-color'] === undefined
                ? null
                : expectNonBlank({
                      flag: '--background-color',
                      value: values['background-color'] as string,
                  }),
        catchLabelStyle:
            values['catch-label-style'] === undefined
                ? null
                : expectEnum({
                      allowed: VALID_CATCH_LABEL_STYLES,
                      flag: '--catch-label-style',
                      value: values['catch-label-style'] as string,
                  }),
        check: values.check === true,
        collapse:
            collapseValue === undefined
                ? null
                : collapseValue === BARE_COLLAPSE_SENTINEL
                  ? true
                  : parseCollapseNames(collapseValue),
        diagramDescription:
            values['diagram-description'] === undefined
                ? null
                : expectNonBlank({
                      flag: '--diagram-description',
                      value: values['diagram-description'] as string,
                  }),
        diagramTitle:
            values['diagram-title'] === undefined
                ? null
                : expectNonBlank({
                      flag: '--diagram-title',
                      value: values['diagram-title'] as string,
                  }),
        diff: (values.diff as string | undefined) ?? null,
        edgeStyle:
            values['edge-style'] === undefined
                ? null
                : expectEnum({
                      allowed: VALID_EDGE_STYLES,
                      flag: '--edge-style',
                      value: values['edge-style'] as string,
                  }),
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
        hideComments: values['hide-comments'] === true,
        hideVariables: values['hide-variables'] === true,
        iconPosition:
            values['icon-position'] === undefined
                ? null
                : expectEnum({
                      allowed: VALID_ICON_POSITIONS,
                      flag: '--icon-position',
                      value: values['icon-position'] as string,
                  }),
        iconSize: readPixels('icon-size', false),
        input: positionals[0] ?? null,
        layout:
            values.layout === undefined
                ? 'TB'
                : expectEnum({
                      allowed: VALID_LAYOUTS,
                      flag: '--layout',
                      value: values.layout as string,
                  }),
        nodeHeight: readPixels('node-height', false),
        nodeSeparation: readPixels('node-separation', true),
        nodeWidth: readPixels('node-width', false),
        output: (values.output as string | undefined) ?? null,
        padding: readPixels('padding', true),
        rankSeparation: readPixels('rank-separation', true),
        resolveCfn: values['resolve-cfn'] === true,
        resource: (values.resource as string | undefined) ?? null,
        showHelp: values.help === true,
        showIcons: values['show-icons'] === true,
        showStateTypes: values['show-state-types'] === true,
        showVersion: values.version === true,
        stylePreset:
            values['style-preset'] === undefined
                ? null
                : expectEnum({
                      allowed: VALID_STYLE_PRESETS,
                      flag: '--style-preset',
                      value: values['style-preset'] as string,
                  }),
        theme:
            themeValue !== undefined && isBuiltInTheme(themeValue)
                ? themeValue
                : 'light',
        themeFile:
            themeValue !== undefined && !isBuiltInTheme(themeValue)
                ? themeValue
                : null,
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

/**
 * Build-time constant set by `scripts/build-binaries.mjs` for the standalone
 * (bun-compiled) executables. Undefined in the npm-published CLI, where the
 * version comes from package.json at runtime and PNG export is available.
 */
declare const __SFN_DIAGRAM_BUILD__:
    { standalone: boolean; version: string } | undefined;

function readBuildInfo(): { standalone: boolean; version: string } | undefined {
    return typeof __SFN_DIAGRAM_BUILD__ === 'undefined'
        ? undefined
        : __SFN_DIAGRAM_BUILD__;
}

function readPackageVersion(): string {
    const buildInfo = readBuildInfo();
    if (buildInfo) {
        return buildInfo.version;
    }
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

/**
 * Print `--check` diagnostics to stderr, one per line, followed by a count.
 * Nothing goes to stdout: a clean run is silent apart from the count, so the
 * command composes with `&&` the same way a linter does.
 */
function writeLintReport(diagnostics: LintDiagnostic[]): void {
    const lines = diagnostics.map(
        ({ code, message, path, severity }) =>
            `${severity.padEnd(7)} ${path || '/'}  ${message}  [${code}]`,
    );
    const errors = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
    ).length;
    const warnings = diagnostics.length - errors;
    const plural = (count: number, noun: string): string =>
        `${count} ${noun}${count === 1 ? '' : 's'}`;
    lines.push(
        diagnostics.length === 0
            ? 'No problems found'
            : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`,
    );
    process.stderr.write(`${lines.join('\n')}\n`);
}

/** Print the added/modified/removed breakdown of a `--diff` run to stderr. */
function writeDiffSummary(metadata: DiffStateSummary): void {
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
function writeExecutionSummary(metadata: ExecutionSummary): void {
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
    if (
        args.check &&
        (args.diff !== null || args.execution !== null || args.output !== null)
    ) {
        process.stderr.write(
            '--check lints the input only; it cannot be combined with --diff, --execution or --output\n',
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
    if (args.format === 'png' && !args.check && readBuildInfo()?.standalone) {
        process.stderr.write(
            '--format png is not available in the standalone binary: the native ' +
                'rasterizer it needs cannot be bundled into a single-file executable. ' +
                'Use the npm package instead ' +
                '(npx --package sfn-diagram --package @resvg/resvg-js sfn-diagram …).\n',
        );
        return 1;
    }
    if (args.format === 'png' && !args.check && !args.output) {
        process.stderr.write('--output is required when --format is png\n');
        return 1;
    }

    // With no input argument, loadAsl falls through to readStdin(). On a terminal
    // that stdin never ends, so a bare invocation would block forever - print usage
    // instead. An explicit `-` still reads stdin: the user asked for it.
    if (args.input === null && process.stdin.isTTY) {
        process.stderr.write(HELP_TEXT);
        return 2;
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

    if (args.check) {
        const diagnostics = lintAsl({ definition: definitionSource });
        writeLintReport(diagnostics);
        return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
            ? 1
            : 0;
    }

    // Resolved after `--check`, which lints rather than drawing and so needs no theme.
    let theme: ThemeOption = args.theme;
    if (args.themeFile !== null) {
        try {
            const parsed: unknown = JSON.parse(
                readFileSync(resolve(args.themeFile), 'utf-8'),
            );
            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                Array.isArray(parsed)
            ) {
                throw new Error(
                    'Expected a JSON object describing a custom theme',
                );
            }
            theme = parsed as CustomTheme;
        } catch (error) {
            const reason =
                error instanceof Error ? error.message : String(error);
            process.stderr.write(
                `Error: Cannot read theme file ${args.themeFile}: ${reason}\n` +
                    `--theme takes ${BUILT_IN_THEMES.join(', ')}, or a path to a theme JSON file.\n`,
            );
            return 2;
        }
    }

    const sharedOptions = {
        catchHandling: args.hideCatch ? ('hide' as const) : ('show' as const),
        ...(args.catchLabelStyle !== null
            ? { catchLabelStyle: args.catchLabelStyle }
            : {}),
        ...(args.collapse !== null ? { collapse: args.collapse } : {}),
        ...(args.hideComments ? { includeComments: false } : {}),
        ...(args.hideVariables ? { showVariables: false } : {}),
    };
    const svgOptions = {
        ...sharedOptions,
        layout: args.layout,
        theme,
        ...(args.backgroundColor !== null
            ? { backgroundColor: args.backgroundColor }
            : {}),
        ...(args.diagramDescription !== null
            ? { diagramDescription: args.diagramDescription }
            : {}),
        ...(args.diagramTitle !== null
            ? { diagramTitle: args.diagramTitle }
            : {}),
        // Clickable edges are only wanted where a viewer is wired up. `--format svg`
        // must stay byte-identical, and generateHtmlAsync forces this on regardless.
        ...(args.format === 'html' ? { edgeHitAreas: true } : {}),
        ...(args.edgeStyle !== null ? { edgeStyle: args.edgeStyle } : {}),
        ...(args.iconPosition !== null
            ? { iconPosition: args.iconPosition }
            : {}),
        ...(args.iconSize !== null ? { iconSize: args.iconSize } : {}),
        ...(args.nodeHeight !== null ? { nodeHeight: args.nodeHeight } : {}),
        ...(args.nodeSeparation !== null
            ? { nodeSeparation: args.nodeSeparation }
            : {}),
        ...(args.nodeWidth !== null ? { nodeWidth: args.nodeWidth } : {}),
        ...(args.padding !== null ? { padding: args.padding } : {}),
        ...(args.rankSeparation !== null
            ? { rankSeparation: args.rankSeparation }
            : {}),
        ...(args.showIcons ? { showIcons: true } : {}),
        ...(args.showStateTypes ? { showStateTypes: true } : {}),
        ...(args.stylePreset !== null ? { stylePreset: args.stylePreset } : {}),
    };

    try {
        if (baselineDefinition !== null) {
            if (args.format === 'mermaid') {
                const result = generateMermaidDiff({
                    after: definitionSource,
                    before: baselineDefinition,
                    layout: args.layout,
                    theme,
                });
                writeDiffSummary(result.metadata);
                writeOutput(result.code, args.output);
                return 0;
            }

            if (args.format === 'html') {
                // The viewer applies the diff itself; icons are inlined so the document
                // stays offline, matching the plain `--format html` path.
                const result = await generateHtmlAsync({
                    aslDefinition: definitionSource,
                    diff: { before: baselineDefinition },
                    ...svgOptions,
                });
                if (result.metadata.diff)
                    writeDiffSummary(result.metadata.diff);
                writeOutput(result.html, args.output);
                return 0;
            }

            const result = generateDiff({
                after: definitionSource,
                before: baselineDefinition,
                ...svgOptions,
            });
            writeDiffSummary(result.metadata);
            writeOutput(result.svg, args.output);
            return 0;
        }

        if (historySource !== null) {
            if (args.format === 'mermaid') {
                const result = generateMermaidExecution({
                    aslDefinition: definitionSource,
                    history: historySource,
                    layout: args.layout,
                    theme,
                });
                writeExecutionSummary(result.metadata);
                writeOutput(result.code, args.output);
                return 0;
            }

            if (args.format === 'html') {
                const result = await generateHtmlAsync({
                    aslDefinition: definitionSource,
                    history: historySource,
                    ...svgOptions,
                });
                if (result.metadata.execution)
                    writeExecutionSummary(result.metadata.execution);
                writeOutput(result.html, args.output);
                return 0;
            }

            const result = generateExecution({
                aslDefinition: definitionSource,
                history: historySource,
                ...svgOptions,
            });
            writeExecutionSummary(result.metadata);
            writeOutput(result.svg, args.output);
            return 0;
        }

        if (args.format === 'mermaid') {
            const result = generateMermaid({
                aslDefinition: definitionSource,
                ...sharedOptions,
                layout: args.layout,
                theme,
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
