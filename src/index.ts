/**
 * @module
 *
 * Core entry point for `sfn-diagram` — generate diagrams from AWS Step Functions
 * ASL (Amazon States Language) definitions. This module is platform-agnostic and
 * runs in Node, browsers, and edge runtimes.
 *
 * It exposes both a function-based API ({@link generateSvg}, {@link generateMermaid},
 * {@link generateDiagram}, {@link generateFromAwsResponse}) and a class-based API
 * ({@link SfnDiagramGenerator}), plus diff, execution-overlay, and ASL-validation
 * helpers. PNG export lives in the Node-only `sfn-diagram/png` subpath; AWS SDK
 * helpers live in `sfn-diagram/aws`.
 *
 * @example
 * ```typescript
 * import { generateSvg } from 'sfn-diagram';
 *
 * const { svg } = generateSvg({
 *   aslDefinition: {
 *     StartAt: 'HelloWorld',
 *     States: { HelloWorld: { Type: 'Pass', End: true } },
 *   },
 * });
 * ```
 */
import { parseAslSource } from './AslParser';
import { applyCollapse } from './graph';
import { MermaidRenderer } from './renderers';
import { mergeDiagramOptions, mergeOptions } from './config';
import { generateHtml } from './html';
import { buildDiagramGraph, renderSvgGraph } from './pipeline';
import type { MergedDiagramOptions } from './pipeline';
import type {
    GenerateSvgParams,
    GenerateMermaidParams,
    GenerateDiagramParams,
    GenerateFromAwsParams,
    DiagramOptions,
    SvgOutput,
    MermaidOutput,
    HtmlOutput,
    AslDefinition,
} from './types';

/**
 * Generate an SVG diagram from an AWS Step Functions ASL definition
 *
 * This function parses an ASL definition and renders it as an SVG diagram using D3.js
 * with automatic graph layout via Dagre. The output is a complete SVG string that can
 * be saved to a file or embedded in HTML.
 *
 * @param params - Configuration object
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.theme - Color theme: 'light' (default), 'dark', or a CustomTheme object
 * @param params.layout - Layout direction: 'TB' (top-bottom, default), 'LR' (left-right), 'RL', or 'BT'
 * @param params.nodeWidth - Width of state nodes in pixels (default: 120)
 * @param params.nodeHeight - Height of state nodes in pixels (default: 60)
 * @param params.rankSeparation - Vertical separation between ranks in pixels (default: 50)
 * @param params.nodeSeparation - Horizontal separation between nodes in pixels (default: 50)
 * @param params.padding - Padding around the diagram in pixels (default: 20)
 * @param params.edgeStyle - Edge path style: 'curved' (default), 'straight', or 'orthogonal'
 * @param params.showStateTypes - Whether to display state types on nodes (default: false)
 * @param params.includeComments - Whether to use state comments as labels (default: true)
 * @param params.customColors - Override colors for specific state types
 * @param params.diagramTitle - Accessible name for the diagram (default: the ASL's top-level `Comment`)
 * @param params.diagramDescription - Accessible description for the diagram (default: a state/transition count summary)
 *
 * @returns SVG output containing the diagram string, dimensions, and metadata
 *
 * @throws {AslSyntaxError} If params.aslDefinition is a string with invalid JSON (also an `instanceof SyntaxError` and `AslValidationError`)
 * @throws {Error} If the ASL definition structure is invalid
 *
 * @example
 * ```typescript
 * import { generateSvg } from 'sfn-diagram';
 * import { writeFileSync } from 'fs';
 *
 * const asl = {
 *   StartAt: 'HelloWorld',
 *   States: {
 *     HelloWorld: { Type: 'Pass', Result: 'Hello!', End: true }
 *   }
 * };
 *
 * const { svg, width, height } = generateSvg({ aslDefinition: asl, theme: 'dark', layout: 'LR' });
 * writeFileSync('diagram.svg', svg);
 * console.log(`Generated ${width}x${height} diagram`);
 * ```
 *
 * @example
 * ```typescript
 * // From JSON string
 * const aslJson = fs.readFileSync('state-machine.json', 'utf-8');
 * const result = generateSvg({ aslDefinition: aslJson, theme: 'light' });
 * ```
 *
 * @example
 * ```typescript
 * // With AWS service icons
 * const { svg } = generateSvg({
 *   aslDefinition: asl,
 *   showIcons: true,
 *   iconPosition: 'left',
 *   nodeWidth: 150
 * });
 * ```
 */
