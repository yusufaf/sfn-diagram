import dagre from '@dagrejs/dagre';
import { getNodeSubLabelParts } from '../constants/labels';
import { CONTAINER_HEADER_HEIGHT, CONTAINER_PADDING } from '../constants/layout';
import { isOpenContainer } from '../graph';
import type { StateNode, GraphEdge, DiagramOptions } from '../types';

/** Self-loop arc geometry. Each additional loop on a node nests one step further out. */
const LOOP_BASE_REACH = 40;
const LOOP_REACH_STEP = 22;
const LOOP_BASE_SPREAD = 12;
const LOOP_SPREAD_STEP = 5;

export interface LayoutResult {
    // With points for routing; loopIndex is set only for self-loops, so the renderer
    // can stagger nested loops' labels apart without inverting layout geometry.
    edges: Array<GraphEdge & { loopIndex?: number; points?: Array<{ x: number; y: number }> }>;
    nodes: StateNode[]; // With x, y, width, height populated
    graph: {
        height: number;
        width: number;
    };
}

/**
 * DagreLayout - Calculates node positions and edge routing using Dagre algorithm
 */
/** Vertical step between stacked text lines inside a node, matching SvgRenderer. */
const STACKED_LINE_HEIGHT = 16;

export class DagreLayout {
    private options: DiagramOptions;

    constructor(options: DiagramOptions) {
        this.options = options;
    }

    /**
     * Calculate layout positions for nodes and edges
     */
    calculate(nodes: StateNode[], edges: GraphEdge[]): LayoutResult {
        const graph = new dagre.graphlib.Graph({ multigraph: true });

        // Configure graph layout
        graph.setGraph({
            marginx: this.options.padding || 20,
            marginy: this.options.padding || 20,
            nodesep: this.options.nodeSeparation || 50,
            rankdir: this.options.layout || 'TB',
            ranksep: this.options.rankSeparation || 50,
        });

        // Set default edge labels
        graph.setDefaultEdgeLabel(() => ({}));

        // Container nodes are laid out as post-hoc bounding boxes rather than dagre
        // nodes, so any edge referencing a container is routed manually below. For
        // ranking, an edge *into* a container is redirected onto the container's entry
        // child states (the targets of the container's visual-only child edges) so that
        // predecessors are ranked above the container's contents.
        const containerIds = new Set(
            nodes.filter((node) => isOpenContainer(node)).map((node) => node.id),
        );
        const containerChildren = new Map<string, Set<string>>(
            nodes
                .filter((node) => isOpenContainer(node))
                .map((node) => [node.id, new Set(node.children || [])]),
        );
        const entryChildrenByContainer = new Map<string, string[]>();
        for (const edge of edges) {
            if (
                edge.visualOnly &&
                containerChildren.get(edge.from)?.has(edge.to)
            ) {
                const entries = entryChildrenByContainer.get(edge.from) ?? [];
                entries.push(edge.to);
                entryChildrenByContainer.set(edge.from, entries);
            }
        }

        // Add only non-container nodes with dimensions
        // Container nodes will get bounding boxes calculated post-layout
        const layoutNodes = nodes.filter((node) => !isOpenContainer(node));

        layoutNodes.forEach((node) => {
            const dimensions = this.getNodeDimensions(node);
            graph.setNode(node.id, {
                height: dimensions.height,
                label: node.label,
                shape: node.style?.shape || 'rect',
                width: dimensions.width,
            });
        });

        // Add edges (visual-only edges are normally routed manually, never fed to
        // dagre for ranking — except a visual-only edge between two non-open-container
        // endpoints, which still needs a rank: a collapsed container's `-> Next` edge
        // relies on this, since the non-visual end-marker edge that used to carry
        // ranking is deleted along with the container's descendants by applyCollapse.
        // Self-loops (Retry) are always excluded — they're never meaningfully ranked.
        edges
            .filter((edge) => {
                if (edge.from === edge.to) {
                    return false;
                }
                if (!edge.visualOnly) {
                    return true;
                }
                return !containerIds.has(edge.from) && !containerIds.has(edge.to);
            })
            .forEach((edge) => {
                const toIsContainer = containerIds.has(edge.to);
                const fromIsContainer = containerIds.has(edge.from);

                if (toIsContainer && !fromIsContainer) {
                    // Rank the source above the container's entry states. Adding the literal
                    // source->container edge would make dagre create a dimensionless phantom
                    // node and emit NaN routing points, so redirect onto the entry children.
                    for (const child of entryChildrenByContainer.get(edge.to) ?? []) {
                        graph.setEdge(
                            edge.from,
                            child,
                            { label: edge.label, type: edge.type },
                            `${edge.id}#entry#${child}`,
                        );
                    }
                    return;
                }
                if (fromIsContainer || toIsContainer) {
                    // Any other container-touching edge is routed manually below.
                    return;
                }

                graph.setEdge(
                    edge.from,
                    edge.to,
                    { label: edge.label, type: edge.type },
                    edge.id,
                );
            });

        // Run layout algorithm
        dagre.layout(graph);

        // Extract positioned nodes
        const positionedNodes = layoutNodes.map((node) => {
            const dagNode = graph.node(node.id);
            return {
                ...node,
                height: dagNode.height,
                width: dagNode.width,
                x: dagNode.x,
                y: dagNode.y,
            };
        });

        // Calculate bounding boxes for container nodes based on their children
        const positionedNodeIndex = new Map(
            positionedNodes.map((node) => [node.id, node]),
        );
        const containerNodes = this.calculateContainerBounds({
            containers: nodes.filter((node) => isOpenContainer(node)),
            positionedNodeIndex,
        });

        // Combine all nodes
        const allPositionedNodes = [...positionedNodes, ...containerNodes];

        // Index positioned nodes by id so visual-edge routing is O(1) per lookup
        const positionedNodesById = new Map(
            allPositionedNodes.map((node) => [node.id, node]),
        );

        // Self-loops are routed manually from the node's own geometry, so without a
        // per-node index N loops on one state would draw N identical stacked arcs.
        const loopIndexById = new Map<string, number>();
        const loopCountByNode = new Map<string, number>();
        for (const edge of edges) {
            if (edge.from !== edge.to) {
                continue;
            }
            const loopIndex = loopCountByNode.get(edge.from) ?? 0;
            loopIndexById.set(edge.id, loopIndex);
            loopCountByNode.set(edge.from, loopIndex + 1);
        }

        // Extract edge routing points
        const routedEdges = edges.map((edge) => {
            const fromNode = positionedNodesById.get(edge.from);
            const toNode = positionedNodesById.get(edge.to);
            const touchesContainer = Boolean(
                (fromNode && isOpenContainer(fromNode)) || (toNode && isOpenContainer(toNode)),
            );

            // Visual-only edges, any edge touching a container, and self-loops (never
            // added to the dagre graph — see the edge filter above) are routed manually.
            const isSelfLoop = edge.from === edge.to;
            if (edge.visualOnly || touchesContainer || isSelfLoop) {
                return {
                    ...edge,
                    ...(isSelfLoop ? { loopIndex: loopIndexById.get(edge.id) ?? 0 } : {}),
                    points: this.calculateVisualEdgePoints({
                        edge,
                        loopIndex: loopIndexById.get(edge.id) ?? 0,
                        positionedNodesById,
                    }),
                };
            }

            const dagEdge = graph.edge(edge.from, edge.to, edge.id);
            return {
                ...edge,
                points: dagEdge?.points ?? [], // Array of {x, y} for routing
            };
        });

        // Get final graph dimensions
        const graphDims = graph.graph();

        return {
            edges: routedEdges,
            graph: {
                height: this.options.height || (graphDims.height ?? 600),
                width: this.options.width || (graphDims.width ?? 800),
            },
            nodes: allPositionedNodes,
        };
    }

