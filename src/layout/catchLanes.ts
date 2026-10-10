import { isOpenContainer } from '../graph';
import type { GraphEdge, LayoutDirection, StateNode } from '../types';
import { measureEdgeLabel } from './edgeLabel';
import { anchorOnNode, crossOf, flowOf, halfExtents, toPoint } from './orthogonalRoute';
import type { Frame } from './orthogonalRoute';

/**
 * How many distinct states must catch into one handler before its catch edges are
 * bundled onto a shared lane. Below this the fan of per-edge routes stays small and
 * dagre's own routing reads fine.
 */
export const CATCH_LANE_MIN_SOURCES = 4;

/** Gap in px between the content edge and a lane, and between neighbouring lanes. */
const CATCH_LANE_GAP = 20;

/** Gap in px between two labels stacked on the same lane. */
const LANE_LABEL_GAP = 4;

/** Flow coordinates closer than this count as the same row. */
const ROW_EPSILON = 1e-6;

/** A point in layout space. */
interface Point {
    x: number;
    y: number;
}

/** A directed edge, reduced to what ancestry needs. */
interface FlowEdge {
    from: string;
    to: string;
}

/** Parameters for {@link buildAcyclicPredecessors}. */
export interface BuildAcyclicPredecessorsParams {
    /** Directed edges; endpoints that are not in `nodeIds` and self-loops are ignored */
    edges: FlowEdge[];
    /** Every node id, in layout order; it fixes where the depth-first search starts */
    nodeIds: string[];
}

/**
 * Build a predecessor map over the acyclic part of a graph: a depth-first search drops
 * each back edge (an edge into a node still on the search stack), so loops in a state
 * machine do not make a state its own ancestor.
 *
 * Iterative on purpose: machines with thousands of chained states would overflow the
 * stack with a recursive search.
 *
 * @param params.edges - Directed edges, in layout order
 * @param params.nodeIds - Every node id, in layout order
 * @returns For each node with at least one remaining in-edge, its predecessors
 *
 * @example
 * ```typescript
 * buildAcyclicPredecessors({
 *     edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
 *     nodeIds: ['A', 'B'],
 * });
 * // Map { 'B' => ['A'] }  - the B -> A back edge is dropped
 * ```
 */
export function buildAcyclicPredecessors(
    params: BuildAcyclicPredecessorsParams,
): Map<string, string[]> {
    const { edges, nodeIds } = params;
    const known = new Set(nodeIds);
    const successors = new Map<string, string[]>();
    const hasInEdge = new Set<string>();
    for (const edge of edges) {
        if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) {
            continue;
        }
        const list = successors.get(edge.from) ?? [];
        list.push(edge.to);
        successors.set(edge.from, list);
        hasInEdge.add(edge.to);
    }

    const predecessors = new Map<string, string[]>();
    const onStack = new Set<string>();
    const done = new Set<string>();
    const visit = (root: string): void => {
        const stack: Array<{ index: number; node: string }> = [{ index: 0, node: root }];
        onStack.add(root);
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const next = successors.get(frame.node)?.[frame.index];
            if (next === undefined) {
                onStack.delete(frame.node);
                done.add(frame.node);
                stack.pop();
                continue;
            }
            frame.index += 1;
            if (onStack.has(next)) {
                continue;
            }
            const list = predecessors.get(next) ?? [];
            list.push(frame.node);
            predecessors.set(next, list);
            if (!done.has(next)) {
                onStack.add(next);
                stack.push({ index: 0, node: next });
            }
        }
    };

    for (const nodeId of nodeIds) {
        if (!hasInEdge.has(nodeId) && !done.has(nodeId)) {
            visit(nodeId);
        }
    }
    for (const nodeId of nodeIds) {
        if (!done.has(nodeId)) {
            visit(nodeId);
        }
    }
    return predecessors;
}

/** Parameters for {@link selectLaneCatchEdges}. */
export interface SelectLaneCatchEdgesParams {
    /** Catch edges eligible for bundling: plain states at both ends, no self-loops */
    candidates: GraphEdge[];
    /** Every node id dagre lays out, in layout order */
    nodeIds: string[];
    /**
     * Every edge dagre would rank. `id` is the originating GraphEdge's id, so edges
     * redirected onto a container's entry children still match their candidate.
     */
    rankedEdges: Array<{ from: string; id: string; to: string }>;
}

