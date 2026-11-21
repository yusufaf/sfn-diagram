import { extractAslFromTemplate } from './cfn';
import { STATE_MACHINE_TYPES } from './cfn/extract';
import type { ResolvedCliOptions } from './cliOptions';
import { buildCliRedact } from './cliRedact';
import { generateDiff, generateMermaidDiff } from './diff';
import { generateExecution, generateMermaidExecution } from './execution';
import { renderPng } from './exporters/renderPng';
import { generateHtmlAsync } from './html';
import { generateMermaid, generateSvg } from './index';
import type { LayoutCache } from './layout';
import { lintAsl } from './lint';
import { extractAslFromTerraform } from './terraform';
import { TERRAFORM_EXTENSIONS, isTerraformConfig } from './terraform/extract';
import type {
    AslDefinition,
    DiagramFormat,
    DiffStateSummary,
    ExecutionSummary,
    LintDiagnostic,
} from './types';

/**
 * Formats that have a diff / execution-overlay renderer. `html` qualifies because
 * the overlay SVG is wrapped in the interactive viewer; `png` still does not.
 */
export const OVERLAY_FORMATS: readonly DiagramFormat[] = [
    'html',
    'mermaid',
    'svg',
];

/** One definition's raw text and how to read it. */
export interface RenderDefinitionInput {
    /**
     * The file name the text came from, or `null` for stdin and live sources. Only its
     * extension is read (`.tf` / `.tf.json` mean Terraform); nothing is opened.
     */
    path: string | null;
    /**
     * Read the text as a CloudFormation/SAM/CDK template even when auto-detection would
     * not, which is what a YAML template needs.
     */
    resolveCfn: boolean;
    /** The resource to extract when the template or configuration declares several. */
    resource: string | null;
    /** The raw text: ASL JSON, a template, or a Terraform configuration. */
    source: string;
}

/** Parameters for {@link handleRenderRequest}. */
export interface HandleRenderRequestParams {
    /** The `--diff` baseline, or `null` for no diff overlay. */
    baseline: RenderDefinitionInput | null;
    /**
     * The layout cache shared across requests. A fresh cache per call would never hit.
     * Mermaid paths ignore it.
     */
    cache: LayoutCache;
    /** The definition to render or lint. */
    definition: RenderDefinitionInput;
    /** Execution history JSON text, or `null` for no execution overlay. */
    history: string | null;
    /**
     * PNG only: the largest image to rasterize, width x height in pixels after scale.
     * Over it the request comes back as `kind: 'error'` before icons are fetched or the
     * rasterizer runs. Omitted, there is no limit, as for the CLI and MCP.
     */
    maxPngPixels?: number;
    /** `'lint'` runs the linter instead of rendering; `'render'` produces a diagram. */
    mode: 'lint' | 'render';
    /** The effective diagram options, with the theme already resolved. */
    options: ResolvedCliOptions;
}

/** A request that could not be served: extraction or rendering failed. */
export interface RenderErrorResponse {
    kind: 'error';
    /** What went wrong, without any input label. */
    message: string;
    /** Extraction warnings gathered before the failure. */
    warnings: string[];
}

/** The linter's findings for a `mode: 'lint'` request. */
export interface RenderLintResponse {
    diagnostics: LintDiagnostic[];
    kind: 'lint';
    /** Extraction warnings, head first, then baseline. */
    warnings: string[];
}

/** A rendered diagram and the summaries of any overlay applied to it. */
export interface RenderOutputResponse {
    /** The diff summary when a baseline was given, otherwise `null`. */
    diff: DiffStateSummary | null;
    /** The execution summary when a history was given, otherwise `null`. */
    execution: ExecutionSummary | null;
    kind: 'render';
    /** The diagram: text for svg, mermaid and html, bytes for png. */
    output: string | Uint8Array;
    /** Extraction warnings, head first, then baseline. */
    warnings: string[];
}

/** What {@link handleRenderRequest} returns. Every kind carries `warnings`. */
export type RenderResponse =
    RenderErrorResponse | RenderLintResponse | RenderOutputResponse;