export function generateSvg(params: GenerateSvgParams): SvgOutput {
    const { aslDefinition, ...options } = params;
    const aslObj = parseAslSource({ source: aslDefinition });
    const mergedOptions = mergeOptions({
        ...options,
        diagramTitle: options.diagramTitle ?? aslObj.Comment,
    });

    const { edges, nodes } = buildDiagramGraph({ definition: aslObj, options: mergedOptions });
    return renderSvgGraph({ edges, nodes, options: mergedOptions });
}

/**
 * Generate Mermaid diagram syntax from an AWS Step Functions ASL definition
 *
 * This function converts an ASL definition into Mermaid state diagram syntax,
 * which can be rendered using the Mermaid library or included in Markdown documentation.
 * The output includes CSS classes for styling different state types.
 *
 * @param params - Configuration object
 * @param params.aslDefinition - ASL definition as an object or JSON string
 *
 * @returns Mermaid output containing the diagram code and metadata
 *
 * @throws {AslSyntaxError} If params.aslDefinition is a string with invalid JSON (also an `instanceof SyntaxError` and `AslValidationError`)
 * @throws {Error} If the ASL definition structure is invalid
 *
 * @example
 * ```typescript
 * import { generateMermaid } from 'sfn-diagram';
 *
 * const asl = {
 *   StartAt: 'Process',
 *   States: {
 *     Process: { Type: 'Task', Resource: 'arn:aws:...', Next: 'Done' },
 *     Done: { Type: 'Succeed' }
 *   }
 * };
 *
 * const { code, metadata } = generateMermaid({ aslDefinition });
 * console.log(code);
 * // Output:
 * // stateDiagram-v2
 * //     [*] --> Process
 * //     Process --> Done
 * //     Done --> [*]
 * //     ...
 *
 * console.log(`Generated diagram with ${metadata.stateCount} states`);
 * ```
 *
 * @example
 * ```typescript
 * // Use in Markdown
 * const { code } = generateMermaid({ aslDefinition: myStateMachine });
 * const markdown = `\`\`\`mermaid\n${code}\n\`\`\``;
 * fs.writeFileSync('diagram.md', markdown);
 * ```
 */
export function generateMermaid(params: GenerateMermaidParams): MermaidOutput {
    const { aslDefinition, ...options } = params;
    const aslObj = parseAslSource({ source: aslDefinition });
    const mergedOptions = mergeOptions(options);

    const { edges, nodes } = buildDiagramGraph({ definition: aslObj, options: mergedOptions });
    const collapsedGraph = applyCollapse({ collapse: mergedOptions.collapse, edges, nodes });

    const renderer = new MermaidRenderer();
    return renderer.render({
        asl: aslObj,
        customColors: mergedOptions.customColors,
        edges: collapsedGraph.edges,
        layout: mergedOptions.layout,
        nodes: collapsedGraph.nodes,
        showVariables: mergedOptions.showVariables,
        theme: mergedOptions.theme,
    });
}

/**
 * Generate a diagram from an ASL definition (auto-detects format from options)
 *
 * This is a convenience function that generates either an SVG or Mermaid diagram
 * based on the `format` option. If no format is specified, defaults to SVG.
 *
 * @param params - Configuration object
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.format - Output format: 'svg' (default), 'mermaid' or 'html'
 * @param params.theme - Color theme (SVG only)
 * @param params.layout - Layout direction (SVG only)
 * @param ...params - Other options (see generateSvg, generateMermaid or generateHtml)
 *
 * @returns SVG output if format is 'svg', Mermaid output if format is 'mermaid',
 *   interactive HTML output if format is 'html'
 *
 * @throws {AslSyntaxError} If params.aslDefinition is a string with invalid JSON (also an `instanceof SyntaxError` and `AslValidationError`)
 * @throws {Error} If the ASL definition structure is invalid
 *
 * @example
 * ```typescript
 * import { generateDiagram } from 'sfn-diagram';
 *
 * // Generate SVG (default)
 * const svgResult = generateDiagram({ aslDefinition: myAsl });
 *
 * // Generate Mermaid
 * const mermaidResult = generateDiagram({ aslDefinition: myAsl, format: 'mermaid' });
 * ```
 */
