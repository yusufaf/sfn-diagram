/**
 * Pure-math sampling of an SVG path `d` string produced by d3-shape's `line()`
 * generator - no DOM. Core has to stay DOM-free (Node, browser, and edge runtimes;
 * see tests/edge-runtime.test.ts), which rules out `SVGPathElement.getPointAtLength`.
 *
 * Only `M`, `L` and `C` commands are handled: that is the complete command set
 * `line()` emits with `curveLinear` (the default) and `curveBasis` (used for
 * `edgeStyle: 'curved'`), and it also covers the hand-built self-loop path in
 * SvgRenderer's `buildSelfLoopPath`.
 */

export interface PathPoint {
    x: number;
    y: number;
}

interface PathSegment {
    control1?: PathPoint;
    control2?: PathPoint;
    from: PathPoint;
    to: PathPoint;
    type: 'C' | 'L';
}

export interface ParsedPath {
    segments: PathSegment[];
    start: PathPoint;
}

const COMMAND_RE = /([CLM])([^CLM]*)/g;
const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

function parseNumbers(text: string): number[] {
    return (text.match(NUMBER_RE) ?? []).map(Number);
}

/** Parse an SVG path `d` string into a starting point plus a flat list of segments. */
export function parsePath(d: string): ParsedPath {
    let start: PathPoint = { x: 0, y: 0 };
    let current: PathPoint = start;
    const segments: PathSegment[] = [];
    let hasStart = false;

    COMMAND_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COMMAND_RE.exec(d)) !== null) {
        const [, command, argsText] = match;
        const numbers = parseNumbers(argsText);

        if (command === 'M') {
            current = { x: numbers[0], y: numbers[1] };
            if (!hasStart) {
                start = current;
                hasStart = true;
            }
        } else if (command === 'L') {
            for (let i = 0; i + 1 < numbers.length; i += 2) {
                const to = { x: numbers[i], y: numbers[i + 1] };
                segments.push({ from: current, to, type: 'L' });
                current = to;
            }
        } else if (command === 'C') {
            for (let i = 0; i + 5 < numbers.length; i += 6) {
                const control1 = { x: numbers[i], y: numbers[i + 1] };
                const control2 = { x: numbers[i + 2], y: numbers[i + 3] };
                const to = { x: numbers[i + 4], y: numbers[i + 5] };
                segments.push({ control1, control2, from: current, to, type: 'C' });
                current = to;
            }
        }
    }

    return { segments, start };
}

/** Number of chords a cubic segment is flattened into when walking arc length. */
const CUBIC_SAMPLES = 16;

interface CubicPointAtParams {
    control1: PathPoint;
    control2: PathPoint;
    from: PathPoint;
    t: number;
    to: PathPoint;
}

function cubicPointAt(params: CubicPointAtParams): PathPoint {
    const { control1, control2, from, t, to } = params;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const e = t * t * t;
    return {
        x: a * from.x + b * control1.x + c * control2.x + e * to.x,
        y: a * from.y + b * control1.y + c * control2.y + e * to.y,
    };
}

/** Flatten every segment into a polyline dense enough to walk arc length along. */
function flattenToPolyline(path: ParsedPath): PathPoint[] {
    const { start, segments } = path;
    const points: PathPoint[] = [start];
    for (const segment of segments) {
        if (segment.type === 'L') {
            points.push(segment.to);
            continue;
        }
        // segment.control1/control2 are always set for a 'C' segment - see parsePath.
        const control1 = segment.control1 as PathPoint;
        const control2 = segment.control2 as PathPoint;
        for (let i = 1; i <= CUBIC_SAMPLES; i += 1) {
            points.push(
                cubicPointAt({ control1, control2, from: segment.from, t: i / CUBIC_SAMPLES, to: segment.to })
            );
        }
    }
    return points;
}

interface DistanceParams {
    from: PathPoint;
    to: PathPoint;
}

function distance(params: DistanceParams): number {
    const { from, to } = params;
    return Math.hypot(to.x - from.x, to.y - from.y);
}

interface LerpParams {
    from: PathPoint;
    t: number;
    to: PathPoint;
}

function lerp(params: LerpParams): PathPoint {
    const { from, t, to } = params;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * Find the point at half the drawn path's arc length - i.e. the point actually on
 * the rendered curve, not a control point the curve may never pass through.
 *
 * Flattens every segment into a dense polyline and walks it by cumulative chord
 * length, which is only an approximation of true arc length for a cubic segment,
 * but at diagram scale (CUBIC_SAMPLES = 16 chords per curve) it is visually exact.
 */
export function pointAtHalfLength(path: ParsedPath): PathPoint {
    if (path.segments.length === 0) {
        return path.start;
    }

    const points = flattenToPolyline(path);
    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += distance({ from: points[i - 1], to: points[i] });
        cumulative.push(total);
    }

    if (total === 0) {
        return points[0];
    }

    const target = total / 2;
    for (let i = 1; i < points.length; i += 1) {
        if (cumulative[i] >= target) {
            const segmentLength = cumulative[i] - cumulative[i - 1];
            const t = segmentLength === 0 ? 0 : (target - cumulative[i - 1]) / segmentLength;
            return lerp({ from: points[i - 1], t, to: points[i] });
        }
    }
    return points[points.length - 1];
}