/**
 * Pick the catch edges to take away from dagre and route along a lane instead.
 *
 * A handler is "shared" once {@link CATCH_LANE_MIN_SOURCES} distinct states catch into
 * it. Dagre pays for every rank an edge crosses, and the edges from a long chain of
 * catchers into one sink cross O(n) ranks each, so the cost is quadratic. A catcher
 * whose flow leads on to another catcher of the same handler does not need its own
 * edge in dagre: the later catcher's edge already ranks the handler below it. So only
 * those edges are withheld, and the handler stays exactly where dagre puts it today.
 *
 * Ancestry is read off the edges dagre also ranks, minus the candidates themselves, so
 * a withheld catcher is always above a kept one in dagre's own ranking.
 *
 * @param params.candidates - Catch edges eligible for bundling
 * @param params.nodeIds - Every node id dagre lays out, in layout order
 * @param params.rankedEdges - Every edge dagre would rank, with originating edge ids
 * @returns The ids of the catch edges to route along a lane
 *
 * @example
 * ```typescript
 * const laneIds = selectLaneCatchEdges({ candidates, nodeIds, rankedEdges });
 * // For Step0 -> ... -> Step9, each catching into Failed: every Step but Step9
 * ```
 */
export function selectLaneCatchEdges(params: SelectLaneCatchEdgesParams): Set<string> {
    const { candidates, nodeIds, rankedEdges } = params;
    const groups = new Map<string, GraphEdge[]>();
    for (const edge of candidates) {
        const group = groups.get(edge.to) ?? [];
        group.push(edge);
        groups.set(edge.to, group);
    }
    const sharedGroups = [...groups.values()].filter(
        (group) => new Set(group.map((edge) => edge.from)).size >= CATCH_LANE_MIN_SOURCES,
    );
    const laneEdgeIds = new Set<string>();
    if (sharedGroups.length === 0) {
        return laneEdgeIds;
    }

    // Catch edges are left out of the ancestry graph: a withheld edge is not in dagre,
    // so it cannot carry any ordering. Dropping all of them only shrinks ancestry,
    // which keeps more edges in dagre, never fewer.
    const candidateIds = new Set(candidates.map((edge) => edge.id));
    const predecessors = buildAcyclicPredecessors({
        edges: rankedEdges.filter((edge) => !candidateIds.has(edge.id)),
        nodeIds,
    });

    for (const group of sharedGroups) {
        // A source ends up in `ancestors` only if some walk reached it along an edge,
        // that is, only if it leads on to another source of this group.
        const ancestors = new Set<string>();
        const queued = new Set(group.map((edge) => edge.from));
        const queue = [...queued];
        for (let head = 0; head < queue.length; head += 1) {
            for (const predecessor of predecessors.get(queue[head]) ?? []) {
                ancestors.add(predecessor);
                if (!queued.has(predecessor)) {
                    queued.add(predecessor);
                    queue.push(predecessor);
                }
            }
        }
        for (const edge of group) {
            if (ancestors.has(edge.from)) {
                laneEdgeIds.add(edge.id);
            }
        }
    }
    return laneEdgeIds;
}

/** A routed catch edge: its polyline and, when it has a label, where to draw it. */
export interface CatchLaneRoute {
    labelPosition?: Point;
    points: Point[];
}

/** An edge already routed by dagre or by hand, as seen by the lane router. */
interface ObstacleEdge {
    label?: string;
    labelPosition?: Point;
    points?: Point[];
}

/** Parameters for {@link routeCatchLanes}. */
export interface RouteCatchLanesParams {
    /** The lane edges, in graph order */
    edges: GraphEdge[];
    layout: LayoutDirection;
    /** Every positioned node, containers included */
    nodes: StateNode[];
    /** Every routed edge that is not a lane edge; lanes keep clear of them */
    obstacleEdges: ObstacleEdge[];
    rankSeparation: number;
    themeFontSize: number;
}

/**
 * Route withheld catch edges along one lane per handler, after dagre has positioned
 * everything.
 *
 * A lane is a trunk running parallel to the flow just outside the finished diagram, on
 * the side self-loops never use (left in TB/BT, below in LR/RL). Each edge leaves its
 * source through the gap between ranks, runs sideways to the trunk, follows it to the
 * handler's gap and steps back in. Horizontal runs stay inside the gaps (a quarter of
 * `rankSeparation` past a row), so nothing crosses a node or one of dagre's label boxes.
 * Labels sit on the trunk, packed so they never overlap each other.
 *
 * @param params.edges - The lane edges, in graph order
 * @param params.layout - The layout direction
 * @param params.nodes - Every positioned node, containers included
 * @param params.obstacleEdges - Every routed non-lane edge
 * @param params.rankSeparation - The layout's rank separation
 * @param params.themeFontSize - The theme's base font size, for label sizing
 * @returns The route for each lane edge, keyed by edge id
 *
 * @example
 * ```typescript
 * const routes = routeCatchLanes({ edges, layout: 'TB', nodes, obstacleEdges, rankSeparation: 50, themeFontSize: 14 });
 * routes.get(edge.id)?.points; // axis-aligned polyline beside the diagram
 * ```
 */
