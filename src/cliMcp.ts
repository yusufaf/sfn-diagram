import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliConfig } from './cliConfig';
import {
    CliConfigError,
    MAX_PNG_SCALE,
    isValidPngScale,
    loadCliConfig,
} from './cliConfig';
import { serveMcp } from './cliMcpServer';
import type { McpTool, McpToolResult } from './cliMcpServer';
import { resolveCliOptions } from './cliOptions';
import type { CliOptionSource } from './cliOptions';
import { handleRenderRequest } from './cliRender';
import type {
    RenderDefinitionInput,
    RenderErrorResponse,
    RenderLintResponse,
    RenderOutputResponse,
} from './cliRender';
import { createLayoutCache } from './layout';
import type { LayoutCache } from './layout';
import type {
    CatchHandling,
    CatchLabelStyle,
    DiagramFormat,
    EdgePathStyle,
    ExecutionSummary,
    LayoutDirection,
    StylePreset,
} from './types';
import { stripBom } from './utils/bom';

/**
 * The most characters `render` and `diff` return inline. Larger svg or mermaid output
 * is refused with a pointer to `outputPath`: it stays under the 50,000 characters past
 * which Claude Code saves a tool result to a file instead of showing it to the model.
 */
export const MAX_INLINE_TEXT_CHARS = 40_000;

/** The most png bytes `render` returns inline, about 1 MB once base64-encoded. */
export const MAX_INLINE_PNG_BYTES = 750_000;

/**
 * The `outputSchema` of the `lint` tool: the `--check --check-format json` entry
 * without its `file` field. `code` is a plain string so a new lint rule never makes the
 * advertised schema reject real output.
 */
export const LINT_OUTPUT_SCHEMA: Record<string, unknown> = {
    properties: {
        diagnostics: {
            items: {
                properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    path: { type: 'string' },
                    severity: { enum: ['error', 'warning'] },
                },
                required: ['code', 'message', 'path', 'severity'],
                type: 'object',
            },
            type: 'array',
        },
        kind: { enum: ['lint', 'error'] },
        message: { type: 'string' },
        warnings: { items: { type: 'string' }, type: 'array' },
    },
    required: ['kind', 'warnings'],
    type: 'object',
};

export const MCP_HELP_TEXT = `Usage: sfn-diagram mcp [--config <path>]

Serve sfn-diagram to AI agents as a Model Context Protocol (MCP) server over stdio.
Reads JSON-RPC requests on stdin and writes responses on stdout; diagnostics go to
stderr. It makes no network requests unless a render asks for icons in html or png.

Tools:
  render   Draw a definition (ASL, a CloudFormation/SAM/CDK template or Terraform) as
           svg, mermaid, html or png, with an optional execution history overlay
  diff     Draw the changes between a baseline and a definition
  lint     Check a definition for structural problems

Paths in tool arguments are resolved against the directory the server starts in.

Options:
  --config <path>   Read defaults from this config file instead of searching for
                    sfn-diagram.config.{json,yaml,yml} from the working directory
  -h, --help        Show this help

Client setup:
  Claude Code:   claude mcp add sfn-diagram -- npx -y sfn-diagram mcp
  Other clients: command "npx", args ["-y", "sfn-diagram", "mcp"]

Guide: https://sfn.yusufaf.dev/guides/mcp/
`;

const INSTRUCTIONS =
    'Renders AWS Step Functions state machines as diagrams and lints them. ' +
    'Inputs are ASL JSON, CloudFormation/SAM/CDK templates or Terraform. Prefer path ' +
    'over source for files on disk: it saves sending the text. mermaid is the most ' +
    'compact text format; html, and svg or png larger than the inline limit, need ' +
    'outputPath, which writes the file and returns a short JSON summary. Settings ' +
    'from the project config file apply unless an argument overrides them.';