export function generateDiagram(
    params: GenerateDiagramParams,
): HtmlOutput | MermaidOutput | SvgOutput {
    const { aslDefinition, format, ...options } = params;
    const mergedOptions = mergeOptions({ format, ...options });

    if (mergedOptions.format === 'mermaid') {
        return generateMermaid({ aslDefinition, ...options });
    }

    if (mergedOptions.format === 'html') {
        return generateHtml({ aslDefinition, ...options });
    }

    if (mergedOptions.format === 'png') {
        throw new Error(
            'generateDiagram cannot produce PNG because it is synchronous. ' +
                "Use `import { exportPng } from 'sfn-diagram/png'` instead.",
        );
    }

    return generateSvg({ aslDefinition, ...options });
}

/**
 * Generate a diagram from an AWS SDK DescribeStateMachine response
 *
 * This is a convenience function for integrating with the AWS SDK. It extracts
 * the ASL definition from the response and generates a diagram.
 *
 * @param params - Configuration object
 * @param params.response - AWS SDK DescribeStateMachine response object
 * @param params.format - Output format: 'svg' (default) or 'mermaid'
 * @param ...params - Other options (see generateSvg or generateMermaid)
 *
 * @returns SVG output if format is 'svg', Mermaid output if format is 'mermaid'
 *
 * @throws {Error} If response.definition is missing
 * @throws {AslSyntaxError} If the definition contains invalid JSON (also an `instanceof SyntaxError` and `AslValidationError`)
 * @throws {Error} If the ASL definition structure is invalid
 *
 * @example
 * ```typescript
 * import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
 * import { generateFromAwsResponse } from 'sfn-diagram';
 *
 * const client = new SFNClient({ region: 'us-east-1' });
 * const response = await client.send(
 *   new DescribeStateMachineCommand({
 *     stateMachineArn: 'arn:aws:states:...'
 *   })
 * );
 *
 * const { svg } = generateFromAwsResponse({
 *   response,
 *   theme: 'light',
 *   layout: 'TB'
 * });
 * ```
 */
export function generateFromAwsResponse(
    params: GenerateFromAwsParams
): HtmlOutput | MermaidOutput | SvgOutput {
    const { response, ...options } = params;

    if (!response.definition) {
        throw new Error('No definition found in AWS response');
    }

    return generateDiagram({ aslDefinition: response.definition, ...options });
}

/**
 * Class-based API for advanced usage with fluent interface
 *
 * This class allows you to configure diagram options once and generate multiple
 * diagrams with the same settings. Options can be updated using the fluent
 * `setOptions()` method.
 *
 * @example
 * ```typescript
 * import { SfnDiagramGenerator } from 'sfn-diagram';
 *
 * const generator = new SfnDiagramGenerator({
 *   theme: 'dark',
 *   layout: 'LR',
 *   nodeWidth: 150
 * });
 *
 * // Generate multiple diagrams with the same options
 * const diagram1 = generator.generateSvg({ aslDefinition: stateMachine1 });
 * const diagram2 = generator.generateSvg({ aslDefinition: stateMachine2 });
 *
 * // Update options and generate more
 * generator.setOptions({ theme: 'light' });
 * const diagram3 = generator.generateSvg({ aslDefinition: stateMachine3 });
 * ```
 */
export class SfnDiagramGenerator {
    private options: MergedDiagramOptions;

    /**
     * Create a new diagram generator with default options
     *
     * @param options - Default diagram options for all subsequent generations
     *
     * @example
     * ```typescript
     * const generator = new SfnDiagramGenerator({ theme: 'dark', layout: 'LR' });
     * ```
     */
    constructor(options: DiagramOptions = {}) {
        this.options = mergeOptions(options);
    }

    /**
     * Generate a diagram (auto-detects format from options)
     *
     * @param params - Generation parameters
     * @param params.aslDefinition - ASL definition as an object or JSON string
     * @returns SVG or Mermaid output based on format option
     *
     * @example
     * ```typescript
     * const result = generator.generate({ aslDefinition: myStateMachine });
     * ```
     */
    generate(params: {
        aslDefinition: AslDefinition | string;
    }): HtmlOutput | MermaidOutput | SvgOutput {
        return generateDiagram({ ...params, ...this.options });
    }

