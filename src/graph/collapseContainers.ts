import { MAP_IO_NODE_TYPES } from '../constants';
import type { GraphEdge, StateNode } from '../types';

/** Synthetic marker node types that don't count as real states. */
const SYNTHETIC_MARKER_TYPES = new Set(['BranchEnd', 'IteratorEnd']);

/** Parameters for {@link applyCollapse}. */
export interface ApplyCollapseParams {
    /**
     * `true` collapses every Parallel/Map container; a string array collapses only
     * the named containers (unresolvable names are ignored); `undefined` is a no-op.
     */
    collapse: string[] | boolean | undefined;
    /** Graph edges from parseAsl. */
    edges: GraphEdge[];
    /** Graph nodes from parseAsl. */
    nodes: StateNode[];
}

/**
 * Replace each targeted Parallel/Map container's subgraph with a placeholder node.
 *
 * Descendant membership is derived by walking `StateNode.children` recursively —
 * `parent` is never populated by the parser, and a container's own `children` only
 * lists its direct level (entry state, end marker, direct branch/iterator states),
 * not further-nested containers' own descendants. Recursing into any visited child
 * that `isContainer` produces the full multi-level closure.
 *
 * No edge is ever rerouted, only deleted: every edge that should still exist after
 * a collapse already targets the container's own id (external entry edges, the
 * container -> Next visual edge, and Catch/Retry on the container state are all
 * anchored at the container id by `AslParser`, never at a descendant).
 */
export function applyCollapse(params: ApplyCollapseParams): {
    edges: GraphEdge[];
    nodes: StateNode[];
} {
    const { collapse, edges, nodes } = params;

    if (!collapse) {
        return { edges, nodes };
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const containerIds = new Set(nodes.filter((node) => node.isContainer).map((node) => node.id));

    const requestedTargets =
        collapse === true
            ? containerIds
            : new Set(collapse.filter((name) => containerIds.has(name)));

    if (requestedTargets.size === 0) {
        return { edges, nodes };
    }

    // Full multi-level descendant closure for one container, via BFS over `children`,
    // recursing into any visited node that is itself a container.
    const closureFor = (containerId: string): Set<string> => {
        const closure = new Set<string>();
        const queue = [...(nodesById.get(containerId)?.children ?? [])];
        while (queue.length > 0) {
            const currentId = queue.shift() as string;
            if (closure.has(currentId)) {
                continue;
            }
            closure.add(currentId);
            const current = nodesById.get(currentId);
            if (current?.isContainer) {
                queue.push(...(current.children ?? []));
            }
        }
        return closure;
    };

    const closuresByTarget = new Map<string, Set<string>>();
    const removedIds = new Set<string>();
    for (const targetId of requestedTargets) {
        const closure = closureFor(targetId);
        closuresByTarget.set(targetId, closure);
        for (const id of closure) {
            removedIds.add(id);
        }
    }

    // A Distributed Map's ItemReader/ResultWriter satellites are structural siblings
    // of the Map, not entries in its `children`, so the closure walk above never
    // visits them. If the Map itself is being removed here — either directly
    // targeted or swallowed by an ancestor's closure — sweep its satellites into
    // removedIds too, or they'd survive as disconnected floating nodes with no edges.
    for (const edge of edges) {
        const fromNode = nodesById.get(edge.from);
        const toNode = nodesById.get(edge.to);
        if (fromNode && MAP_IO_NODE_TYPES.has(fromNode.type) && removedIds.has(edge.to)) {
            removedIds.add(edge.from);
        }
        if (toNode && MAP_IO_NODE_TYPES.has(toNode.type) && removedIds.has(edge.from)) {
            removedIds.add(edge.to);
        }
    }

    // A target swallowed by another target's closure gets no separate placeholder —
    // it's already being removed as part of the ancestor's collapse.
    const effectiveTargets = new Set(
        [...requestedTargets].filter((targetId) => !removedIds.has(targetId)),
    );

    const resultNodes = nodes
        .filter((node) => !removedIds.has(node.id))
        .map((node) => {
            if (!effectiveTargets.has(node.id)) {
                return node;
            }
            const closure = closuresByTarget.get(node.id) as Set<string>;
            let collapsedCount = 0;
            for (const id of closure) {
                const descendant = nodesById.get(id);
                if (descendant && !SYNTHETIC_MARKER_TYPES.has(descendant.type)) {
                    collapsedCount += 1;
                }
            }
            return { ...node, children: [], collapsed: true, collapsedCount };
        });

    const resultEdges = edges.filter(
        (edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to),
    );

    return { edges: resultEdges, nodes: resultNodes };
}