/** A resolved definition and the warnings its extraction produced. */
interface ResolvedDefinition {
    definition: AslDefinition | string;
    warnings: string[];
}

/** Parameters for {@link renderResolved}. */
interface RenderResolvedParams {
    baseline: AslDefinition | string | null;
    cache: LayoutCache;
    definition: AslDefinition | string;
    history: string | null;
    maxPngPixels?: number;
    options: ResolvedCliOptions;
}

function isCfnTemplate(source: string): boolean {
    try {
        const parsed = JSON.parse(source) as {
            Resources?: Record<string, unknown>;
        };
        const resources = parsed?.Resources;
        return (
            !!resources &&
            Object.values(resources).some((resource) =>
                STATE_MACHINE_TYPES.includes(
                    (resource as { Type?: string })?.Type ?? '',
                ),
            )
        );
    } catch {
        // Non-JSON (e.g. YAML template or raw ASL) — auto-detect stays a no-op;
        // users pass --resolve-cfn for YAML templates.
        return false;
    }
}

interface IsTerraformInputParams {
    /** The input file's path, or null for stdin and live sources. */
    path: string | null;
    source: string;
}

/**
 * Whether the input is Terraform: a `.tf` or `.tf.json` file by extension, or any input whose
 * contents declare an `aws_sfn_state_machine` (stdin and extensionless files).
 */
function isTerraformInput(params: IsTerraformInputParams): boolean {
    const { path, source } = params;
    const lowerPath = path?.toLowerCase();
    return (
        (lowerPath !== undefined &&
            TERRAFORM_EXTENSIONS.some((extension) =>
                lowerPath.endsWith(extension),
            )) ||
        isTerraformConfig({ source })
    );
}

/**
 * Turn a raw file body into something the generators accept: a Terraform configuration or a
 * CloudFormation/SAM/CDK template is unwrapped to its ASL definition, anything else is passed
 * through as-is. Terraform is checked first, so `resolveCfn` on a `.tf` file still reads it
 * as Terraform.
 *
 * @throws When a template or configuration has no usable state machine.
 */
function resolveDefinition(input: RenderDefinitionInput): ResolvedDefinition {
    const { path, resolveCfn, resource, source } = input;
    if (isTerraformInput({ path, source })) {
        const { aslDefinition, warnings } = extractAslFromTerraform({
            config: source,
            resourceId: resource ?? undefined,
        });
        return { definition: aslDefinition, warnings };
    }
    if (!resolveCfn && !isCfnTemplate(source)) {
        return { definition: source, warnings: [] };
    }
    const { aslDefinition, warnings } = extractAslFromTemplate({
        resourceId: resource ?? undefined,
        template: source,
    });
    return { definition: aslDefinition, warnings };
}

/** A thrown value's message. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Render resolved definitions in the requested format, with any diff or execution
 * overlay.
 *
 * @throws Whatever the generator throws for an invalid definition or history.
 */
