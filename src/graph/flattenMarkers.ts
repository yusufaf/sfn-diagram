import type { GraphEdge, StateNode } from '../types';
import { isMarkerNode, isOpenContainer } from './containers';

/** Parameters for {@link flattenMarkers}. */
export interface FlattenMarkersParams {
    /** Graph edges from parseAsl (or a later transform, e.g. applyCollapse). */
    edges: GraphEdge[];
    /** Graph nodes from parseAsl (or a later transform, e.g. applyCollapse). */
    nodes: StateNode[];
}

/** Result of {@link flattenMarkers}: the same graph with markers removed and rewired around. */
export interface FlattenMarkersResult {
    edges: GraphEdge[];
    nodes: StateNode[];
}

/**
 * Remove synthetic branch/iterator end marker nodes (see {@link isMarkerNode}) from
 * a graph and rewire around them, for a renderer that has no use for layout
 * anchors - unlike `SvgRenderer`, `MermaidRenderer` has no visual concept of a
 * small marker dot, so leaving these in produces empty-labelled phantom states.
 *
 * - A marker node is dropped.
 * - An edge into a marker is rewired onto the marker's own outgoing target(s) -
 *   normally exactly one (a container's `Next`), or none when the container has
 *   no `Next` - carrying the original edge's `label`/`condition`/`type`. A
 *   marker's own outgoing edge is never re-emitted as itself; it's what the
 *   rewired incoming edges now represent.
 * - A container's `-> Next` visual-only edge becomes a duplicate of those
 *   rewired edges once the container is open (still has marker descendants), so
 *   it's dropped in that case. A *collapsed* container has no marker
 *   descendants left (`applyCollapse` already removed them along with the rest
 *   of its subgraph) and this edge is its only remaining link to the rest of
 *   the graph, so it's kept.
 * - Container -> child entry edges and retry self-loops are left untouched.
 *
 * @example
 * ```typescript
 * const { nodes, edges } = flattenMarkers({ nodes: graph.nodes, edges: graph.edges });
 * ```
 */
export function flattenMarkers(params: FlattenMarkersParams): FlattenMarkersResult {
    const { edges, nodes } = params;

    const markerIds = new Set(nodes.filter((node) => isMarkerNode(node)).map((node) => node.id));
    if (markerIds.size === 0) {
        return { edges, nodes };
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    const outgoingByMarker = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
        if (!markerIds.has(edge.from)) continue;
        const outgoing = outgoingByMarker.get(edge.from) ?? [];
        outgoing.push(edge);
        outgoingByMarker.set(edge.from, outgoing);
    }

    // Resolve a marker to its real (non-marker) successor edges, following a
    // chain of markers if one is ever produced upstream - `Next` always names a
    // real state today, so a chain never actually occurs, but the visited set
    // keeps this from looping forever if that invariant ever changes.
    const resolveMarkerTargets = (markerId: string, visited: Set<string>): GraphEdge[] => {
        if (visited.has(markerId)) return [];
        visited.add(markerId);

        const outgoing = outgoingByMarker.get(markerId) ?? [];
        return outgoing.flatMap((edge) =>
            markerIds.has(edge.to) ? resolveMarkerTargets(edge.to, visited) : [edge],
        );
    };

    const resultEdges: GraphEdge[] = [];
    const seenRewired = new Set<string>();
    let flattenedCounter = 0;

    for (const edge of edges) {
        // A marker's own outgoing edge is represented by the rewired incoming
        // edges below, not re-emitted as itself.
        if (markerIds.has(edge.from)) continue;

        if (markerIds.has(edge.to)) {
            for (const target of resolveMarkerTargets(edge.to, new Set())) {
                const rewired: GraphEdge = {
                    ...edge,
                    condition: edge.condition ?? target.condition,
                    id: `${edge.from}->${target.to}#flattened#${flattenedCounter++}`,
                    label: edge.label ?? target.label,
                    to: target.to,
                    type: edge.type ?? target.type,
                };
                const dedupeKey = `${rewired.from}->${rewired.to}#${rewired.label ?? ''}`;
                if (seenRewired.has(dedupeKey)) continue;
                seenRewired.add(dedupeKey);
                resultEdges.push(rewired);
            }
            continue;
        }

        const fromNode = nodesById.get(edge.from);
        const isContainerNextEdge =
            edge.visualOnly === true &&
            fromNode !== undefined &&
            isOpenContainer(fromNode) &&
            !(fromNode.children ?? []).includes(edge.to);
        if (isContainerNextEdge) {
            continue;
        }

        resultEdges.push(edge);
    }

    return {
        edges: resultEdges,
        nodes: nodes.filter((node) => !markerIds.has(node.id)),
    };
}