    /**
     * Calculate bounding boxes for container nodes based on their children positions
     */
    private calculateContainerBounds(params: {
        containers: StateNode[];
        positionedNodeIndex: Map<string, StateNode>;
    }): StateNode[] {
        const { containers, positionedNodeIndex } = params;

        return containers.map((container) => {
            // Resolve child nodes directly from the index (O(children)) and exclude
            // end markers, which are just visual indicators.
            const children: StateNode[] = [];
            for (const childId of container.children || []) {
                const child = positionedNodeIndex.get(childId);
                if (child && child.type !== 'BranchEnd' && child.type !== 'IteratorEnd') {
                    children.push(child);
                }
            }

            if (children.length === 0) {
                // No children, use default dimensions
                return {
                    ...container,
                    height: 200,
                    width: 400,
                    x: 0,
                    y: 0,
                };
            }

            // Calculate bounding box from children positions.
            // Use a single reduce pass (instead of Math.min(...spread)) to avoid both
            // four array allocations and call-stack overflow on very large containers.
            const padding = CONTAINER_PADDING;
            const headerHeight = CONTAINER_HEADER_HEIGHT;

            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (const child of children) {
                const halfWidth = (child.width || 0) / 2;
                const halfHeight = (child.height || 0) / 2;
                const childX = child.x || 0;
                const childY = child.y || 0;
                minX = Math.min(minX, childX - halfWidth);
                maxX = Math.max(maxX, childX + halfWidth);
                minY = Math.min(minY, childY - halfHeight);
                maxY = Math.max(maxY, childY + halfHeight);
            }

            const width = maxX - minX + padding * 2;
            const height = maxY - minY + padding * 2 + headerHeight;
            const x = (minX + maxX) / 2;
            const y = (minY + maxY) / 2 + headerHeight / 2;

            return {
                ...container,
                height,
                width,
                x,
                y,
            };
        });
    }

