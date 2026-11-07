/**
 * The data a layout engine receives and returns: graph structure plus sizes in,
 * positions and edge points out. Render-only node fields (style, icons, labels and
 * sub-labels) are deliberately absent, so an engine cannot come to depend on them.
 *
 * Experimental: these types may change in a minor release until pluggable layout
 * engines ship (#545). No render function takes an engine yet; dagre is the only one.
 */
import type { EdgeType, LayoutDirection, NodeShape } from '../types';

/**
 * The graph a layout engine positions.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineInput {
    /** Direction the graph flows in. */
    direction: LayoutDirection;
    /** Every edge to route, including ones that do not rank nodes (`visualOnly`). */
    edges: LayoutEngineEdge[];
    /** Minimum horizontal gap between nodes in the same rank, in pixels. */
    nodeSeparation: number;
    /** Every node to position, containers and their children alike. */
    nodes: LayoutEngineNode[];
    /** Margin around the whole graph, in pixels. */
    padding: number;
    /** Minimum gap between ranks, in pixels. */
    rankSeparation: number;
}

/**
 * One node to position. A node with `children` is an open container: the engine sizes
 * its box around those children.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineNode {
    /**
     * Ids of the node's direct children, when it is an open container. Lists every
     * child, including the end-marker nodes that dagre lays out but leaves out of the
     * container's bounds; the contract cannot mark those nodes yet (#545).
     */
    children?: string[];
    /** Height in pixels; for a container, the minimum height of its box. */
    height: number;
    /** The node's graph id, as on `StateNode.id`. */
    id: string;
    /** Space between a container's edge and its children, header band included. */
    padding?: LayoutEnginePadding;
    /** The node's outline, which decides where edges meet it. */
    shape: NodeShape;
    /** Width in pixels; for a container, the minimum width of its box. */
    width: number;
}

/**
 * Padding on each side of a container's box, in pixels.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEnginePadding {
    /** Bottom padding. */
    bottom: number;
    /** Left padding. */
    left: number;
    /** Right padding. */
    right: number;
    /** Top padding. */
    top: number;
}

/**
 * One edge to route.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineEdge {
    /** Id of the source node. */
    from: string;
    /** The edge's graph id, as on `GraphEdge.id`. */
    id: string;
    /** Size of the edge's label box, when it has one, so the engine can leave room for it. */
    labelSize?: { height: number; width: number };
    /** Id of the target node. */
    to: string;
    /** The kind of transition. */
    type: EdgeType;
    /** Drawn, but not used to rank nodes. */
    visualOnly?: boolean;
}

/**
 * A layout engine's result.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineOutput {
    /** One route per input edge. */
    edges: LayoutEngineEdgeRoute[];
    /** One box per input node. */
    nodes: LayoutEngineNodeBox[];
}

/**
 * Where a node ended up.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineNodeBox {
    /** Final height in pixels. */
    height: number;
    /** The input node's id. */
    id: string;
    /** Final width in pixels. */
    width: number;
    /** Horizontal centre of the box, as on `StateNode.x`. */
    x: number;
    /** Vertical centre of the box, as on `StateNode.y`. */
    y: number;
}

/**
 * How an edge is drawn.
 * @experimental May change in a minor release until pluggable layout engines ship.
 */
export interface LayoutEngineEdgeRoute {
    /** The input edge's id. */
    id: string;
    /** Centre of the space reserved for the edge's label, when it has one. */
    labelPosition?: { x: number; y: number };
    /** The polyline the edge follows, from source to target. */
    points: Array<{ x: number; y: number }>;
}
