/**
 * The SVG path `d` strings for edges, matching d3-shape's `line()` with `curveLinear`
 * or `curveBasis` character for character, so dropping d3-shape left every rendered
 * SVG unchanged. Ported from d3-shape 3.2 (`src/line.js`, `src/curve/linear.js`,
 * `src/curve/basis.js`) and d3-path 3.1, ISC licence, Copyright 2010-2022 Mike Bostock.
 *
 * Each number is rounded to at most three decimals when it is written, as d3-shape's
 * default `digits(3)` does (`Math.round(value * 1000) / 1000`). The curve math runs on
 * the unrounded values.
 */

/** A point the path passes through (linear) or is pulled towards (basis). */
export interface LinePoint {
    x: number;
    y: number;
}

/**
 * How the path joins its points: `'linear'` with straight segments (d3's
 * `curveLinear`), `'basis'` with a cubic B-spline that starts and ends on the end
 * points (d3's `curveBasis`).
 */
export type LineCurve = 'basis' | 'linear';

/** Parameters for {@link buildLinePath}. */
export interface BuildLinePathParams {
    /** How the path joins its points. */
    curve: LineCurve;
    /** The points, in drawing order. */
    points: ReadonlyArray<LinePoint>;
}

/** Parameters for {@link basisSegment}. */
interface BasisSegmentParams {
    /** The point the segment ends near. */
    current: LinePoint;
    /** The point after `current`; the last point repeats itself to close the curve. */
    next: LinePoint;
    /** The point before `current`. */
    previous: LinePoint;
}

/**
 * Build an SVG path `d` string through the given points.
 *
 * @param params - The curve and the points
 * @returns The path, or `null` for no points, as d3's `line()` returns
 *
 * @example
 * ```typescript
 * buildLinePath({ curve: 'linear', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] });
 * // 'M0,0L10,5'
 * ```
 */
export function buildLinePath(params: BuildLinePathParams): string | null {
    const { curve, points } = params;
    if (points.length === 0) return null;
    return curve === 'basis' ? buildBasisPath(points) : buildLinearPath(points);
}

/** Format one coordinate as d3-path does with `digits(3)`. */
function format(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function buildLinearPath(points: ReadonlyArray<LinePoint>): string {
    let path = `M${format(points[0].x)},${format(points[0].y)}`;
    for (let index = 1; index < points.length; index++) {
        path += `L${format(points[index].x)},${format(points[index].y)}`;
    }
    // d3 closes a one-point line, so it still draws as a dot with round caps.
    return points.length === 1 ? `${path}Z` : path;
}

function buildBasisPath(points: ReadonlyArray<LinePoint>): string {
    const first = points[0];
    let path = `M${format(first.x)},${format(first.y)}`;
    if (points.length === 1) return `${path}Z`;

    const second = points[1];
    if (points.length === 2) return `${path}L${format(second.x)},${format(second.y)}`;

    // A straight lead-in to where the spline starts, a sixth of the way along the
    // first segment, then one cubic per interior point.
    path += `L${format((5 * first.x + second.x) / 6)},${format((5 * first.y + second.y) / 6)}`;
    for (let index = 2; index < points.length; index++) {
        path += basisSegment({
            current: points[index - 1],
            next: points[index],
            previous: points[index - 2],
        });
    }

    // The last point repeats itself, pulling the spline onto it, then a straight
    // tail lands exactly on it.
    const last = points[points.length - 1];
    path += basisSegment({ current: last, next: last, previous: points[points.length - 2] });
    return `${path}L${format(last.x)},${format(last.y)}`;
}

/**
 * One cubic Bézier command (`C`) of a uniform cubic B-spline, from the B-spline's
 * control points `previous`, `current` and `next`.
 *
 * The control points sit a third and two thirds of the way from `previous` to
 * `current`, and the segment ends at the weighted average
 * `(previous + 4 * current + next) / 6`.
 *
 * The expressions are d3's own, operation order included. Floating-point arithmetic is
 * not associative: `previous + (current - previous) / 3` is the same point on paper as
 * `(2 * previous + current) / 3`, but it can land on the other side of a rounding
 * boundary and print a different third decimal.
 */
function basisSegment(params: BasisSegmentParams): string {
    const { current, next, previous } = params;
    const control1X = format((2 * previous.x + current.x) / 3);
    const control1Y = format((2 * previous.y + current.y) / 3);
    const control2X = format((previous.x + 2 * current.x) / 3);
    const control2Y = format((previous.y + 2 * current.y) / 3);
    const endX = format((previous.x + 4 * current.x + next.x) / 6);
    const endY = format((previous.y + 4 * current.y + next.y) / 6);
    return `C${control1X},${control1Y},${control2X},${control2Y},${endX},${endY}`;
}
