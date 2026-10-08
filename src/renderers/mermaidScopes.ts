import { MAP_IO_NODE_TYPES } from '../constants/labels';
import { isMarkerNode, isOpenContainer } from '../graph';
import type { GraphEdge, StateNode } from '../types';

/** One drawing scope of a Mermaid diagram: the machine itself, a Parallel branch or a Map processor. */
export interface MermaidRegion {
    /** Node id the region's `[*]` enters (the branch or processor StartAt). Absent for the root; the renderer resolves its start. */
    entryId?: string;
    /** Ids of the states drawn directly in this region (not inside a nested composite), in graph node order. */
    memberIds: string[];
    /** Transitions drawn in this region: every kept edge whose `from` is a member, in graph edge order. */
    transitions: GraphEdge[];
}

/** The graph regrouped into the scopes a Mermaid `stateDiagram-v2` nests. */
export interface MermaidScopes {
    /** Every node except branch/iterator end markers, in graph order. */
    nodes: StateNode[];
    /** Each open container's regions: one per Parallel branch in branch order, exactly one for a Map. */
    regionsByContainer: Map<string, MermaidRegion[]>;
    /** The machine's top level. */
    root: MermaidRegion;
}

export interface BuildMermaidScopesParams {
    edges: GraphEdge[];
    nodes: StateNode[];
}

/**
 * Regroup a parsed graph into the nested scopes Mermaid draws: the root, plus one
 * region per Parallel branch and one per Map processor.
 *
 * Synthetic end markers and the display-only container-to-child entry edges are
 * dropped (the renderer draws each region's `[*]` instead). Every other edge is
 * kept in the region of its `from` node. Distributed Map ItemReader/ResultWriter
 * satellites join their Map's region.
 *
 * @param params - The graph's `nodes` and `edges`, after any collapse / catch transforms.
 * @returns The non-marker nodes and every region, keyed by container id.
 *
 * @example
 * ```ts
 * const { nodes, edges } = parseAsl({ definition });
 * const scopes = buildMermaidScopes({ edges, nodes });
 * scopes.regionsByContainer.get('ParallelExecution')?.map((region) => region.entryId);
 * ```
 *
 * @remarks A container's `children` that no longer exist in `nodes` (hidden by
 * catch handling) are ignored.
 */
export function buildMermaidScopes(params: BuildMermaidScopesParams): MermaidScopes {
    const nodes = params.nodes.filter((node) => !isMarkerNode(node));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const root: MermaidRegion = { memberIds: [], transitions: [] };
    const regionsByContainer = new Map<string, MermaidRegion[]>();
    const regionOfNode = new Map<string, MermaidRegion>();

    const entryEdges = new Set<GraphEdge>();
    const seedsByContainer = new Map<string, string[]>();
    for (const edge of params.edges) {
        if (!edge.visualOnly || !nodesById.has(edge.to)) continue;
        const container = nodesById.get(edge.from);
        if (!container || !isOpenContainer(container) || !container.children?.includes(edge.to)) continue;
        entryEdges.add(edge);
        seedsByContainer.set(edge.from, [...(seedsByContainer.get(edge.from) ?? []), edge.to]);
    }

    for (const container of nodes) {
        if (!isOpenContainer(container) || !container.children?.length) continue;
        const children = container.children;
        const seeds = seedsByContainer.get(container.id) ?? [];
        const regions: MermaidRegion[] =
            seeds.length > 0
                ? seeds.map((seed) => ({ entryId: seed, memberIds: [], transitions: [] }))
                : [{ memberIds: [], transitions: [] }];
        regionsByContainer.set(container.id, regions);

        // The parser lists a Parallel's children branch by branch (StartAt, end marker,
        // then the rest of that branch's states - see markBranchStatesAsChildren), so
        // each branch is the slice from its seed to the next seed. Splitting by position
        // rather than reachability keeps states that have no path from StartAt, such as
        // the orphans a diff leaves for removed states, in their own branch.
        const seedIndexes = seeds.map((seed) => children.indexOf(seed));
        children.forEach((childId, childIndex) => {
            let regionIndex = 0;
            seedIndexes.forEach((seedIndex, seedPosition) => {
                if (childIndex >= seedIndex) regionIndex = seedPosition;
            });
            if (nodesById.has(childId)) regionOfNode.set(childId, regions[regionIndex]);
        });
    }

    // ItemReader / ResultWriter satellites belong to no container's children; draw
    // them beside the Map they serve so a nested Map's I/O stays inside its branch.
    for (const node of nodes) {
        if (!MAP_IO_NODE_TYPES.has(node.type) || regionOfNode.has(node.id)) continue;
        for (const edge of params.edges) {
            const otherId = edge.from === node.id ? edge.to : edge.to === node.id ? edge.from : undefined;
            if (otherId === undefined || nodesById.get(otherId)?.type !== 'Map') continue;
            const mapRegion = regionOfNode.get(otherId);
            if (mapRegion) regionOfNode.set(node.id, mapRegion);
            break;
        }
    }

    for (const node of nodes) {
        (regionOfNode.get(node.id) ?? root).memberIds.push(node.id);
    }

    for (const edge of params.edges) {
        if (entryEdges.has(edge) || !nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
        (regionOfNode.get(edge.from) ?? root).transitions.push(edge);
    }

    return { nodes, regionsByContainer, root };
}