const LAYOUTS: readonly LayoutDirection[] = ['TB', 'LR', 'RL', 'BT'];
const THEMES: readonly ('auto' | 'dark' | 'light')[] = [
    'light',
    'dark',
    'auto',
];
const CATCH_HANDLING: readonly CatchHandling[] = ['show', 'hide'];
const CATCH_LABEL_STYLES: readonly CatchLabelStyle[] = [
    'error-type',
    'catch-number',
];
const EDGE_STYLES: readonly EdgePathStyle[] = [
    'straight',
    'curved',
    'orthogonal',
];
const STYLE_PRESETS: readonly StylePreset[] = ['aws-standard', 'enhanced'];
const RENDER_FORMATS: readonly DiagramFormat[] = [
    'svg',
    'mermaid',
    'html',
    'png',
];
const DIFF_FORMATS: readonly DiagramFormat[] = ['svg', 'mermaid', 'html'];

const DEFINITION_PROPERTIES: Record<string, unknown> = {
    path: {
        description:
            'Definition file to read, relative to the server working directory. Pass this or source.',
        type: 'string',
    },
    resolveCfn: {
        description:
            'Read the input as a CloudFormation/SAM/CDK template even when it is not detected as one, as YAML templates need.',
        type: 'boolean',
    },
    resource: {
        description:
            'Logical ID of the state machine to extract when the template declares several.',
        type: 'string',
    },
    source: {
        description: 'The definition text itself. Pass this or path.',
        type: 'string',
    },
};

const OUTPUT_PATH_PROPERTY: Record<string, unknown> = {
    description:
        'Write the diagram to this file (overwriting it) and return only a JSON summary. Required for html.',
    type: 'string',
};

const SHARED_OPTION_PROPERTIES: Record<string, unknown> = {
    catchHandling: { enum: CATCH_HANDLING },
    catchLabelStyle: { enum: CATCH_LABEL_STYLES },
    collapse: {
        anyOf: [
            { type: 'boolean' },
            { items: { type: 'string' }, type: 'array' },
        ],
        description:
            'Collapse Parallel and Map states into single nodes: true for all, or the names of the states to collapse.',
    },
    diagramTitle: { type: 'string' },
    edgeStyle: { enum: EDGE_STYLES },
    includeComments: { type: 'boolean' },
    layout: { description: 'Layout direction.', enum: LAYOUTS },
    showIcons: { type: 'boolean' },
    showStateTypes: { type: 'boolean' },
    showVariables: { type: 'boolean' },
    stylePreset: { enum: STYLE_PRESETS },
    theme: { enum: THEMES },
};

const RENDER_PROPERTIES: Record<string, unknown> = {
    ...DEFINITION_PROPERTIES,
    ...SHARED_OPTION_PROPERTIES,
    format: { enum: RENDER_FORMATS },
    history: {
        description:
            'Execution history JSON (GetExecutionHistory output) to overlay. Pass this or historyPath.',
        type: 'string',
    },
    historyPath: {
        description: 'File holding the execution history JSON to overlay.',
        type: 'string',
    },
    outputPath: OUTPUT_PATH_PROPERTY,
    scale: {
        description: 'PNG pixel density multiplier.',
        exclusiveMinimum: 0,
        maximum: MAX_PNG_SCALE,
        type: 'number',
    },
};

const DIFF_PROPERTIES: Record<string, unknown> = {
    ...DEFINITION_PROPERTIES,
    ...SHARED_OPTION_PROPERTIES,
    baseline: {
        description:
            'The definition text to compare against. Pass this or baselinePath.',
        type: 'string',
    },
    baselinePath: {
        description: 'File holding the definition to compare against.',
        type: 'string',
    },
    format: { enum: DIFF_FORMATS },
    outputPath: OUTPUT_PATH_PROPERTY,
};

/** A tool argument the model can fix: reported back to it as an `isError` result. */
class McpArgumentError extends Error {}

/** An input file that could not be read. `lint` reports it as a `kind: 'error'` entry. */
class McpReadError extends McpArgumentError {}

/** Parameters for {@link assertKnownArguments}. */
interface AssertKnownArgumentsParams {
    args: Record<string, unknown>;
    properties: Record<string, unknown>;
}

function assertKnownArguments(params: AssertKnownArgumentsParams): void {
    const { args, properties } = params;
    const allowed = Object.keys(properties);
    const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new McpArgumentError(
            `Unknown argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. ` +
                `Allowed: ${allowed.join(', ')}`,
        );
    }
}

