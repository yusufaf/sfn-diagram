import { isOpenContainer } from '../graph';
import type { DiagramOptions, LayoutDirection, StateNode } from '../types';
import type { LayoutResult } from './DagreLayout';

/** Corner radius for orthogonal edges, matching the node rect's `rx`. */
export const ORTHOGONAL_CORNER_RADIUS = 5;

/** Coordinates closer than this count as aligned. */
const ALIGNMENT_EPSILON = 1e-6;

interface Point {
    x: number;
    y: number;
}

/** Which axis edges flow along: vertical for TB/BT, horizontal for LR/RL. */
interface Frame {
    vertical: boolean;
}

/** Parameters for {@link flowOf} and {@link crossOf}. */
interface AxisParams {
    frame: Frame;
    point: Point;
}

/** Coordinate along the flow axis. */
function flowOf(params: AxisParams): number {
    return params.frame.vertical ? params.point.y : params.point.x;
}

/** Coordinate across the flow axis. */
function crossOf(params: AxisParams): number {
    return params.frame.vertical ? params.point.x : params.point.y;
}

/** Parameters for {@link toPoint}. */
interface ToPointParams {
    cross: number;
    flow: number;
    frame: Frame;
}

/** Rebuild an x/y point from flow and cross coordinates. */
function toPoint(params: ToPointParams): Point {
    const { cross, flow, frame } = params;
    return frame.vertical ? { x: cross, y: flow } : { x: flow, y: cross };
}

/** Parameters for {@link centreOf}. */
interface CentreOfParams {
    node: StateNode;
}

function centreOf(params: CentreOfParams): Point {
    return { x: params.node.x || 0, y: params.node.y || 0 };
}

/** Parameters for {@link halfExtents}. */
interface HalfExtentsParams {
    frame: Frame;
    node: StateNode;
}

/** Half the node's size along the flow axis and across it. */
function halfExtents(params: HalfExtentsParams): { halfCross: number; halfFlow: number } {
    const { frame, node } = params;
    const halfWidth = (node.width || 0) / 2;
    const halfHeight = (node.height || 0) / 2;
    return frame.vertical
        ? { halfCross: halfWidth, halfFlow: halfHeight }
        : { halfCross: halfHeight, halfFlow: halfWidth };
}

/** Parameters for {@link isAligned}. */
interface IsAlignedParams {
    first: number;
    second: number;
}

function isAligned(params: IsAlignedParams): boolean {
    return Math.abs(params.first - params.second) < ALIGNMENT_EPSILON;
}

/** Parameters for {@link clamp}. */
interface ClampParams {
    limit: number;
    value: number;
}

/** Clamp `value` to the range `-limit..limit`. */
function clamp(params: ClampParams): number {
    return Math.max(-params.limit, Math.min(params.limit, params.value));
}

/** Parameters for {@link simplifyPolyline}. */
interface SimplifyPolylineParams {
    points: Point[];
}

/** Drops repeated points and the middle of any three points on one horizontal or vertical line. */
function simplifyPolyline(params: SimplifyPolylineParams): Point[] {
    const stack: Point[] = [];
    for (const point of params.points) {
        const last = stack[stack.length - 1];
        if (last && isAligned({ first: last.x, second: point.x }) && isAligned({ first: last.y, second: point.y })) {
            continue;
        }
        stack.push(point);
        while (stack.length >= 3) {
            const [first, middle, end] = stack.slice(-3);
            const sameColumn =
                isAligned({ first: first.x, second: middle.x }) && isAligned({ first: middle.x, second: end.x });
            const sameRow =
                isAligned({ first: first.y, second: middle.y }) && isAligned({ first: middle.y, second: end.y });
            if (!sameColumn && !sameRow) break;
            stack.splice(stack.length - 2, 1);
        }
    }
    return stack;
}

/** Parameters for {@link anchorOnNode}. */
interface AnchorOnNodeParams {
    adjacent: Point;
    frame: Frame;
    node: StateNode;
    nodeOverrides?: DiagramOptions['nodeOverrides'];
}

/**
 * The point on the node's drawn outline where an edge should attach: on the side facing
 * `adjacent`, at the lane `adjacent` is already in (kept inside the middle half of that
 * side so the corner stays clear of the node's own corners).
 */