export function routeCatchLanes(params: RouteCatchLanesParams): Map<string, CatchLaneRoute> {
    const { edges, layout, nodes, obstacleEdges, rankSeparation, themeFontSize } = params;
    const frame: Frame = { vertical: layout === 'TB' || layout === 'BT' };
    const dir = layout === 'TB' || layout === 'LR' ? 1 : -1;
    const laneSide = frame.vertical ? -1 : 1;
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    const centreOf = (node: StateNode): Point => ({ x: node.x || 0, y: node.y || 0 });
    const flowOfNode = (node: StateNode): number => flowOf({ frame, point: centreOf(node) });
    const crossOfNode = (node: StateNode): number => crossOf({ frame, point: centreOf(node) });
    const labelBox = (label: string): { cross: number; flow: number } => {
        const box = measureEdgeLabel({ label, themeFontSize });
        return frame.vertical
            ? { cross: box.width, flow: box.height }
            : { cross: box.height, flow: box.width };
    };

    // The extreme cross coordinate on the lane side over everything already drawn.
    let outer = -laneSide * Infinity;
    const reach = (value: number): void => {
        if (laneSide * value > laneSide * outer) {
            outer = value;
        }
    };
    for (const node of nodes) {
        reach(crossOfNode(node) + laneSide * halfExtents({ frame, node }).halfCross);
    }
    for (const edge of obstacleEdges) {
        for (const point of edge.points ?? []) {
            reach(crossOf({ frame, point }));
        }
        if (edge.label && edge.labelPosition) {
            const half = labelBox(edge.label).cross / 2;
            reach(crossOf({ frame, point: edge.labelPosition }) + laneSide * half);
        }
    }

    // dagre gives every node in a rank the same flow centre, so a row's extent is the
    // tallest node sharing that centre.
    const containerBoxes = nodes.filter((node) => isOpenContainer(node));
    const rowHalf = new Map<number, number>();
    for (const node of nodes) {
        if (isOpenContainer(node)) {
            continue;
        }
        const flow = flowOfNode(node);
        rowHalf.set(flow, Math.max(rowHalf.get(flow) ?? 0, halfExtents({ frame, node }).halfFlow));
    }
    const rowEnd = (node: StateNode, sign: number): number => {
        const flow = flowOfNode(node);
        return flow + sign * (rowHalf.get(flow) ?? halfExtents({ frame, node }).halfFlow);
    };

    // The distance a stub can run past a row before it would enter an open container
    // whose cross extent it shares; Infinity when no container is in the way.
    const clearance = (sign: number, rowEdge: number, spanLow: number, spanHigh: number): number => {
        let nearest = Infinity;
        for (const box of containerBoxes) {
            const { halfCross, halfFlow } = halfExtents({ frame, node: box });
            const boxCross = crossOfNode(box);
            if (boxCross + halfCross < spanLow || boxCross - halfCross > spanHigh) {
                continue;
            }
            const facing = flowOfNode(box) - sign * halfFlow;
            const distance = (facing - rowEdge) * sign;
            if (distance >= 0) {
                nearest = Math.min(nearest, distance);
            }
        }
        return nearest;
    };

    const byHandler = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
        const group = byHandler.get(edge.to) ?? [];
        group.push(edge);
        byHandler.set(edge.to, group);
    }

    const quarter = rankSeparation / 4;
    const routes = new Map<string, CatchLaneRoute>();
    for (const [handlerId, group] of byHandler) {
        const handler = nodesById.get(handlerId);
        if (!handler) {
            continue;
        }
        const half = group.reduce((widest, edge) => Math.max(widest, edge.label ? labelBox(edge.label).cross / 2 : 0), 0);
        const laneCross = outer + laneSide * (CATCH_LANE_GAP + half);
        outer = laneCross + laneSide * half;

        const handlerCross = crossOfNode(handler);
        const handlerSpan: [number, number] = [Math.min(handlerCross, laneCross), Math.max(handlerCross, laneCross)];
        const handlerEdge = rowEnd(handler, -dir);
        const dstGap = handlerEdge - dir * Math.min(quarter, clearance(-dir, handlerEdge, ...handlerSpan) / 2);

        const stubs: Array<{ edge: GraphEdge; srcGap: number }> = [];
        for (const edge of group) {
            const source = nodesById.get(edge.from);
            if (!source) {
                continue;
            }
            const sourceCross = crossOfNode(source);
            const sourceEdge = rowEnd(source, dir);
            const srcGap =
                sourceEdge +
                dir *
                    Math.min(
                        quarter,
                        clearance(dir, sourceEdge, Math.min(sourceCross, laneCross), Math.max(sourceCross, laneCross)) /
                            2,
                    );
            const p0 = anchorOnNode({
                adjacent: toPoint({ cross: sourceCross + laneSide * halfExtents({ frame, node: source }).halfCross, flow: srcGap, frame }),
                frame,
                node: source,
            });
            const p5 = anchorOnNode({
                adjacent: toPoint({ cross: handlerCross + laneSide * halfExtents({ frame, node: handler }).halfCross, flow: dstGap, frame }),
                frame,
                node: handler,
            });
            const at = (cross: number, flow: number): Point => toPoint({ cross, flow, frame });
            const p0Cross = crossOf({ frame, point: p0 });
            const p5Cross = crossOf({ frame, point: p5 });
            const points = [p0, at(p0Cross, srcGap), at(laneCross, srcGap), at(laneCross, dstGap), at(p5Cross, dstGap), p5];

            // d3's curveBasis blends each point with its neighbours, so a long trunk with
            // only two interior points bows well into the diagram near its ends. Four
            // collinear points keep the curve exactly on the trunk beyond 2 * quarter of
            // either end; orthogonal routing drops them again as collinear.
            const trunk = dstGap - srcGap;
            if (quarter > 0 && Math.abs(trunk) >= 4 * quarter) {
                const step = Math.sign(trunk) * quarter;
                points.splice(
                    3,
                    0,
                    at(laneCross, srcGap + step),
                    at(laneCross, srcGap + 2 * step),
                    at(laneCross, dstGap - 2 * step),
                    at(laneCross, dstGap - step),
                );
            }
            routes.set(edge.id, { points });
            stubs.push({ edge, srcGap });
        }

        // Labels are packed per handler in one pass. Each wants the middle of the trunk
        // stretch between its own source's row and the next source's row, so on a chain
        // they sit one row apart beside their sources. Where the trunk is too full they
        // slide on toward the handler rather than overlap.
        if (stubs.length === 0) {
            continue;
        }
        const toward = Math.sign(dstGap - stubs[0].srcGap) || dir;
        const distinctGaps = [...new Set(stubs.map((stub) => stub.srcGap * toward))].sort((a, b) => a - b);
        const wanted = stubs
            .filter((stub) => stub.edge.label)
            .map((stub) => {
                const own = stub.srcGap * toward;
                const next = distinctGaps.find((gap) => gap - own > ROW_EPSILON);
                const stop = next === undefined ? dstGap * toward : Math.min(next, dstGap * toward);
                return { desired: (own + Math.max(stop, own)) / 2, edge: stub.edge };
            })
            .sort((a, b) => a.desired - b.desired);
        let previousEnd = -Infinity;
        for (const { desired, edge } of wanted) {
            const extent = labelBox(edge.label as string).flow;
            const centre = Math.max(desired, previousEnd + LANE_LABEL_GAP + extent / 2);
            previousEnd = centre + extent / 2;
            const route = routes.get(edge.id);
            if (route) {
                route.labelPosition = toPoint({ cross: laneCross, flow: centre * toward, frame });
            }
        }
    }
    return routes;
}

