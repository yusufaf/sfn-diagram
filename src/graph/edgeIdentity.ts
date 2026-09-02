import type { GraphEdge } from '../types';

/** A graph edge before {@link assignEdgeIds} has stamped its identity. */
export type RawEdge = Omit<GraphEdge, 'id'>;

/** Parameters for {@link assignEdgeIds}. */
export interface AssignEdgeIdsParams {
    /** Every edge in the graph, in the order the parser produced them. */
    edges: RawEdge[];
}

/**
 * Stamp each edge with a stable identity, unique across the whole graph.
 *
 * Several legitimate ASL shapes produce two edges with the same `from`/`to` — two
 * Choice rules sharing a `Next`, a `Retry` self-loop beside a genuine self-transition,
 * a `Catch` pointing back at its own state. Without a discriminator those edges collapse
 * onto one dagre edge, one routing path, and one `edgeOverrides` key.
 *
 * The id is `${from}->${to}#${type}#${ordinal}`, where `type` falls back to `'normal'`
 * and `ordinal` counts edges already seen with that same `(from, to, type)` triple.
 * Normalizing the type before counting matters: an edge with no `type` and one typed
 * `'normal'` must share a counter, or they would render identical ids.
 *
 * Run this once, over the fully assembled edge array, so ordinals are global and
 * deterministic. Downstream transforms (`applyCollapse`, `applyCatchHandling`) only
 * filter edges, so ids survive them untouched — gaps in the ordinal sequence are
 * intentional, since renumbering would silently invalidate a caller's override key.
 *
 * @param params - Object parameters
 * @param params.edges - Every edge in the graph, in parser order
 * @returns The same edges, in the same order, each with an `id`
 *
 * @example
 * ```typescript
 * assignEdgeIds({ edges: [
 *     { from: 'Route', to: 'Work', type: 'choice' },
 *     { from: 'Route', to: 'Work', type: 'choice' },
 * ] });
 * // ids: 'Route->Work#choice#0', 'Route->Work#choice#1'
 * ```
 */
export function assignEdgeIds(params: AssignEdgeIdsParams): GraphEdge[] {
    const { edges } = params;
    const ordinals = new Map<string, number>();

    return edges.map((edge) => {
        const type = edge.type ?? 'normal';
        const pairKey = `${edge.from}->${edge.to}#${type}`;
        const ordinal = ordinals.get(pairKey) ?? 0;
        ordinals.set(pairKey, ordinal + 1);

        return { ...edge, id: `${pairKey}#${ordinal}` };
    });
}
