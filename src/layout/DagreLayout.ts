import dagre from '@dagrejs/dagre';
import type { StateNode, GraphEdge, DiagramOptions } from '../types';

export interface LayoutResult {
    edges: Array<GraphEdge & { points?: Array<{ x: number; y: number }> }>; // With points for routing
    nodes: StateNode[]; // With x, y, width, height populated
    graph: {
        height: number;
        width: number;
    };
}

/**
 * DagreLayout - Calculates node positions and edge routing using Dagre algorithm
 */
export class DagreLayout {
    private options: DiagramOptions;

    constructor(options: DiagramOptions) {
        this.options = options;
    }

    /**
     * Calculate layout positions for nodes and edges
     */
    calculate(nodes: StateNode[], edges: GraphEdge[]): LayoutResult {
        const graph = new dagre.graphlib.Graph();

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

        // Add only non-container nodes with dimensions
        // Container nodes will get bounding boxes calculated post-layout
        const layoutNodes = nodes.filter((node) => !node.isContainer);

        layoutNodes.forEach((node) => {
            const dimensions = this.getNodeDimensions(node);
            graph.setNode(node.id, {
                height: dimensions.height,
                label: node.label,
                shape: node.style?.shape || 'rect',
                width: dimensions.width,
            });
        });

        // Add edges (skip visual-only edges from layout algorithm)
        edges
            .filter((edge) => !edge.visualOnly)
            .forEach((edge) => {
                graph.setEdge(edge.from, edge.to, {
                    label: edge.label,
                    type: edge.type,
                });
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
            containers: nodes.filter((node) => node.isContainer),
            positionedNodeIndex,
        });

        // Combine all nodes
        const allPositionedNodes = [...positionedNodes, ...containerNodes];

        // Index positioned nodes by id so visual-edge routing is O(1) per lookup
        const positionedNodesById = new Map(
            allPositionedNodes.map((node) => [node.id, node]),
        );

        // Extract edge routing points
        const routedEdges = edges.map((edge) => {
            if (edge.visualOnly) {
                // Visual-only edges need manual routing since they're not in the dagre graph
                return {
                    ...edge,
                    points: this.calculateVisualEdgePoints({
                        edge,
                        positionedNodesById,
                    }),
                };
            }

            const dagEdge = graph.edge(edge.from, edge.to);
            return {
                ...edge,
                points: dagEdge.points, // Array of {x, y} for routing
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
            const padding = 40;
            const headerHeight = 50;

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
        positionedNodesById: Map<string, StateNode>;
    }): Array<{ x: number; y: number }> {
        const { edge, positionedNodesById } = params;

        const fromNode = positionedNodesById.get(edge.from);
        const toNode = positionedNodesById.get(edge.to);

        if (!fromNode || !toNode) {
            return [];
        }

        // For container nodes, check if toNode is a child (branch start)
        if (fromNode.isContainer && fromNode.children?.includes(edge.to)) {
            // Edge from container to branch start: start below header
            const headerHeight = 50;
            const fromX = fromNode.x || 0;
            const toX = toNode.x || 0;
            const fromY = (fromNode.y || 0) - (fromNode.height || 0) / 2 + headerHeight;
            const toY = (toNode.y || 0) - (toNode.height || 0) / 2;

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
                return { height: baseHeight * 1.2, width: baseWidth * 1.2 };
            default:
                return { height: baseHeight, width: baseWidth };
        }
    }
}
