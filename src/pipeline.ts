/**
 * The diagram pipeline, split at the seam between "parse the definition" and "render
 * one view of it": {@link buildDiagramGraph} runs the parse and catch handling once,
 * and {@link renderSvgGraph} turns that graph into an SVG for one `collapse`
 * selection.
 *
 * `generateSvg` runs the two back to back. `generateHtml` and `generateDiff` need
 * more than one thing from a single parse — an expanded view, a collapsed view, the
 * viewer's edge data, a collapse plan — so they call the halves separately rather
 * than re-parsing the same ASL for each.
 */
import { parseAsl } from './AslParser';
import { applyCatchHandling, applyCollapse } from './graph';
import { DagreLayout } from './layout';
import { SvgRenderer } from './renderers';
import type { ParseResult } from './AslParser';
import type { mergeOptions } from './config';
import type { AslDefinition, GraphEdge, StateNode, SvgOutput } from './types';

/** User options with every default from `DEFAULT_DIAGRAM_OPTIONS` filled in. */
export type MergedDiagramOptions = ReturnType<typeof mergeOptions>;

/** Parameters for {@link buildDiagramGraph}. */
export interface BuildDiagramGraphParams {
    /** The ASL definition to parse (already decoded from JSON, if it was a string). */
    definition: AslDefinition;
    /** Merged options; the parser reads styling options, `catchHandling` prunes error branches. */
    options: MergedDiagramOptions;
}

/** A parsed definition, ready to be rendered as many times as needed. */
export interface DiagramGraph {
    /** Edges after catch handling: what every rendered view starts from. */
    edges: GraphEdge[];
    /** Nodes after catch handling. */
    nodes: StateNode[];
    /**
     * The raw parse, before catch handling. The interactive viewer keys its edge detail
     * off this so an edge id it might have to look up is never missing.
     */
    parsed: ParseResult;
}

/** Parameters for {@link renderSvgGraph}. */
export interface RenderSvgGraphParams {
    /** Edges to render, normally {@link DiagramGraph.edges}. */
    edges: GraphEdge[];
    /** Nodes to render, normally {@link DiagramGraph.nodes}. */
    nodes: StateNode[];
    /** Merged options: `collapse` selects the view, the rest drive layout and rendering. */
    options: MergedDiagramOptions;
}

/**
 * Parse a definition into its graph and apply catch handling — everything in the
 * pipeline that does not depend on which view, or which renderer, comes next.
 *
 * @param params - The definition and the merged options to parse it with
 * @returns The graph to render, plus the raw parse it was derived from
 *
 * @example
 * ```typescript
 * const graph = buildDiagramGraph({ definition, options: mergeOptions({}) });
 * const expanded = renderSvgGraph({ ...graph, options: mergeOptions({}) });
 * const collapsed = renderSvgGraph({ ...graph, options: mergeOptions({ collapse: true }) });
 * ```
 */
export function buildDiagramGraph(params: BuildDiagramGraphParams): DiagramGraph {
    const { definition, options } = params;
    const parsed = parseAsl({ definition, options });

    // Apply catch handling (drops error branches when mode is 'hide')
    const { edges, nodes } = applyCatchHandling({
        edges: parsed.edges,
        mode: options.catchHandling,
        nodes: parsed.nodes,
        startStateId: definition.StartAt,
    });

    return { edges, nodes, parsed };
}

/**
 * Collapse, lay out, and render one view of a graph from {@link buildDiagramGraph}.
 *
 * The inputs are never mutated, so the same graph can be rendered repeatedly with
 * different `options.collapse` selections.
 *
 * @param params - The graph and the merged options to render it with
 * @returns The rendered SVG with its dimensions and metadata
 *
 * @example
 * ```typescript
 * const { svg } = renderSvgGraph({ ...graph, options: { ...options, collapse: ['Fan'] } });
 * ```
 */
export function renderSvgGraph(params: RenderSvgGraphParams): SvgOutput {
    const { edges, nodes, options } = params;

    const collapsedGraph = applyCollapse({ collapse: options.collapse, edges, nodes });

    // Calculate layout
    const layout = new DagreLayout(options);
    const positioned = layout.calculate(collapsedGraph.nodes, collapsedGraph.edges);

    // Render SVG
    const renderer = new SvgRenderer(options);
    return renderer.render(positioned);
}
