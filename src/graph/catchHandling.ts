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
 * In 'hide' mode, removes every error edge and then any node left reachable only
 * through catch branches (per-state error handlers and the chains they lead to),
 * iterating to a fixed point. Nodes still on the happy path — those with a
 * non-error incoming edge, plus the start state — are always kept. In 'show'
 * mode the graph is returned unchanged.
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
    let keptEdges = edges.filter((edge) => edge.type !== 'error');
    let keptNodes = nodes;

    // Iteratively drop nodes that have no non-error incoming edge and are not the
    // start state — this sweeps handler chains, not just direct handler targets.
    let changed = true;
    while (changed) {
        changed = false;
        const reachableTargets = new Set(keptEdges.map((edge) => edge.to));

        const survivingNodes = keptNodes.filter((node) => {
            if (node.id === startStateId) return true;
            return reachableTargets.has(node.id);
        });

        if (survivingNodes.length !== keptNodes.length) {
            const survivingIds = new Set(survivingNodes.map((node) => node.id));
            keptNodes = survivingNodes;
            keptEdges = keptEdges.filter(
                (edge) => survivingIds.has(edge.from) && survivingIds.has(edge.to),
            );
            changed = true;
        }
    }

    return { edges: keptEdges, nodes: keptNodes };
}