function anchorOnNode(params: AnchorOnNodeParams): Point {
    const { adjacent, frame, node, nodeOverrides } = params;
    const centre = centreOf({ node });
    const { halfCross, halfFlow } = halfExtents({ frame, node });
    const shape = nodeOverrides?.[node.id]?.shape ?? node.style?.shape ?? 'rect';
    // renderCircle draws a circle of radius width / 2 whatever the height is.
    const circleRadius = (node.width || 0) / 2;

    const sign = flowOf({ frame, point: adjacent }) >= flowOf({ frame, point: centre }) ? 1 : -1;
    const laneLimit = shape === 'circle' ? circleRadius / 2 : halfCross / 2;
    const offset = clamp({
        limit: laneLimit,
        value: crossOf({ frame, point: adjacent }) - crossOf({ frame, point: centre }),
    });

    let reach = halfFlow;
    if (shape === 'diamond') {
        reach = halfCross > 0 ? halfFlow * (1 - Math.abs(offset) / halfCross) : halfFlow;
    } else if (shape === 'circle') {
        reach = Math.sqrt(Math.max(0, circleRadius * circleRadius - offset * offset));
    }

    return toPoint({
        cross: crossOf({ frame, point: centre }) + offset,
        flow: flowOf({ frame, point: centre }) + sign * reach,
        frame,
    });
}

/** Parameters for {@link orthogonalize}. */
interface OrthogonalizeParams {
    frame: Frame;
    points: Point[];
}

/**
 * Turn a polyline into axis-aligned legs. Each diagonal pair gets a jog: on the first
 * pair at the next point's flow position, on the last pair at the previous point's, so
 * the edge leaves and enters along the flow axis; elsewhere at the midpoint.
 */
function orthogonalize(params: OrthogonalizeParams): Point[] {
    const { frame, points } = params;
    const hasInterior = points.length > 2;
    const routed: Point[] = [points[0]];
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const next = points[index];
        const sameFlow = isAligned({
            first: flowOf({ frame, point: previous }),
            second: flowOf({ frame, point: next }),
        });
        const sameCross = isAligned({
            first: crossOf({ frame, point: previous }),
            second: crossOf({ frame, point: next }),
        });
        if (!sameFlow && !sameCross) {
            let jogFlow = (flowOf({ frame, point: previous }) + flowOf({ frame, point: next })) / 2;
            if (hasInterior && index === 1) {
                jogFlow = flowOf({ frame, point: next });
            } else if (hasInterior && index === points.length - 1) {
                jogFlow = flowOf({ frame, point: previous });
            }
            routed.push(
                toPoint({ cross: crossOf({ frame, point: previous }), flow: jogFlow, frame }),
                toPoint({ cross: crossOf({ frame, point: next }), flow: jogFlow, frame }),
            );
        }
        routed.push(next);
    }
    return routed;
}

/** Parameters for {@link routeAwayFromContainer}. */
interface RouteAwayFromContainerParams {
    exitDirection: 1 | -1;
    frame: Frame;
    source: StateNode;
    target: StateNode;
}

/**
 * Route for an edge out of an open container to a node that lies behind the container's
 * entry side (a Distributed Map's ResultWriter): leave from the container side facing the
 * target, run across, then along the flow axis into the target's near side. The layout's
 * own 2-point edge would run up the container's centre column, over its inner flow.
 *
 * @returns The route, or `undefined` when the edge isn't of that kind.
 */
function routeAwayFromContainer(params: RouteAwayFromContainerParams): Point[] | undefined {
    const { exitDirection, frame, source, target } = params;
    if (!isOpenContainer(source) || source.children?.includes(target.id)) return undefined;

    const sourceCentre = centreOf({ node: source });
    const targetCentre = centreOf({ node: target });
    const sourceHalf = halfExtents({ frame, node: source });
    const targetHalf = halfExtents({ frame, node: target });
    const entryFlow = flowOf({ frame, point: sourceCentre }) - exitDirection * sourceHalf.halfFlow;
    // Compare centres, not the edge's points: containers can overlap by a few pixels,
    // which makes ordinary container-to-container edges point backwards.
    if ((flowOf({ frame, point: targetCentre }) - entryFlow) * exitDirection >= 0) return undefined;

    const side = crossOf({ frame, point: targetCentre }) >= crossOf({ frame, point: sourceCentre }) ? 1 : -1;
    const start = toPoint({
        cross: crossOf({ frame, point: sourceCentre }) + side * sourceHalf.halfCross,
        flow: flowOf({ frame, point: sourceCentre }),
        frame,
    });
    const end = toPoint({
        cross: crossOf({ frame, point: targetCentre }),
        flow: flowOf({ frame, point: targetCentre }) + exitDirection * targetHalf.halfFlow,
        frame,
    });
    const corner = toPoint({
        cross: crossOf({ frame, point: end }),
        flow: flowOf({ frame, point: start }),
        frame,
    });
    return simplifyPolyline({ points: [start, corner, end] });
}

