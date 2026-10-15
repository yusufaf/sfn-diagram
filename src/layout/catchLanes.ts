import { isOpenContainer } from '../graph';
import type { DiagramOptions, GraphEdge, LayoutDirection, StateNode } from '../types';
import type { PathPoint } from '../utils/pathSample';
import { measureEdgeLabel } from './edgeLabel';
import { anchorOnNode, centreOf, crossOf, flowOf, frameOf, halfExtents, toPoint } from './orthogonalRoute';
import type { Frame } from './orthogonalRoute';

/**
 * How many distinct states must catch into one handler before its catch edges are
 * bundled onto a shared lane. Below this the fan of per-edge routes stays small and
 * dagre's own routing reads fine.
 */
export const CATCH_LANE_MIN_SOURCES = 4;

/**
 * The smallest `rankSeparation` lanes are used at. A stub runs a quarter of the rank
 * separation past its row, so below this it would be drawn along the node borders.
 */
export const CATCH_LANE_MIN_RANK_SEPARATION = 16;

/** Gap in px between the content edge and a lane, and between neighbouring lanes. */
const CATCH_LANE_GAP = 20;

/** Gap in px between two labels stacked on the same lane, or a label and a stub. */
const LANE_LABEL_GAP = 4;

/** Flow coordinates closer than this count as the same row. */
const ROW_EPSILON = 1e-6;

type Point = PathPoint;

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
 * in an acyclic machine a withheld catcher is always above a kept one in dagre's own
 * ranking. In a loop dagre may break a different edge than this search does and rank
 * the handler above some catchers; {@link routeCatchLanes} routes each stub toward the
 * handler's side, so that layout still draws correctly.
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

/** A label's size across the flow axis and along it. */
interface LabelExtent {
    cross: number;
    flow: number;
}

/** One lane edge's stubs, fixed before any lane is placed. */
interface LaneStub {
    /** Flow coordinate of the gap the edge steps into its handler from */
    dstGap: number;
    edge: GraphEdge;
    source: StateNode;
    /** Flow coordinate of the gap the edge leaves its source through */
    srcGap: number;
    /** 1 when the handler lies further along the flow axis than the source, else -1 */
    toward: number;
}

/** A lane edge with its trunk chosen and its label placed. */
interface PackedStub {
    /** The trunk the edge runs along, counted outward from the diagram */
    column: number;
    /** The label's centre on the flow axis; absent for an unlabelled edge */
    labelFlow?: number;
    stub: LaneStub;
}

/** Parameters for {@link laneSideOf}. */
interface LaneSideOfParams {
    frame: Frame;
}

/**
 * The side lanes run on, as a sign on the cross axis: left in TB/BT, below in LR/RL.
 * Self-loops use the other side, so lanes never meet them.
 */
function laneSideOf(params: LaneSideOfParams): number {
    return params.frame.vertical ? -1 : 1;
}

/** Parameters for {@link laneAnchor}. */
interface LaneAnchorParams {
    frame: Frame;
    /** Flow coordinate of the gap the stub runs along */
    gap: number;
    node: StateNode;
    nodeOverrides?: DiagramOptions['nodeOverrides'];
}

/** Where a lane stub attaches to a node: on its side facing `gap`, toward the lane. */
function laneAnchor(params: LaneAnchorParams): Point {
    const { frame, gap, node, nodeOverrides } = params;
    const cross = crossOf({ frame, point: centreOf({ node }) }) + laneSideOf({ frame }) * halfExtents({ frame, node }).halfCross;
    return anchorOnNode({ adjacent: toPoint({ cross, flow: gap, frame }), frame, node, nodeOverrides });
}

/** Parameters for {@link firstBelow}. */
interface FirstBelowParams {
    /** Rows sorted highest first */
    rows: number[];
    value: number;
}