async function renderResolved(
    params: RenderResolvedParams,
): Promise<Omit<RenderOutputResponse, 'warnings'>> {
    const { baseline, cache, definition, history, maxPngPixels, options } = params;
    const { theme } = options;

    const sharedOptions = {
        catchHandling: options.catchHandling,
        ...(options.catchLabelStyle !== null
            ? { catchLabelStyle: options.catchLabelStyle }
            : {}),
        ...(options.collapse !== null ? { collapse: options.collapse } : {}),
        ...(options.customColors !== null
            ? { customColors: options.customColors }
            : {}),
        ...(options.includeComments !== null
            ? { includeComments: options.includeComments }
            : {}),
        ...(options.showVariables !== null
            ? { showVariables: options.showVariables }
            : {}),
    };
    const svgOptions = {
        ...sharedOptions,
        cache,
        layout: options.layout,
        theme,
        ...(options.backgroundColor !== null
            ? { backgroundColor: options.backgroundColor }
            : {}),
        ...(options.diagramDescription !== null
            ? { diagramDescription: options.diagramDescription }
            : {}),
        ...(options.diagramTitle !== null
            ? { diagramTitle: options.diagramTitle }
            : {}),
        // Clickable edges are only wanted where a viewer is wired up. `--format svg`
        // must stay byte-identical, and generateHtmlAsync forces this on regardless.
        ...(options.format === 'html' ? { edgeHitAreas: true } : {}),
        ...(options.edgeOverrides !== null
            ? { edgeOverrides: options.edgeOverrides }
            : {}),
        ...(options.edgeStyle !== null ? { edgeStyle: options.edgeStyle } : {}),
        ...(options.iconPosition !== null
            ? { iconPosition: options.iconPosition }
            : {}),
        ...(options.iconSize !== null ? { iconSize: options.iconSize } : {}),
        ...(options.nodeHeight !== null
            ? { nodeHeight: options.nodeHeight }
            : {}),
        ...(options.nodeOverrides !== null
            ? { nodeOverrides: options.nodeOverrides }
            : {}),
        ...(options.nodeSeparation !== null
            ? { nodeSeparation: options.nodeSeparation }
            : {}),
        ...(options.nodeWidth !== null ? { nodeWidth: options.nodeWidth } : {}),
        ...(options.padding !== null ? { padding: options.padding } : {}),
        ...(options.rankSeparation !== null
            ? { rankSeparation: options.rankSeparation }
            : {}),
        ...(options.showIcons !== null ? { showIcons: options.showIcons } : {}),
        ...(options.showStateTypes !== null
            ? { showStateTypes: options.showStateTypes }
            : {}),
        ...(options.stylePreset !== null
            ? { stylePreset: options.stylePreset }
            : {}),
    };

    if (options.format === 'html') {
        // The viewer applies either overlay, or both at once, itself; icons are
        // inlined so the document stays offline.
        const redact = buildCliRedact({
            fields: options.redactFields,
            includeRawState: options.includeRawState,
        });
        const result = await generateHtmlAsync({
            aslDefinition: definition,
            ...(baseline !== null ? { diff: { before: baseline } } : {}),
            ...(history !== null ? { history } : {}),
            ...(redact ? { redact } : {}),
            ...svgOptions,
        });
        return {
            diff: result.metadata.diff ?? null,
            execution: result.metadata.execution ?? null,
            kind: 'render',
            output: result.html,
        };
    }

    if (baseline !== null) {
        if (options.format === 'mermaid') {
            const result = generateMermaidDiff({
                after: definition,
                before: baseline,
                ...sharedOptions,
                layout: options.layout,
                theme,
            });
            return {
                diff: result.metadata,
                execution: null,
                kind: 'render',
                output: result.code,
            };
        }

        const result = generateDiff({
            after: definition,
            before: baseline,
            ...svgOptions,
        });
        return {
            diff: result.metadata,
            execution: null,
            kind: 'render',
            output: result.svg,
        };
    }

    if (history !== null) {
        if (options.format === 'mermaid') {
            const result = generateMermaidExecution({
                aslDefinition: definition,
                history,
                ...sharedOptions,
                layout: options.layout,
                theme,
            });
            return {
                diff: null,
                execution: result.metadata,
                kind: 'render',
                output: result.code,
            };
        }

        const result = generateExecution({
            aslDefinition: definition,
            history,
            ...svgOptions,
        });
        return {
            diff: null,
            execution: result.metadata,
            kind: 'render',
            output: result.svg,
        };
    }

    if (options.format === 'mermaid') {
        const result = generateMermaid({
            aslDefinition: definition,
            ...sharedOptions,
            layout: options.layout,
            theme,
        });
        return {
            diff: null,
            execution: null,
            kind: 'render',
            output: result.code,
        };
    }

    if (options.format === 'svg') {
        const result = generateSvg({
            aslDefinition: definition,
            ...svgOptions,
        });
        return {
            diff: null,
            execution: null,
            kind: 'render',
            output: result.svg,
        };
    }

    // Left out rather than passed as undefined when unset: the library falls back to
    // SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS only when loadSystemFonts is absent.
    const result = await renderPng({
        aslDefinition: definition,
        ...svgOptions,
        ...(options.loadSystemFonts !== null
            ? { loadSystemFonts: options.loadSystemFonts }
            : {}),
        ...(maxPngPixels !== undefined ? { maxPixels: maxPngPixels } : {}),
        ...(options.scale !== null ? { scale: options.scale } : {}),
    });
    return {
        diff: null,
        execution: null,
        kind: 'render',
        output: result.buffer,
    };
}