/** Parameters for {@link routeOrthogonalEdges}. */
export interface RouteOrthogonalEdgesParams {
    /** Edges as the layout produced them; never mutated, since they may come from a cached layout. */
    edges: LayoutResult['edges'];
    /** Layout direction the edges were laid out in. */
    layout: LayoutDirection;
    /** Per-node style overrides, which can change a node's drawn shape. */
    nodeOverrides?: DiagramOptions['nodeOverrides'];
    /** Positioned nodes the edges connect. */
    nodes: StateNode[];
}

/**
 * Re-route laid-out edges as axis-aligned paths for `edgeStyle: 'orthogonal'`.
 *
 * Edges dagre routed (three or more points) attach to the node side facing the flow, at
 * their own lane, and leave and enter along the flow axis. Edges out of an open container
 * keep the layout's endpoints, except the one to a node behind the container (see
 * {@link routeAwayFromContainer}). Self-loops are returned unchanged.
 *
 * @param params - The edges, layout direction, nodes and node style overrides.
 * @returns A new edges array; edges that are not re-routed are the same objects.
 * @example
 * const routed = routeOrthogonalEdges({ edges: layout.edges, layout: 'TB', nodes: layout.nodes });
 */
export function routeOrthogonalEdges(params: RouteOrthogonalEdgesParams): LayoutResult['edges'] {
    const { edges, layout, nodeOverrides, nodes } = params;
    const frame: Frame = { vertical: layout === 'TB' || layout === 'BT' };
    const exitDirection = layout === 'TB' || layout === 'LR' ? 1 : -1;
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    return edges.map((edge) => {
        const points = edge.points;
        if (edge.from === edge.to || !points || points.length < 2) return edge;
        if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return edge;

        const source = nodesById.get(edge.from);
        const target = nodesById.get(edge.to);
        if (points.length === 2 && source && target) {
            const away = routeAwayFromContainer({ exitDirection, frame, source, target });
            if (away) return { ...edge, points: away };
        }

        const anchored = [...points];
        if (points.length >= 3) {
            if (source && !isOpenContainer(source)) {
                anchored[0] = anchorOnNode({ adjacent: points[1], frame, node: source, nodeOverrides });
            }
            if (target && !isOpenContainer(target)) {
                anchored[anchored.length - 1] = anchorOnNode({
                    adjacent: points[points.length - 2],
                    frame,
                    node: target,
                    nodeOverrides,
                });
            }
        }
        return { ...edge, points: simplifyPolyline({ points: orthogonalize({ frame, points: anchored }) }) };
    });
}

/** Parameters for {@link buildRoundedOrthogonalPath}. */
export interface BuildRoundedOrthogonalPathParams {
    /** Axis-aligned polyline vertices. */
    points: Point[];
    /** Corner radius; shrunk at a corner to half of the shorter leg. */
    radius: number;
}

/** Format like d3-shape: three decimals at most, no trailing zeros. */
function formatNumber(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function formatPoint(point: Point): string {
    return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

/**
 * SVG path through an axis-aligned polyline with rounded corners, as M/L/C commands so
 * `pathSample` can still find the arc-length midpoint for the edge label.
 *
 * @param params - The polyline vertices and the corner radius.
 * @returns The path `d`, or `null` when there are fewer than two points.
 * @example
 * buildRoundedOrthogonalPath({ points: [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }], radius: 5 });
 * // 'M0,0L0,45C0,50,0,50,5,50L100,50'
 */
export function buildRoundedOrthogonalPath(params: BuildRoundedOrthogonalPathParams): string | null {
    const { points, radius } = params;
    if (points.length < 2) return null;

    let path = `M${formatPoint(points[0])}`;
    for (let index = 1; index < points.length - 1; index += 1) {
        const previous = points[index - 1];
        const corner = points[index];
        const next = points[index + 1];
        const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
        const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
        const cut = Math.min(radius, incoming / 2, outgoing / 2);
        const before = {
            x: corner.x - (cut * (corner.x - previous.x)) / incoming,
            y: corner.y - (cut * (corner.y - previous.y)) / incoming,
        };
        const after = {
            x: corner.x + (cut * (next.x - corner.x)) / outgoing,
            y: corner.y + (cut * (next.y - corner.y)) / outgoing,
        };
        path += `L${formatPoint(before)}C${formatPoint(corner)},${formatPoint(corner)},${formatPoint(after)}`;
    }
    return `${path}L${formatPoint(points[points.length - 1])}`;
}