    /**
     * Generate an SVG diagram
     *
     * @param params - Generation parameters
     * @param params.aslDefinition - ASL definition as an object or JSON string
     * @returns SVG output with diagram and metadata
     *
     * @example
     * ```typescript
     * const { svg } = generator.generateSvg({ aslDefinition: myStateMachine });
     * ```
     */
    generateSvg(params: { aslDefinition: AslDefinition | string }): SvgOutput {
        return generateSvg({ ...params, ...this.options });
    }

    /**
     * Generate Mermaid diagram syntax
     *
     * @param params - Generation parameters
     * @param params.aslDefinition - ASL definition as an object or JSON string
     * @returns Mermaid output with code and metadata
     *
     * @example
     * ```typescript
     * const { code } = generator.generateMermaid({ aslDefinition: myStateMachine });
     * ```
     */
    generateMermaid(params: { aslDefinition: AslDefinition | string }): MermaidOutput {
        return generateMermaid({ ...params, ...this.options });
    }

    /**
     * Update the generator's default options (fluent interface)
     *
     * @param options - Partial options to merge with existing options
     * @returns This generator instance for method chaining
     *
     * @example
     * ```typescript
     * generator
     *   .setOptions({ theme: 'dark' })
     *   .setOptions({ layout: 'LR' });
     *
     * const result = generator.generateSvg({ aslDefinition: myAsl });
     * ```
     */
    setOptions(options: Partial<DiagramOptions>): this {
        this.options = mergeOptions(mergeDiagramOptions(this.options, options));
        return this;
    }
}

// Type exports
export type {
    AslDefinition,
    AslState,
    StateType,
    QueryLanguage,
    DiagramOptions,
    SvgOutput,
    MermaidOutput,
    HtmlOutput,
    DiffOutput,
    MermaidDiffOutput,
    StateNode,
    GraphEdge,
    NodeStyle,
    CustomTheme,
    ResolvedTheme,
    LintCode,
    LintDiagnostic,
    LintSeverity,
    GenerateSvgParams,
    GenerateMermaidParams,
    GenerateHtmlParams,
    GenerateViewerUpdateParams,
    ViewerUpdate,
    GenerateDiagramParams,
    GenerateDiffParams,
    GenerateMermaidDiffParams,
    GenerateFromAwsParams,
    HtmlDiffOverlay,
    DiffStateSummary,
    // Execution overlay
    EdgeStyleOverride,
    ExecutionHistoryInput,
    ExecutionHtmlOutput,
    ExecutionOutput,
    ExecutionOverlay,
    ExecutionStateResult,
    ExecutionStateStatus,
    ExecutionStatus,
    ExecutionSummary,
    ExecutionTimeline,
    GenerateExecutionHtmlParams,
    GenerateExecutionParams,
    GenerateMermaidExecutionParams,
    MermaidExecutionOutput,
    TakenEdge,
    TimelineEntry,
    TimelineEntryStatus,
    TimelinePayload,
    // Union types for configuration options
    DiagramFormat,
    ThemeOption,
    LayoutDirection,
    EdgePathStyle,
    EdgeType,
    DiffStatus,
    NodeShape,
    CatchHandling,
} from './types';

export { buildViewerContent } from './renderers';
export { AWS_LIGHT_THEME, AWS_DARK_THEME } from './config';
export { resolveViewerTheme } from './renderers';
export type { ViewerTheme } from './renderers';
export { embedIcons } from './utils/iconEmbedder';
export { AslSyntaxError, AslValidationError, validateAsl } from './AslParser';
export { generateDiff, generateMermaidDiff } from './diff';
export {
    generateExecutionHtml,
    generateExecutionHtmlAsync,
    generateHtml,
    generateHtmlAsync,
    generateViewerUpdate,
} from './html';
export { lintAsl } from './lint';
export type { LintAslParams } from './lint';
export { EXECUTION_PAYLOAD_CAP } from './execution';
export {
    buildExecutionTimeline,
    generateExecution,
    generateMermaidExecution,
    parseExecutionHistory,
} from './execution';
export type { BuildExecutionTimelineParams } from './execution';
