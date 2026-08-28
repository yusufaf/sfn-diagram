#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractAslFromTemplate } from './cfn';
import { generateDiff, generateMermaidDiff } from './diff';
import { generateExecution, generateMermaidExecution } from './execution';
import { generateHtmlAsync, generateMermaid, generateSvg } from './index';
import { exportPng } from './png';
import { collectStateData, resolveViewerTheme, wrapSvgInInteractiveHtml } from './renderers';
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

Options:
  --format <svg|mermaid|png|html>  Output format (default: svg)
  -o, --output <path>              Output file path (required for png; stdout otherwise)
  --theme <light|dark>             Color theme for SVG/PNG (default: light)
  --layout <TB|LR|RL|BT>           Graph layout direction (default: TB)
  --hide-catch                     Drop error-handler (Catch) branches from the diagram
  --hide-variables                 Drop the "$var" annotations for ASL Assign blocks
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

export function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        diff: null,
        execution: null,
        format: 'svg',
        hideCatch: false,
        hideVariables: false,
        iconPosition: null,
        iconSize: null,
        input: null,
        layout: 'TB',
        output: null,
        resolveCfn: false,
        resource: null,
        showHelp: false,
        showIcons: false,
        showVersion: false,
        theme: 'light',
    };

    const validFormats: DiagramFormat[] = ['svg', 'mermaid', 'png', 'html'];
    const validIconPositions: IconPosition[] = ['left', 'top', 'right'];
    const validLayouts: LayoutDirection[] = ['TB', 'LR', 'RL', 'BT'];
    const validThemes = ['light', 'dark'] as const;

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
        if (arg === '-v' || arg === '--version') {
            args.showVersion = true;
            continue;
        }
        if (arg === '--format') {
            const value = expectValue(arg, argv[++index]);
            if (!validFormats.includes(value as DiagramFormat)) {
                throw new CliError(
                    `Invalid --format: ${value}. Expected one of: ${validFormats.join(', ')}`,
                    2
                );
            }
            args.format = value as DiagramFormat;
            continue;
        }
        if (arg === '-o' || arg === '--output') {
            args.output = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--theme') {
            const value = expectValue(arg, argv[++index]);
            if (!validThemes.includes(value as 'light' | 'dark')) {
                throw new CliError(
                    `Invalid --theme: ${value}. Expected one of: ${validThemes.join(', ')}`,
                    2
                );
            }
            args.theme = value as ThemeOption;
            continue;
        }
        if (arg === '--layout') {
            const value = expectValue(arg, argv[++index]);
            if (!validLayouts.includes(value as LayoutDirection)) {
                throw new CliError(
                    `Invalid --layout: ${value}. Expected one of: ${validLayouts.join(', ')}`,
                    2
                );
            }
            args.layout = value as LayoutDirection;
            continue;
        }
        if (arg === '--hide-catch') {
            args.hideCatch = true;
            continue;
        }
        if (arg === '--hide-variables') {
            args.hideVariables = true;
            continue;
        }
        if (arg === '--show-icons') {
            args.showIcons = true;
            continue;
        }
        if (arg === '--icon-position') {
            const value = expectValue(arg, argv[++index]);
            if (!validIconPositions.includes(value as IconPosition)) {
                throw new CliError(
                    `Invalid --icon-position: ${value}. Expected one of: ${validIconPositions.join(', ')}`,
                    2
                );
            }
            args.iconPosition = value as IconPosition;
            continue;
        }
        if (arg === '--icon-size') {
            const value = expectValue(arg, argv[++index]);
            const size = Number(value);
            if (!Number.isFinite(size) || size <= 0) {
                throw new CliError(
                    `Invalid --icon-size: ${value}. Expected a positive number of pixels`,
                    2
                );
            }
            args.iconSize = size;
            continue;
        }
        if (arg === '--diff') {
            args.diff = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--execution') {
            args.execution = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--resolve-cfn') {
            args.resolveCfn = true;
            continue;
        }
        if (arg === '--resource') {
            args.resource = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg.startsWith('--') || (arg.startsWith('-') && arg !== '-')) {
            throw new CliError(`Unknown flag: ${arg}`, 2);
        }
        if (args.input !== null) {
            throw new CliError(`Unexpected positional argument: ${arg}`, 2);
        }
        args.input = arg;
    }

    return args;
}

export class CliError extends Error {
    constructor(
        message: string,
        public exitCode: number
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
        const packageJson = JSON.parse(readFileSync(url, 'utf-8')) as { version: string };
        return packageJson.version;
    } catch {
        return 'unknown';
    }
}

function isCfnTemplate(source: string): boolean {
    try {
        const parsed = JSON.parse(source) as { Resources?: Record<string, unknown> };
        const resources = parsed?.Resources;
        return (
            !!resources &&
            Object.values(resources).some(
                (resource) =>
                    (resource as { Type?: string })?.Type === 'AWS::StepFunctions::StateMachine'
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
function resolveDefinitionSource(params: ResolveDefinitionSourceParams): AslDefinition | string {
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
function writeDiffSummary(metadata: DiffOutput['metadata'] | MermaidDiffOutput['metadata']): void {
    const { added, modified, removed, unchanged } = metadata;
    const lines: string[] = [];
    if (added.length > 0) lines.push(`  Added:     ${added.join(', ')}`);
    if (modified.length > 0) lines.push(`  Modified:  ${modified.join(', ')}`);
    if (removed.length > 0) lines.push(`  Removed:   ${removed.join(', ')}`);
    if (lines.length === 0) {
        lines.push(`  No changes (${unchanged.length} state${unchanged.length === 1 ? '' : 's'})`);
    } else {
        lines.push(`  Unchanged: ${unchanged.length}`);
    }
    process.stderr.write(`Diff summary:\n${lines.join('\n')}\n`);
}

/** Print the per-status state breakdown of an `--execution` run to stderr. */
function writeExecutionSummary(
    metadata: ExecutionOutput['metadata'] | MermaidExecutionOutput['metadata']
): void {
    const lines: string[] = [];
    for (const status of EXECUTION_STATUS_ORDER) {
        const names = metadata[status];
        if (names.length > 0) lines.push(`  ${status}: ${names.join(', ')}`);
    }
    process.stderr.write(
        `Execution summary (execution ${metadata.executionStatus}):\n${lines.join('\n')}\n`
    );
}

export async function run(argv: string[]): Promise<number> {
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
            '--diff and --execution cannot be combined; pick one overlay per run\n'
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
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Failed to read --diff baseline: ${message}\n`);
            return 1;
        }
    }

    let historySource: string | null = null;
    if (args.execution !== null) {
        try {
            historySource = readFileSync(resolve(args.execution), 'utf-8');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Failed to read --execution history: ${message}\n`);
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
    };
    const svgOptions = {
        ...sharedOptions,
        layout: args.layout,
        theme: args.theme,
        ...(args.showIcons ? { showIcons: true } : {}),
        ...(args.iconPosition !== null ? { iconPosition: args.iconPosition } : {}),
        ...(args.iconSize !== null ? { iconSize: args.iconSize } : {}),
    };

    /**
     * Wrap a diff or execution-overlay SVG in the interactive viewer, so
     * `--format html` is honoured alongside `--diff` / `--execution` rather than
     * silently falling back to raw SVG. Icons are inlined so the document stays
     * offline, matching the plain `--format html` path.
     */
    const toInteractiveHtml = async (svg: string, nodeCount: number): Promise<string> =>
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
                    ? await toInteractiveHtml(result.svg, result.metadata.nodeCount)
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
                    ? await toInteractiveHtml(result.svg, result.metadata.nodeCount)
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