/** The index of the first row strictly below `value`, or `rows.length` when none is. */
function firstBelow(params: FirstBelowParams): number {
    const { rows, value } = params;
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (rows[middle] >= value) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/** Parameters for {@link placeLabel}. */
interface PlaceLabelParams {
    /** Lists of rows the label has to keep off, scaled by `toward`, each sorted highest first */
    blocked: number[][];
    desired: number;
    /** The label's length along the trunk */
    extent: number;
    /** The furthest the label's far end may reach */
    limit: number;
}

/** Parameters for {@link coveredRows}. */
interface CoveredRowsParams {
    /** Lists of rows, each sorted highest first */
    blocked: number[][];
    centre: number;
    /** Half the label's length plus half the gap it keeps from a stub */
    margin: number;
}

/**
 * How many rows a label at `centre` covers. A row within ROW_EPSILON of either end counts
 * as clear, so a label placed exactly against a row is not counted as covering it after
 * `(row - margin) + margin` rounds above `row`.
 */
function coveredRows(params: CoveredRowsParams): number {
    const { blocked, centre, margin } = params;
    return blocked.reduce(
        (count, rows) =>
            count +
            firstBelow({ rows, value: centre - margin + ROW_EPSILON }) -
            firstBelow({ rows, value: centre + margin - ROW_EPSILON }),
        0,
    );
}

/**
 * The centre for a label on a trunk: as near `desired` as `limit` allows, then moved back
 * past every blocked row it would cover. Coordinates are scaled by the side's `toward`, so
 * the handler is always the high end and moving back is moving lower.
 */
function placeLabel(params: PlaceLabelParams): number {
    const { blocked, desired, extent, limit } = params;
    const margin = extent / 2 + LANE_LABEL_GAP / 2;
    let centre = Math.min(desired, limit - extent / 2);
    // Each move takes the label below one more row, so it can make at most one move per
    // row. The cap turns any rounding case that slips past the guards below into a label
    // left over a row rather than a layout that never finishes.
    const maxMoves = blocked.reduce((count, rows) => count + rows.length, 0);
    for (let moves = 0; moves < maxMoves; moves += 1) {
        // The highest covered row across every list; the label moves to just below it.
        let highest = -Infinity;
        for (const rows of blocked) {
            const index = firstBelow({ rows, value: centre + margin - ROW_EPSILON });
            if (index < rows.length && rows[index] > centre - margin + ROW_EPSILON) {
                highest = Math.max(highest, rows[index]);
            }
        }
        const next = highest - margin;
        // Rows within ROW_EPSILON of an end count as clear, so a label just moved below a
        // row does not find it again; the second test stops a move that rounding would
        // turn into no move at all.
        if (highest === -Infinity || next >= centre) {
            break;
        }
        centre = next;
    }
    return centre;
}

/** Parameters for {@link leastBlockedCentre}. */
interface LeastBlockedCentreParams {
    /** Lists of rows the label should keep off, each sorted highest first */
    blocked: number[][];
    desired: number;
    extent: number;
    /** The highest centre allowed */
    high: number;
    /** The lowest centre allowed */
    low: number;
}

/**
 * The centre in `[low, high]` whose label covers the fewest blocked rows, nearest `desired`
 * among equals. For when no centre covers none: a label longer than the gaps between the
 * stubs crossing its trunk cannot avoid all of them.
 */
function leastBlockedCentre(params: LeastBlockedCentreParams): number {
    const { blocked, desired, extent, high, low } = params;
    const margin = extent / 2 + LANE_LABEL_GAP / 2;
    const covered = (centre: number): number => coveredRows({ blocked, centre, margin });
    const candidates = [low, high, Math.min(Math.max(desired, low), high)];
    for (const rows of blocked) {
        for (let index = firstBelow({ rows, value: high + margin }); index < rows.length && rows[index] > low - margin; index += 1) {
            candidates.push(rows[index] - margin, rows[index] + margin);
        }
    }
    let best = candidates[2];
    let bestCovered = covered(best);
    for (const candidate of candidates) {
        if (candidate < low || candidate > high) {
            continue;
        }
        const count = covered(candidate);
        if (count < bestCovered || (count === bestCovered && Math.abs(candidate - desired) < Math.abs(best - desired))) {
            best = candidate;
            bestCovered = count;
        }
    }
    return best;
}

/** Parameters for {@link packLaneLabels}. */
interface PackLaneLabelsParams {
    /** Rows of later lanes' stubs, which cross this lane, in ascending flow order */
    blocked: number[];
    /**
     * How far a label keeps from either end of its trunk stretch. A curved edge only runs
     * exactly along its trunk from a quarter of the rank separation past each corner.
     */
    endClearance: number;
    labelExtent: (label: string) => LabelExtent;
    /** Every lane edge into one handler */
    stubs: LaneStub[];
}

/** What {@link packLaneLabels} returns. */
interface PackLaneLabelsResult {
    /** For each trunk, half the cross size of its widest label */
    halfCross: number[];
    packed: PackedStub[];
}

/**
 * Give each lane edge into one handler a trunk, and its label a place on that trunk.
 *
 * The renderer draws a label at the point of its own path nearest `labelPosition`, so a
 * label has to sit on its own trunk stretch: past its own stub and short of the handler's.
 * Each side of the handler is packed separately, nearest stub first. A label wants the
 * middle of the stretch between its row and the next row toward the handler, and keeps off
 * the rows where other stubs join its trunk or cross it. When the trunk has no room left,
 * that edge and every edge further from the handler move to a new trunk one step further
 * out. Outer trunks therefore only take stubs from rows further from the handler, so no
 * stub crosses an inner trunk where its labels are.
 */
function packLaneLabels(params: PackLaneLabelsParams): PackLaneLabelsResult {
    const { blocked, endClearance, labelExtent, stubs } = params;
    const halfCross = [0];
    const packed: PackedStub[] = [];
    for (const side of [1, -1]) {
        const sideStubs = stubs
            .filter((stub) => stub.toward === side)
            .sort((first, second) => (second.srcGap - first.srcGap) * side);
        if (sideStubs.length === 0) {
            continue;
        }
        const end = sideStubs[0].dstGap * side;
        const laterRows = side === 1 ? [...blocked].reverse() : blocked.map((row) => -row);
        let column = 0;
        // The current trunk's labels on this side in the order they were placed, and the
        // rows where its stubs join it, highest first since stubs arrive nearest first.
        let columnLabels: Array<{ entry: PackedStub; extent: number; floor: number }> = [];
        let columnRows: number[] = [];
        let limit = end - endClearance;
        let row = end;
        let nextRow = end;
        for (const stub of sideStubs) {
            const own = stub.srcGap * side;
            if (row - own > ROW_EPSILON) {
                nextRow = row;
                row = own;
            }
            if (!stub.edge.label) {
                packed.push({ column, stub });
                columnRows.push(own);
                continue;
            }
            const extent = labelExtent(stub.edge.label);
            const desired = (own + nextRow) / 2;
            const floor = own + endClearance + extent.flow / 2;
            let centre = placeLabel({ blocked: [laterRows, columnRows], desired, extent: extent.flow, limit });
            // Before opening another trunk, slide this trunk's labels as far toward the
            // handler as they go, each to a clean spot past its own stub. A label that had
            // to cover a stub may find no such spot, and then the trunk cannot be squeezed.
            let squeezed: number[] | undefined;
            let squeezedLimit = limit;
            if (centre < floor && columnLabels.length > 0) {
                let top = end - endClearance;
                squeezed = [];
                for (const placed of columnLabels) {
                    const placedCentre = placeLabel({ blocked: [laterRows, columnRows], desired: Infinity, extent: placed.extent, limit: top });
                    if (placedCentre < placed.floor) {
                        squeezed = undefined;
                        break;
                    }
                    squeezed.push(placedCentre);
                    top = placedCentre - placed.extent / 2 - LANE_LABEL_GAP;
                }
                if (squeezed) {
                    squeezedLimit = top;
                    centre = placeLabel({ blocked: [laterRows, columnRows], desired, extent: extent.flow, limit: top });
                }
            }
            let openTrunk = false;
            let freshCentre = centre;
            if (centre < floor && columnRows.length > 0) {
                // A fresh trunk has no stubs joining it nearer the handler than this one.
                // Open one if that gives a clean spot. Otherwise only if this trunk has no
                // room left, even squeezed, and either the label fits a fresh trunk or this
                // trunk's labels leave it nowhere to go: when later lanes' stubs alone, or
                // a stretch shorter than the label, rule out a clean spot, a new trunk would
                // only widen the lane.
                const freshLimit = end - endClearance;
                freshCentre = placeLabel({ blocked: [laterRows], desired, extent: extent.flow, limit: freshLimit });
                const full = squeezedLimit - extent.flow / 2 < floor;
                const fitsFresh = freshLimit - extent.flow / 2 >= floor;
                openTrunk = freshCentre >= floor || (full && (fitsFresh || columnLabels.length > 0));
            }
            if (openTrunk) {
                column += 1;
                columnLabels = [];
                columnRows = [];
                limit = end - endClearance;
                centre = freshCentre;
            } else if (squeezed) {
                // Kept whether or not the label now has a clean spot: squeezed, the trunk
                // leaves the fallback below the most room.
                for (const [index, placed] of columnLabels.entries()) {
                    placed.entry.labelFlow = squeezed[index] * side;
                }
                limit = squeezedLimit;
            }
            if (centre < floor) {
                // Still no clean spot: the stretch is shorter than the label, or the stubs
                // crossing it are closer together than the label is long. Keep it on the
                // stretch, covering as few of them as it can.
                const ceiling = limit - extent.flow / 2;
                centre =
                    floor <= ceiling
                        ? leastBlockedCentre({ blocked: [laterRows, columnRows], desired, extent: extent.flow, high: ceiling, low: floor })
                        : (own + end) / 2;
            }
            limit = centre - extent.flow / 2 - LANE_LABEL_GAP;
            halfCross[column] = Math.max(halfCross[column] ?? 0, extent.cross / 2);
            const entry: PackedStub = { column, labelFlow: centre * side, stub };
            columnLabels.push({ entry, extent: extent.flow, floor });
            columnRows.push(own);
            packed.push(entry);
        }
    }
    return { halfCross, packed };
}

/** Parameters for the `rowEnd` helper inside {@link routeCatchLanes}. */
interface RowEndParams {
    node: StateNode;
    /** Which side of the row: 1 for the far side along the flow, -1 for the near side */
    sign: number;
}

/** Parameters for the `clearance` helper inside {@link routeCatchLanes}. */
interface ClearanceParams {
    /** The cross coordinate the stub starts from; it runs from there to the lane */
    cross: number;
    /** The flow coordinate a stub starts from */
    rowEdge: number;
    sign: number;
}

/** Parameters for the `gapPast` helper inside {@link routeCatchLanes}. */
interface GapPastParams {
    node: StateNode;
    /** Which side of the node's row: 1 for the far side along the flow, -1 for the near side */
    sign: number;
}

/** Parameters for the `at` helper inside {@link routeCatchLanes}. */
interface AtParams {
    cross: number;
    flow: number;
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
 * Route withheld catch edges along lanes, after dagre has positioned everything.
 *
 * A lane is a trunk running parallel to the flow just outside the finished diagram, on
 * the side self-loops never use (left in TB/BT, below in LR/RL). Each edge leaves its
 * source through the gap between ranks on the handler's side, runs sideways to the trunk,
 * follows it to the handler's gap and steps back in. Horizontal runs stay inside the gaps
 * (a quarter of `rankSeparation` past a row), so nothing crosses a node or one of dagre's
 * label boxes. Labels sit on their own edge's trunk and never overlap each other; they
 * keep off every stub that reaches their trunk unless the stubs crossing it are closer
 * together than the label is long, and then cover as few as they can. A handler whose
 * labels do not fit on one trunk gets more, side by side (see {@link packLaneLabels}).
 * Each handler's lane lies outside the previous one's.
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
    const frame = frameOf({ layout });
    const dir = layout === 'TB' || layout === 'LR' ? 1 : -1;
    const laneSide = laneSideOf({ frame });
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    const flowOfNode = (node: StateNode): number => flowOf({ frame, point: centreOf({ node }) });
    const crossOfNode = (node: StateNode): number => crossOf({ frame, point: centreOf({ node }) });
    const labelExtents = new Map<string, LabelExtent>();
    const labelExtent = (label: string): LabelExtent => {
        let extent = labelExtents.get(label);
        if (!extent) {
            const box = measureEdgeLabel({ label, themeFontSize });
            extent = frame.vertical ? { cross: box.width, flow: box.height } : { cross: box.height, flow: box.width };
            labelExtents.set(label, extent);
        }
        return extent;
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
        const points = edge.points ?? [];
        for (const point of points) {
            reach(crossOf({ frame, point }));
        }
        if (!edge.label) {
            continue;
        }
        const half = labelExtent(edge.label).cross / 2;
        if (edge.labelPosition) {
            reach(crossOf({ frame, point: edge.labelPosition }) + laneSide * half);
            continue;
        }
        // Without a reserved spot the renderer centres the label on the path's midpoint,
        // which lies inside the points' hull, so the outermost point bounds it.
        for (const point of points) {
            reach(crossOf({ frame, point }) + laneSide * half);
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
    const rowEnd = (params: RowEndParams): number => {
        const { node, sign } = params;
        const flow = flowOfNode(node);
        // DagreLayout only bundles edges between plain states, whose rows are all in
        // rowHalf. rowHalf leaves open containers out, so one from another caller uses
        // its own size, even when a plain state shares its centre.
        const half = isOpenContainer(node)
            ? halfExtents({ frame, node }).halfFlow
            : (rowHalf.get(flow) ?? halfExtents({ frame, node }).halfFlow);
        return flow + sign * half;
    };

    // The distance a stub can run past a row before it would enter an open container
    // between it and the lane; Infinity when no container is in the way. Every lane lies
    // beyond every node, so which containers are in the way does not depend on where the
    // stub's lane ends up.
    const clearance = (params: ClearanceParams): number => {
        const { cross, rowEdge, sign } = params;
        let nearest = Infinity;
        for (const box of containerBoxes) {
            const { halfCross, halfFlow } = halfExtents({ frame, node: box });
            const boxCross = crossOfNode(box);
            if (laneSide * (boxCross + laneSide * halfCross) < laneSide * cross) {
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

    const quarter = rankSeparation / 4;
    const gapPast = (params: GapPastParams): number => {
        const { node, sign } = params;
        const rowEdge = rowEnd({ node, sign });
        return rowEdge + sign * Math.min(quarter, clearance({ cross: crossOfNode(node), rowEdge, sign }) / 2);
    };

    // A loop in the machine can rank a handler above some of its catchers, so each stub
    // leaves its source on whichever side the handler is.
    const groups = new Map<string, { handler: StateNode; stubs: LaneStub[] }>();
    for (const edge of edges) {
        const handler = nodesById.get(edge.to);
        const source = nodesById.get(edge.from);
        if (!handler || !source) {
            continue;
        }
        let group = groups.get(handler.id);
        if (!group) {
            group = { handler, stubs: [] };
            groups.set(handler.id, group);
        }
        const toward = Math.sign(flowOfNode(handler) - flowOfNode(source)) || dir;
        group.stubs.push({
            dstGap: gapPast({ node: handler, sign: -toward }),
            edge,
            source,
            srcGap: gapPast({ node: source, sign: toward }),
            toward,
        });
    }

    // A later handler's lane lies further out, so its stubs cross every earlier lane, and
    // an earlier lane's labels keep off their rows.
    const groupList = [...groups.values()];
    const blockedRows: number[][] = new Array(groupList.length);
    const laterRows = new Set<number>();
    for (let index = groupList.length - 1; index >= 0; index -= 1) {
        blockedRows[index] = [...laterRows].sort((first, second) => first - second);
        for (const stub of groupList[index].stubs) {
            laterRows.add(stub.srcGap);
            laterRows.add(stub.dstGap);
        }
    }

    const at = (params: AtParams): Point => toPoint({ ...params, frame });
    const routes = new Map<string, CatchLaneRoute>();
    for (const [index, { handler, stubs }] of groupList.entries()) {
        const { halfCross, packed } = packLaneLabels({
            blocked: blockedRows[index],
            endClearance: Math.max(LANE_LABEL_GAP, quarter),
            labelExtent,
            stubs,
        });
        const columnCross = halfCross.map((half) => {
            const cross = outer + laneSide * (CATCH_LANE_GAP + half);
            outer = cross + laneSide * half;
            return cross;
        });

        for (const { column, labelFlow, stub } of packed) {
            const { dstGap, srcGap } = stub;
            const laneCross = columnCross[column];
            const p0 = laneAnchor({ frame, gap: srcGap, node: stub.source });
            const p5 = laneAnchor({ frame, gap: dstGap, node: handler });
            const p0Cross = crossOf({ frame, point: p0 });
            const p5Cross = crossOf({ frame, point: p5 });
            const points = [p0, at({ cross: p0Cross, flow: srcGap }), at({ cross: laneCross, flow: srcGap }), at({ cross: laneCross, flow: dstGap }), at({ cross: p5Cross, flow: dstGap }), p5];

            // d3's curveBasis blends each point with its neighbours, so a long trunk with
            // only two interior points bows well into the diagram near its ends. With four
            // more collinear points, every basis segment from one quarter past either corner
            // has only trunk points as controls, so the curve runs exactly on the trunk
            // there; orthogonal routing drops them again as collinear.
            const trunk = dstGap - srcGap;
            if (quarter > 0 && Math.abs(trunk) >= 4 * quarter) {
                const step = Math.sign(trunk) * quarter;
                points.splice(
                    3,
                    0,
                    at({ cross: laneCross, flow: srcGap + step }),
                    at({ cross: laneCross, flow: srcGap + 2 * step }),
                    at({ cross: laneCross, flow: dstGap - 2 * step }),
                    at({ cross: laneCross, flow: dstGap - step }),
                );
            }
            routes.set(stub.edge.id, {
                ...(labelFlow === undefined ? {} : { labelPosition: at({ cross: laneCross, flow: labelFlow }) }),
                points,
            });
        }
    }
    return routes;
}

/** Parameters for {@link anchorCatchLaneEnds}. */
export interface AnchorCatchLaneEndsParams {
    /** A lane edge as {@link routeCatchLanes} routed it */
    edge: { from: string; points?: Point[]; to: string };
    layout: LayoutDirection;
    /** Per-node overrides, whose `shape` wins over the node's own */
    nodeOverrides?: DiagramOptions['nodeOverrides'];
    nodesById: Map<string, StateNode>;
}

/**
 * Re-attach a lane route's two ends to the shapes `nodeOverrides` draws. The layout
 * attaches them to each node's own shape, since the layout cache does not key on
 * overrides; orthogonal routing re-anchors every edge itself, so this is for the curved
 * and straight styles.
 *
 * @param params.edge - The lane edge
 * @param params.layout - The layout direction
 * @param params.nodeOverrides - Per-node overrides
 * @param params.nodesById - Positioned nodes by id
 * @returns The route with both ends re-anchored, still axis-aligned; the original
 *   points when the route is not a lane route
 *
 * @example
 * ```typescript
 * const points = anchorCatchLaneEnds({ edge, layout: 'TB', nodeOverrides: { Failed: { shape: 'rect' } }, nodesById });
 * ```
 */
export function anchorCatchLaneEnds(params: AnchorCatchLaneEndsParams): Point[] {
    const { edge, layout, nodeOverrides, nodesById } = params;
    const points = edge.points ?? [];
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (points.length < 6 || !source || !target) {
        return points;
    }
    const frame = frameOf({ layout });
    const last = points.length - 1;
    const srcGap = flowOf({ frame, point: points[1] });
    const dstGap = flowOf({ frame, point: points[last - 1] });
    const start = laneAnchor({ frame, gap: srcGap, node: source, nodeOverrides });
    const end = laneAnchor({ frame, gap: dstGap, node: target, nodeOverrides });
    const anchored = [...points];
    anchored[0] = start;
    anchored[1] = toPoint({ cross: crossOf({ frame, point: start }), flow: srcGap, frame });
    anchored[last - 1] = toPoint({ cross: crossOf({ frame, point: end }), flow: dstGap, frame });
    anchored[last] = end;
    return anchored;
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
    /** Lane routes keyed by edge id */
    routes: Map<string, CatchLaneRoute>;
}

/** How far a box is shrunk before testing, so a segment grazing its edge is not a hit. */
const COLLISION_INSET = 0.5;

/**
 * The lane edges with a segment through the inside of any box. Lane routes are
 * axis-aligned, so a segment's bounding box is the segment.
 *
 * @param params.boxes - Centre-based boxes to keep clear, such as open containers
 * @param params.routes - The lane routes to test, keyed by edge id
 * @returns The ids of the edges whose route enters a box; empty when all are clear
 *
 * @example
 * ```typescript
 * findLaneCollisions({ boxes: containers, routes }); // Set {} when clear
 * ```
 */
export function findLaneCollisions(params: FindLaneCollisionsParams): Set<string> {
    const { boxes, routes } = params;
    const colliding = new Set<string>();
    for (const [id, route] of routes) {
        for (let index = 1; index < route.points.length && !colliding.has(id); index += 1) {
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
                    colliding.add(id);
                    break;
                }
            }
        }
    }
    return colliding;
}