/** Parameters for the single-argument readers. */
interface ReadArgumentParams {
    args: Record<string, unknown>;
    name: string;
}

function readOptionalString(params: ReadArgumentParams): string | null {
    const value = params.args[params.name];
    if (value === undefined) return null;
    if (typeof value !== 'string') {
        throw new McpArgumentError(`${params.name} must be a string`);
    }
    return value;
}

function readOptionalBoolean(params: ReadArgumentParams): boolean | null {
    const value = params.args[params.name];
    if (value === undefined) return null;
    if (typeof value !== 'boolean') {
        throw new McpArgumentError(`${params.name} must be true or false`);
    }
    return value;
}

/** Parameters for {@link readOptionalEnum}. */
interface ReadOptionalEnumParams<
    Value extends string,
> extends ReadArgumentParams {
    allowed: readonly Value[];
}

function readOptionalEnum<Value extends string>(
    params: ReadOptionalEnumParams<Value>,
): Value | null {
    const { allowed, args, name } = params;
    const value = args[name];
    if (value === undefined) return null;
    if (!allowed.includes(value as Value)) {
        throw new McpArgumentError(
            `${name} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`,
        );
    }
    return value as Value;
}

function readCollapse(params: {
    args: Record<string, unknown>;
}): string[] | boolean | null {
    const value = params.args.collapse;
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string')
    ) {
        return value as string[];
    }
    throw new McpArgumentError(
        'collapse must be true, false or an array of state names',
    );
}

function readScale(params: { args: Record<string, unknown> }): number | null {
    const value = params.args.scale;
    if (value === undefined) return null;
    if (!isValidPngScale(value)) {
        throw new McpArgumentError(
            `scale must be a number above 0 and at most ${MAX_PNG_SCALE}`,
        );
    }
    return value;
}

/** Parameters for {@link readTextInput}. */
interface ReadTextInputParams {
    args: Record<string, unknown>;
    /** The directory relative paths resolve against. */
    cwd: string;
    /** What the input is, for the read-failure message. */
    label: string;
    /** The argument naming a file to read. */
    pathKey: string;
    /** Whether one of the two arguments must be given. */
    required: boolean;
    /** The argument carrying the text inline. */
    sourceKey: string;
}

/** Text read from a file or passed inline, and the file's absolute path if any. */
interface TextInput {
    path: string | null;
    source: string;
}

/**
 * Read an input given either as a file path or inline, never both.
 *
 * @returns The text, or `null` when neither argument was given and none is required.
 */