/** A centre-based axis-aligned box, like a positioned StateNode (a missing value reads as 0). */
interface Box {
    height?: number;
    width?: number;
    x?: number;
    y?: number;
}

/** Parameters for {@link findLaneCollisions}. */
export interface FindLaneCollisionsParams {
    boxes: Box[];
    routes: Iterable<CatchLaneRoute>;
}

/** How far a box is shrunk before testing, so a segment grazing its edge is not a hit. */
const COLLISION_INSET = 0.5;

/**
 * Whether any lane segment passes through the inside of any box. Lane routes are
 * axis-aligned, so a segment's bounding box is the segment.
 *
 * @param params.boxes - Centre-based boxes to keep clear, such as open containers
 * @param params.routes - The lane routes to test
 * @returns True if at least one segment enters a box
 *
 * @example
 * ```typescript
 * findLaneCollisions({ boxes: containers, routes: routes.values() }); // false when clear
 * ```
 */
export function findLaneCollisions(params: FindLaneCollisionsParams): boolean {
    const { boxes, routes } = params;
    for (const route of routes) {
        for (let index = 1; index < route.points.length; index += 1) {
            const start = route.points[index - 1];
            const end = route.points[index];
            const low = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
            const high = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) };
            for (const box of boxes) {
                const halfWidth = (box.width || 0) / 2;
                const halfHeight = (box.height || 0) / 2;
                const centreX = box.x || 0;
                const centreY = box.y || 0;
                if (
                    high.x > centreX - halfWidth + COLLISION_INSET &&
                    low.x < centreX + halfWidth - COLLISION_INSET &&
                    high.y > centreY - halfHeight + COLLISION_INSET &&
                    low.y < centreY + halfHeight - COLLISION_INSET
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}
