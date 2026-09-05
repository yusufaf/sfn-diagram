import { parseAsl } from '../../AslParser';
import { serializeForScriptBlock } from './scriptJson';
import type { AslDefinition, DiagramOptions, EdgeType } from '../../types';

/**
 * The subset of a graph edge the viewer's detail panel shows, keyed by `edge.id`.
 *
 * Deliberately narrower than `GraphEdge`: layout-only fields (`points`, `visualOnly`)
 * would bloat the embedded blob without telling a reader anything they cannot see on
 * the diagram itself.
 */
export interface ViewerEdge {
    /** Choice condition that produced this edge, for `type: 'choice'` edges. */
    condition?: string;
    /** Source state name. */
    from: string;
    /** Rendered edge label, when one was drawn. */
    label?: string;
    /** Target state name. */
    to: string;
    /** Transition kind, normalized so an untyped edge reads as `'normal'`. */
    type: EdgeType;
}

/** Parameters for {@link collectEdgeData}. */
export interface CollectEdgeDataParams {
    /** The ASL definition to parse, including nested Parallel branches and Map processors. */
    definition: AslDefinition;
    /**
     * The same options the diagram was rendered with. Pass them: `catchLabelStyle`
     * decides an error edge's `label`, so omitting them makes the panel disagree with
     * the label drawn on the diagram.
     */
    options?: DiagramOptions;
}

/** Parameters for {@link serializeEdgeData}. */
export interface SerializeEdgeDataParams {
    /** Edge detail for each edge, keyed by edge id. */
    edgeData: Record<string, ViewerEdge>;
}

/**
 * Collect viewer-facing detail for every edge in a definition, keyed by `edge.id` —
 * the same value `SvgRenderer` stamps onto each rendered path as `data-edge-id`.
 *
 * Parsing here rather than reading the rendered SVG is deliberate. An edge id has the
 * shape `${from}->${to}#${type}#${ordinal}`, and ASL places no restriction on the
 * characters in a state name, so a name containing `->` or `#` makes the id ambiguous
 * to split. The `condition` that produced a Choice edge never reaches the DOM at all.
 *
 * @param params - Parameters for edge collection
 * @param params.definition - ASL definition to parse
 * @param params.options - The options the diagram was rendered with
 * @returns Record mapping each edge id to its viewer-facing detail
 *
 * @example
 * ```typescript
 * const edgeData = collectEdgeData({ definition: asl });
 * edgeData['Route->Work#choice#0']; // => { condition: '$.kind == "work"', from: 'Route', ... }
 * ```
 *
 * @remarks
 * Keyed off the raw definition, so the result covers the expanded rendering and any
 * collapsed rendering alike: the graph transforms that produce a collapsed view only
 * ever *filter* edges (`applyCollapse`, `applyCatchHandling`), never renumber or
 * synthesize them, so every id a collapsed view can render is present here.
 */
export function collectEdgeData(params: CollectEdgeDataParams): Record<string, ViewerEdge> {
    const { definition, options } = params;
    const { edges } = parseAsl({ definition, options });

    const edgeData: Record<string, ViewerEdge> = {};
    for (const edge of edges) {
        const entry: ViewerEdge = { from: edge.from, to: edge.to, type: edge.type ?? 'normal' };
        if (edge.condition !== undefined) entry.condition = edge.condition;
        if (edge.label !== undefined) entry.label = edge.label;
        edgeData[edge.id] = entry;
    }
    return edgeData;
}

/**
 * Serialize collected edge data for embedding in an inline `<script>` block.
 *
 * @param params - Parameters for serialization
 * @param params.edgeData - Edge detail for each edge, keyed by edge id
 * @returns JSON string safe to embed between `<script>` and `</script>` tags
 *
 * @example
 * ```typescript
 * const json = serializeEdgeData({ edgeData: collectEdgeData({ definition: asl }) });
 * const html = `<script type="application/json" id="sfn-edge-data">${json}</script>`;
 * ```
 */
export function serializeEdgeData(params: SerializeEdgeDataParams): string {
    return serializeForScriptBlock({ value: params.edgeData });
}
