import { MAP_IO_NODE_TYPES } from '../constants';
import type { CatchHandling, GraphEdge, StateNode } from '../types';

/** Parameters for {@link applyCatchHandling}. */
export interface ApplyCatchHandlingParams {
    /** Graph edges from parseAsl. */
    edges: GraphEdge[];
    /** How to treat catch branches. */
    mode: CatchHandling;
    /** Graph nodes from parseAsl. */
    nodes: StateNode[];
    /** Id of the start state, which is never removed. */
    startStateId?: string;
}

/**
 * Apply catch-branch handling to a parsed graph.
 *
 * In 'hide' mode, removes every error edge and then any node that is not
 * reachable from the start state by following the remaining (non-error) edges.
 * This drops catch-handler chains entirely, including ones that only reference
 * each other (e.g. a cyclic handler chain unreachable from the happy path), since
 * reachability is computed with a single forward pass from the start state rather
 * than an incoming-edge check. If no start state id is provided, every node that
 * still has a surviving incoming or outgoing edge is kept instead. In 'show' mode
 * the graph is returned unchanged.
 *
 * Distributed Map `ItemReader` / `ResultWriter` satellites are exempt from the
 * forward-reachability rule: they are attached to their Map structurally, and an
 * ItemReader is a graph source that no forward pass can reach. Each is kept
 * whenever the node it connects to survives.
 */
export function applyCatchHandling(params: ApplyCatchHandlingParams): {
    edges: GraphEdge[];
    nodes: StateNode[];
} {
    const { edges, mode, nodes, startStateId } = params;

    if (mode === 'show') {
        return { edges, nodes };
    }

    // Drop error edges up front.
    const keptEdges = edges.filter((edge) => edge.type !== 'error');

    let reachableIds: Set<string>;
    if (startStateId !== undefined) {
        // Forward reachability from the start state over the kept edges.
        const adjacency = new Map<string, string[]>();
        for (const edge of keptEdges) {
            const targets = adjacency.get(edge.from);
            if (targets) {
                targets.push(edge.to);
            } else {
                adjacency.set(edge.from, [edge.to]);
            }
        }

        reachableIds = new Set([startStateId]);
        const queue = [startStateId];
        while (queue.length > 0) {
            const currentId = queue.shift() as string;
            for (const targetId of adjacency.get(currentId) ?? []) {
                if (!reachableIds.has(targetId)) {
                    reachableIds.add(targetId);
                    queue.push(targetId);
                }
            }
        }
    } else {
        // Fall back to keeping any node still touched by a kept edge.
        reachableIds = new Set<string>();
        for (const edge of keptEdges) {
            reachableIds.add(edge.from);
            reachableIds.add(edge.to);
        }
    }

    // Distributed Map I/O satellites are attached to their Map structurally
    // rather than reached from the start state. An ItemReader in particular is a
    // graph source — its only edge points at the Map — so the forward pass above
    // never visits it, and without this the reader would be dropped while the
    // writer survived. Keep a satellite whenever the node it connects to did.
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of keptEdges) {
        const source = nodesById.get(edge.from);
        if (source && MAP_IO_NODE_TYPES.has(source.type) && reachableIds.has(edge.to)) {
            reachableIds.add(edge.from);
        }
    }

    const survivingNodes = nodes.filter((node) => reachableIds.has(node.id));
    const survivingIds = new Set(survivingNodes.map((node) => node.id));
    const survivingEdges = keptEdges.filter(
        (edge) => survivingIds.has(edge.from) && survivingIds.has(edge.to),
    );

    return { edges: survivingEdges, nodes: survivingNodes };
}