function readTextInput(params: ReadTextInputParams): TextInput | null {
    const { args, cwd, label, pathKey, required, sourceKey } = params;
    const path = readOptionalString({ args, name: pathKey });
    const source = readOptionalString({ args, name: sourceKey });
    if (path !== null && source !== null) {
        throw new McpArgumentError(
            `Pass either ${pathKey} or ${sourceKey}, not both`,
        );
    }
    if (source !== null) return { path: null, source: stripBom(source) };
    if (path === null) {
        if (!required) return null;
        throw new McpArgumentError(
            `Pass ${pathKey} (a file to read) or ${sourceKey} (the text itself)`,
        );
    }
    const absolutePath = resolve(cwd, path);
    try {
        return {
            path: absolutePath,
            source: stripBom(readFileSync(absolutePath, 'utf-8')),
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new McpReadError(`Cannot read ${label} ${path}: ${reason}`);
    }
}

/** Parameters for {@link readDefinition}. */
interface ReadDefinitionParams {
    args: Record<string, unknown>;
    cwd: string;
}

/** The head definition and the reading flags that apply to every input of a call. */
function readDefinition(params: ReadDefinitionParams): RenderDefinitionInput {
    const { args, cwd } = params;
    const input = readTextInput({
        args,
        cwd,
        label: 'definition',
        pathKey: 'path',
        required: true,
        sourceKey: 'source',
    }) as TextInput;
    return {
        path: input.path,
        resolveCfn: readOptionalBoolean({ args, name: 'resolveCfn' }) ?? false,
        resource: readOptionalString({ args, name: 'resource' }),
        source: input.source,
    };
}

/** Parameters for {@link readOptionSource}. */
interface ReadOptionSourceParams {
    args: Record<string, unknown>;
    format: DiagramFormat | null;
    scale: number | null;
}

/**
 * The shared rendering options as a CLI option source. Everything a tool does not expose
 * stays `null`, so the config file and then the defaults supply it.
 */
function readOptionSource(params: ReadOptionSourceParams): CliOptionSource {
    const { args, format, scale } = params;
    return {
        backgroundColor: null,
        catchHandling: readOptionalEnum({
            allowed: CATCH_HANDLING,
            args,
            name: 'catchHandling',
        }),
        catchLabelStyle: readOptionalEnum({
            allowed: CATCH_LABEL_STYLES,
            args,
            name: 'catchLabelStyle',
        }),
        collapse: readCollapse({ args }),
        diagramDescription: null,
        diagramTitle: readOptionalString({ args, name: 'diagramTitle' }),
        edgeStyle: readOptionalEnum({
            allowed: EDGE_STYLES,
            args,
            name: 'edgeStyle',
        }),
        format,
        iconPosition: null,
        iconSize: null,
        includeComments: readOptionalBoolean({ args, name: 'includeComments' }),
        includeRawState: null,
        layout: readOptionalEnum({ allowed: LAYOUTS, args, name: 'layout' }),
        loadSystemFonts: null,
        nodeHeight: null,
        nodeSeparation: null,
        nodeWidth: null,
        padding: null,
        rankSeparation: null,
        redactFields: null,
        scale,
        showIcons: readOptionalBoolean({ args, name: 'showIcons' }),
        showStateTypes: readOptionalBoolean({ args, name: 'showStateTypes' }),
        showVariables: readOptionalBoolean({ args, name: 'showVariables' }),
        stylePreset: readOptionalEnum({
            allowed: STYLE_PRESETS,
            args,
            name: 'stylePreset',
        }),
        theme: readOptionalEnum({ allowed: THEMES, args, name: 'theme' }),
    };
}

/** The execution summary without its timeline, which can be large. */
function executionDigest(
    summary: ExecutionSummary,
): Omit<ExecutionSummary, 'timeline'> {
    const digest: Partial<ExecutionSummary> = { ...summary };
    delete digest.timeline;
    return digest as Omit<ExecutionSummary, 'timeline'>;
}

/** A failed call, as text for the model to act on. */
function errorResult(message: string): McpToolResult {
    return { content: [{ text: message, type: 'text' }], isError: true };
}

/** A service error, with any extraction warnings gathered before it. */
function serviceErrorResult(response: RenderErrorResponse): McpToolResult {
    const warnings = response.warnings.map(
        (warning) => `\nWarning: ${warning}`,
    );
    return errorResult(`${response.message}${warnings.join('')}`);
}

/** Parameters for {@link deliverRender}. */
interface DeliverRenderParams {
    cwd: string;
    /** Summary fields besides `bytes`, `format`, `outputPath` and `warnings`. */
    details: Record<string, unknown>;
    format: DiagramFormat;
    outputPath: string | null;
    response: RenderOutputResponse;
}

/**
 * Write a rendered diagram to `outputPath`, or return it inline when it fits.
 *
 * The summary goes in a JSON text block after the diagram, never in `structuredContent`:
 * Claude Code shows the model only `structuredContent` when a result has it, which
 * would hide the diagram.
 */
function deliverRender(params: DeliverRenderParams): McpToolResult {
    const { cwd, details, format, outputPath, response } = params;
    const { output, warnings } = response;
    const bytes =
        typeof output === 'string'
            ? Buffer.byteLength(output, 'utf8')
            : output.byteLength;

    if (outputPath !== null) {
        const absolutePath = resolve(cwd, outputPath);
        try {
            writeFileSync(absolutePath, output);
        } catch (error) {
            const reason =
                error instanceof Error ? error.message : String(error);
            return errorResult(`Cannot write ${outputPath}: ${reason}`);
        }
        const summary = {
            bytes,
            ...details,
            format,
            outputPath: absolutePath,
            warnings,
        };
        return { content: [{ text: JSON.stringify(summary), type: 'text' }] };
    }

    const summary = { bytes, ...details, format, outputPath: null, warnings };
    if (typeof output === 'string') {
        if (output.length > MAX_INLINE_TEXT_CHARS) {
            return errorResult(
                `${format} output is ${output.length.toLocaleString('en-US')} characters, ` +
                    `over the ${MAX_INLINE_TEXT_CHARS.toLocaleString('en-US')} inline limit ` +
                    'for agent context; pass outputPath to write it to a file, or use format mermaid',
            );
        }
        return {
            content: [
                { text: output, type: 'text' },
                { text: JSON.stringify(summary), type: 'text' },
            ],
        };
    }
    if (output.byteLength > MAX_INLINE_PNG_BYTES) {
        return errorResult(
            `png output is ${output.byteLength.toLocaleString('en-US')} bytes, over the ` +
                `${MAX_INLINE_PNG_BYTES.toLocaleString('en-US')} inline limit for agent ` +
                'context; pass outputPath to write it to a file, or lower scale',
        );
    }
    return {
        content: [
            {
                data: Buffer.from(output).toString('base64'),
                mimeType: 'image/png',
                type: 'image',
            },
            { text: JSON.stringify(summary), type: 'text' },
        ],
    };
}

/** A lint entry as both text and structured content, so every client shows the same. */
function lintResult(
    entry: RenderErrorResponse | RenderLintResponse,
): McpToolResult {
    const structured = entry as unknown as Record<string, unknown>;
    return {
        content: [{ text: JSON.stringify(structured), type: 'text' }],
        ...(entry.kind === 'error' ? { isError: true } : {}),
        structuredContent: structured,
    };
}

/** Parameters for {@link createMcpTools}. */
export interface CreateMcpToolsParams {
    /** The layout cache shared by every call the server makes. */
    cache: LayoutCache;
    /** The project config file, applied under every call's arguments. */
    config: CliConfig | null;
    /** The directory relative paths in arguments resolve against. */
    cwd: string;
    /** Whether this is the standalone binary, which cannot rasterize png. */
    standalone: boolean;
}

/**
 * Build the `render`, `diff` and `lint` MCP tools over the render service.
 *
 * Each tool reads its arguments, merges them over the config file with
 * `resolveCliOptions`, and hands one request to `handleRenderRequest`. Argument
 * mistakes come back as `isError` results that name the argument, so the model can
 * correct the call.
 *
 * @param params - The shared cache, config, working directory and build flavour
 *
 * @returns The three tools, in the order `render`, `diff`, `lint`.
 *
 * @example
 * ```ts
 * const tools = createMcpTools({
 *     cache: createLayoutCache(),
 *     config: null,
 *     cwd: process.cwd(),
 *     standalone: false,
 * });
 * await tools[0].call({ format: 'mermaid', path: 'flow.asl.json' });
 * ```
 */
export function createMcpTools(params: CreateMcpToolsParams): McpTool[] {
    const { cache, config, cwd, standalone } = params;

    const render: McpTool = {
        annotations: {
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: false,
        },
        call: async (args) => {
            assertKnownArguments({ args, properties: RENDER_PROPERTIES });
            const format = readOptionalEnum({
                allowed: RENDER_FORMATS,
                args,
                name: 'format',
            });
            if (format === null) {
                throw new McpArgumentError(
                    `format is required: one of ${RENDER_FORMATS.join(', ')}`,
                );
            }
            const scale = readScale({ args });
            if (scale !== null && format !== 'png') {
                return errorResult(
                    `scale only applies to format png, not ${format}`,
                );
            }
            const outputPath = readOptionalString({ args, name: 'outputPath' });
            if (format === 'html' && outputPath === null) {
                return errorResult(
                    'format html returns a self-contained document of several hundred ' +
                        'kilobytes; pass outputPath to write it to a file',
                );
            }
            if (format === 'png' && standalone) {
                return errorResult(
                    'format png is not available in the standalone binary: the native ' +
                        'rasterizer it needs cannot be bundled into a single-file ' +
                        'executable. Use the npm package instead (npx --package ' +
                        'sfn-diagram --package @resvg/resvg-js sfn-diagram mcp).',
                );
            }
            const options = resolveCliOptions({
                args: readOptionSource({ args, format, scale }),
                config,
            });
            const definition = readDefinition({ args, cwd });
            const history = readTextInput({
                args,
                cwd,
                label: 'execution history',
                pathKey: 'historyPath',
                required: false,
                sourceKey: 'history',
            });

            const response = await handleRenderRequest({
                baseline: null,
                cache,
                definition,
                history: history?.source ?? null,
                mode: 'render',
                options,
            });
            if (response.kind === 'error') return serviceErrorResult(response);
            if (response.kind !== 'render') {
                throw new Error(
                    `Unexpected ${response.kind} response to a render`,
                );
            }
            return deliverRender({
                cwd,
                details: {
                    execution:
                        response.execution === null
                            ? null
                            : executionDigest(response.execution),
                },
                format,
                outputPath,
                response,
            });
        },
        description:
            'Draw a Step Functions definition (ASL JSON, a CloudFormation/SAM/CDK ' +
            'template, or Terraform) as svg, mermaid, html or png, optionally with an ' +
            'execution history overlay. Returns the diagram, then a JSON summary. html ' +
            'needs outputPath; mermaid is the most compact.',
        inputSchema: {
            additionalProperties: false,
            properties: RENDER_PROPERTIES,
            required: ['format'],
            type: 'object',
        },
        name: 'render',
        title: 'Render a state machine diagram',
    };

    const diff: McpTool = {
        annotations: {
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: false,
        },
        call: async (args) => {
            assertKnownArguments({ args, properties: DIFF_PROPERTIES });
            const format = readOptionalEnum({
                allowed: DIFF_FORMATS,
                args,
                name: 'format',
            });
            if (format === null) {
                throw new McpArgumentError(
                    `format is required: one of ${DIFF_FORMATS.join(', ')}`,
                );
            }
            const outputPath = readOptionalString({ args, name: 'outputPath' });
            if (format === 'html' && outputPath === null) {
                return errorResult(
                    'format html returns a self-contained document of several hundred ' +
                        'kilobytes; pass outputPath to write it to a file',
                );
            }
            const options = resolveCliOptions({
                args: readOptionSource({ args, format, scale: null }),
                config,
            });
            const definition = readDefinition({ args, cwd });
            const baseline = readTextInput({
                args,
                cwd,
                label: 'baseline',
                pathKey: 'baselinePath',
                required: true,
                sourceKey: 'baseline',
            }) as TextInput;

            const response = await handleRenderRequest({
                baseline: {
                    path: baseline.path,
                    resolveCfn: definition.resolveCfn,
                    resource: definition.resource,
                    source: baseline.source,
                },
                cache,
                definition,
                history: null,
                mode: 'render',
                options,
            });
            if (response.kind === 'error') return serviceErrorResult(response);
            if (response.kind !== 'render') {
                throw new Error(
                    `Unexpected ${response.kind} response to a diff`,
                );
            }
            return deliverRender({
                cwd,
                details: { diff: response.diff },
                format,
                outputPath,
                response,
            });
        },
        description:
            'Draw what changed between a baseline definition and a new one, with ' +
            'added, removed and modified states highlighted. Returns the diagram, then ' +
            'a JSON summary listing the states in each group. html needs outputPath.',
        inputSchema: {
            additionalProperties: false,
            properties: DIFF_PROPERTIES,
            required: ['format'],
            type: 'object',
        },
        name: 'diff',
        title: 'Diff two state machine definitions',
    };

    const lint: McpTool = {
        annotations: {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
        },
        call: async (args) => {
            assertKnownArguments({ args, properties: DEFINITION_PROPERTIES });
            let definition: RenderDefinitionInput;
            try {
                definition = readDefinition({ args, cwd });
            } catch (error) {
                if (!(error instanceof McpReadError)) throw error;
                return lintResult({
                    kind: 'error',
                    message: error.message,
                    warnings: [],
                });
            }
            const response = await handleRenderRequest({
                baseline: null,
                cache,
                definition,
                history: null,
                mode: 'lint',
                options: resolveCliOptions({
                    args: readOptionSource({
                        args: {},
                        format: null,
                        scale: null,
                    }),
                    config,
                }),
            });
            if (response.kind === 'render') {
                throw new Error('Unexpected render response to a lint');
            }
            return lintResult(response);
        },
        description:
            'Check a Step Functions definition for structural problems such as ' +
            'transitions to missing states or unreachable states. Returns the ' +
            'diagnostics as JSON; error-severity findings are not a tool error.',
        inputSchema: {
            additionalProperties: false,
            properties: DEFINITION_PROPERTIES,
            type: 'object',
        },
        name: 'lint',
        outputSchema: LINT_OUTPUT_SCHEMA,
        title: 'Lint a state machine definition',
    };

    return [render, diff, lint];
}

/** Parameters for {@link runMcp}. */
export interface RunMcpParams {
    /** The arguments after `mcp`. */
    argv: string[];
    /** Whether this is the standalone binary, which cannot rasterize png. */
    standalone: boolean;
    /** The package version, sent as `serverInfo.version`. */
    version: string;
}

/**
 * Run `sfn-diagram mcp`: load the config file, then serve the MCP tools on stdio until
 * stdin closes.
 *
 * stdout carries only protocol messages. While serving, `console.log`, `console.info`
 * and `console.debug` go to stderr instead, so nothing below can corrupt the stream.
 *
 * @param params - The arguments after `mcp`, the build flavour and the version
 *
 * @returns The exit code: 0 once stdin closes or after `--help`, 1 for a config file
 *   that cannot be loaded, 2 for an unknown or malformed flag.
 *
 * @example
 * ```ts
 * process.exitCode = await runMcp({ argv: [], standalone: false, version: '2.1.0' });
 * ```
 */
export async function runMcp(params: RunMcpParams): Promise<number> {
    const { argv, standalone, version } = params;
    let values: { config?: string; help?: boolean };
    try {
        ({ values } = parseArgs({
            allowPositionals: false,
            args: argv,
            options: {
                config: { type: 'string' },
                help: { short: 'h', type: 'boolean' },
            },
            strict: true,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n\n${MCP_HELP_TEXT}`);
        return 2;
    }
    if (values.help) {
        process.stdout.write(MCP_HELP_TEXT);
        return 0;
    }

    let loaded: { config: CliConfig; path: string } | null;
    try {
        loaded = loadCliConfig({
            explicitPath: values.config ?? null,
            onWarning: ({ message }) => {
                process.stderr.write(`${message}\n`);
            },
            startDir: process.cwd(),
        });
    } catch (error) {
        if (!(error instanceof CliConfigError)) throw error;
        process.stderr.write(`Error: ${error.message}\n`);
        return 1;
    }
    if (loaded !== null) {
        process.stderr.write(
            `sfn-diagram mcp: read settings from ${loaded.path}\n`,
        );
    }

    // A client that hangs up mid-response must not crash the server with EPIPE.
    const onStdoutError = (error: NodeJS.ErrnoException): void => {
        if (error.code !== 'EPIPE') throw error;
    };
    process.stdout.on('error', onStdoutError);
    const { debug, info, log } = console;
    console.debug = console.error;
    console.info = console.error;
    console.log = console.error;
    try {
        await serveMcp({
            input: process.stdin,
            instructions: INSTRUCTIONS,
            output: process.stdout,
            serverInfo: { name: 'sfn-diagram', title: 'sfn-diagram', version },
            tools: createMcpTools({
                cache: createLayoutCache(),
                config: loaded?.config ?? null,
                cwd: process.cwd(),
                standalone,
            }),
        });
    } finally {
        console.debug = debug;
        console.info = info;
        console.log = log;
        process.stdout.off('error', onStdoutError);
    }
    return 0;
}