/**
 * Detect what kind of input a definition is, unwrap it to ASL, then lint it or render it.
 *
 * This is the render service the CLI is an adapter over, and the one an MCP server or an
 * HTTP `serve` mode would adapt over too: one plain request in, the output, warnings and
 * lint findings out. The module does no argv, process or filesystem access of its own.
 * The caller reads the inputs, reports the warnings and writes the output. One exception
 * sits below it: `format: 'png'` goes through `renderPng` (the implementation behind
 * `sfn-diagram/png`'s `exportPng`), which may read the
 * `SFN_DIAGRAM_PNG_*` font environment variables and probe system font files
 * (`src/exporters/pngFonts.ts`).
 *
 * @param params - The request (see {@link HandleRenderRequestParams}).
 *
 * @returns A response the caller switches on by `kind`. It never rejects: a failed
 *   extraction or render comes back as `kind: 'error'`. Every kind carries the
 *   extraction warnings, head first, then baseline, so the head's warnings survive a
 *   baseline that fails to extract. Lint mode ignores `history`, but still resolves the
 *   baseline, as `--check` always has.
 *
 * @example
 * ```ts
 * const response = await handleRenderRequest({
 *     baseline: null,
 *     cache: createLayoutCache(),
 *     definition: { path: null, resolveCfn: false, resource: null, source: aslText },
 *     history: null,
 *     mode: 'render',
 *     options: resolveCliOptions({ args, config: null }),
 * });
 * if (response.kind === 'render') console.log(response.output);
 * ```
 */
export async function handleRenderRequest(
    params: HandleRenderRequestParams,
): Promise<RenderResponse> {
    const { baseline, cache, definition, history, maxPngPixels, mode, options } = params;
    const { format } = options;

    // Unreachable from the CLI, whose flag-worded refusals run first. They stop another
    // front end from asking for a png diff and silently getting a plain diagram back.
    if (mode === 'render') {
        if (baseline !== null && history !== null && format !== 'html') {
            return {
                kind: 'error',
                message: `a diff and an execution overlay can only be combined in html output, not ${format}`,
                warnings: [],
            };
        }
        if (
            (baseline !== null || history !== null) &&
            !OVERLAY_FORMATS.includes(format)
        ) {
            return {
                kind: 'error',
                message: `diff and execution overlays support svg, mermaid or html output, not ${format}`,
                warnings: [],
            };
        }
    }

    const warnings: string[] = [];
    let head: AslDefinition | string;
    let before: AslDefinition | string | null = null;
    try {
        const resolvedHead = resolveDefinition(definition);
        warnings.push(...resolvedHead.warnings);
        head = resolvedHead.definition;
        if (baseline !== null) {
            const resolvedBaseline = resolveDefinition(baseline);
            warnings.push(...resolvedBaseline.warnings);
            before = resolvedBaseline.definition;
        }
    } catch (error) {
        return { kind: 'error', message: errorMessage(error), warnings };
    }

    if (mode === 'lint') {
        return {
            diagnostics: lintAsl({ definition: head }),
            kind: 'lint',
            warnings,
        };
    }

    try {
        const rendered = await renderResolved({
            baseline: before,
            cache,
            definition: head,
            history,
            maxPngPixels,
            options,
        });
        return { ...rendered, warnings };
    } catch (error) {
        return { kind: 'error', message: errorMessage(error), warnings };
    }
}