    /**
     * Calculate routing points for visual-only edges
     */
    private calculateVisualEdgePoints(params: {
        edge: GraphEdge;
        loopIndex: number;
        positionedNodesById: Map<string, StateNode>;
    }): Array<{ x: number; y: number }> {
        const { edge, loopIndex, positionedNodesById } = params;

        const fromNode = positionedNodesById.get(edge.from);
        const toNode = positionedNodesById.get(edge.to);

        if (!fromNode || !toNode) {
            return [];
        }

        // Self-loop (e.g. a Retry edge): route as a small loop bulging off the node,
        // perpendicular to the graph's flow direction so it never runs across the
        // outgoing edge to the next rank. Points are [entry, apex, exit]; the renderer
        // draws a curve bulging to the apex.
        if (edge.from === edge.to) {
            const rankdir = this.options.layout || 'TB';
            const loopReach = LOOP_BASE_REACH + loopIndex * LOOP_REACH_STEP;
            const loopSpread = LOOP_BASE_SPREAD + loopIndex * LOOP_SPREAD_STEP;

            if (rankdir === 'LR' || rankdir === 'RL') {
                // Flow is horizontal, so same-rank neighbors sit above/below the node -
                // loop off the top edge instead of the right edge.
                const topY = (fromNode.y || 0) - (fromNode.height || 0) / 2;
                const centerX = fromNode.x || 0;
                return [
                    { x: centerX - loopSpread, y: topY },
                    { x: centerX, y: topY - loopReach },
                    { x: centerX + loopSpread, y: topY },
                ];
            }

            const rightX = (fromNode.x || 0) + (fromNode.width || 0) / 2;
            const centerY = fromNode.y || 0;
            return [
                { x: rightX, y: centerY - loopSpread },
                { x: rightX + loopReach, y: centerY },
                { x: rightX, y: centerY + loopSpread },
            ];
        }

        // For container nodes, check if toNode is a child (branch start)
        if (fromNode.isContainer && fromNode.children?.includes(edge.to)) {
            // Edge from container to branch start: start below header
            const headerHeight = CONTAINER_HEADER_HEIGHT;
            const fromX = fromNode.x || 0;
            const toX = toNode.x || 0;
            const fromY = (fromNode.y || 0) - (fromNode.height || 0) / 2 + headerHeight;
            const toY = (toNode.y || 0) - (toNode.height || 0) / 2;

            // The header band ends exactly where the children begin, so a child sitting
            // directly under the container's centre leaves this connector with nowhere
            // to go. Emit nothing rather than a zero-length path: `marker-end` on one
            // has no defined orientation, so the arrowhead renders at an arbitrary
            // angle, detached from the flow. A Parallel's branch starts are offset in x
            // and still get their fan-out line.
            if (fromX === toX && toY <= fromY) {
                return [];
            }

            // Create a path that goes from center of header down to the branch start
            return [
                { x: fromX, y: fromY },
                { x: toX, y: toY },
            ];
        }

        // For container to next state: draw from bottom center of container to top of next state
        // Use container's X position (center) rather than toNode's X
        const fromX = fromNode.x || 0;
        const fromY = (fromNode.y || 0) + (fromNode.height || 0) / 2;
        const toX = toNode.x || 0;
        const toY = (toNode.y || 0) - (toNode.height || 0) / 2;

        return [
            { x: fromX, y: fromY },
            { x: toX, y: toY },
        ];
    }

    /**
     * Get node dimensions based on shape and options
     */
    private getNodeDimensions(node: StateNode): {
        height: number;
        width: number;
    } {
        const baseWidth = this.options.nodeWidth || 120;
        const baseHeight = this.options.nodeHeight || 60;
        // The base height fits a name plus one stacked line. Anything further - a Wait
        // state's duration alongside its assigned variables, or an execution overlay's
        // annotation - would otherwise be drawn past the node's bottom border.
        const stackedHeight = this.extraStackedLines(node) * STACKED_LINE_HEIGHT;

        // Adjust dimensions based on shape
        switch (node.style?.shape) {
            case 'circle': {
                // Circles need to be square to render properly
                // Branch end markers should be small
                if (node.type === 'BranchEnd' || node.type === 'IteratorEnd') {
                    return { height: 16, width: 16 };
                }
                // Terminal states (Succeed/Fail) use consistent fixed sizing
                // AWS uses same size for all terminal states regardless of label length
                // Use a fixed diameter that accommodates most reasonable labels
                const terminalDiameter = baseHeight * 1.4; // ~84px with default 60px height
                return { height: terminalDiameter, width: terminalDiameter };
            }
            case 'diamond':
                // Diamonds need extra space for rotation
                return { height: baseHeight * 1.2 + stackedHeight, width: baseWidth * 1.2 };
            default:
                return { height: baseHeight + stackedHeight, width: baseWidth };
        }
    }

    /**
     * How many stacked lines a node renders *beyond* the one the base height allows
     * for. Mirrors the order `SvgRenderer` stacks them in: sub-label, then execution
     * annotation, then assigned variables.
     */
    private extraStackedLines(node: StateNode): number {
        const lines =
            (getNodeSubLabelParts({
                node,
                showStateType: this.options.showStateTypes === true,
            }).length > 0
                ? 1
                : 0) +
            (this.options.nodeAnnotations?.[node.id] ? 1 : 0) +
            (this.options.showVariables !== false && node.assignedVariables?.length ? 1 : 0);

        return Math.max(0, lines - 1);
    }
}
