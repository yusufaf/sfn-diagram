import { describe, it, expect } from 'vitest';
import { nearestPointOnPath, parsePath, pointAtHalfLength } from '../src/utils/pathSample';

describe('parsePath / pointAtHalfLength', () => {
    it('returns the exact geometric middle of a straight two-point path', () => {
        const midpoint = pointAtHalfLength(parsePath('M0,0L100,0'));
        expect(midpoint).toEqual({ x: 50, y: 0 });
    });

    it('lands in the longer leg of an unequal-length polyline, not at the vertex', () => {
        // Legs of length 10 and 100 (total 110); the arc-length midpoint at 55 falls
        // 45 units into the second leg, well past the vertex at (10, 0).
        const midpoint = pointAtHalfLength(parsePath('M0,0L10,0L110,0'));
        expect(midpoint.x).toBeCloseTo(55);
        expect(midpoint.y).toBeCloseTo(0);
        expect(midpoint).not.toEqual({ x: 10, y: 0 });
    });

    it('matches the analytic B(0.5) point for a symmetric self-loop-style cubic', () => {
        // Mirrors buildSelfLoopPath: both control points are the same apex. For an
        // entry/exit pair symmetric about the apex, B(0.5) = 0.125*entry + 0.75*apex
        // + 0.125*exit (see SvgRenderer's selfLoopLabelCenter), and by that same
        // symmetry the arc-length midpoint coincides with the t=0.5 point.
        const midpoint = pointAtHalfLength(parsePath('M0,0 C50,-30 50,-30 100,0'));
        expect(midpoint.x).toBeCloseTo(50, 1);
        expect(midpoint.y).toBeCloseTo(-22.5, 1);
    });

    it('returns the origin for an empty path', () => {
        expect(pointAtHalfLength(parsePath(''))).toEqual({ x: 0, y: 0 });
    });

    it('returns the sole point for a single-point path (M x,y Z)', () => {
        expect(pointAtHalfLength(parsePath('M5,5Z'))).toEqual({ x: 5, y: 5 });
    });
});

describe('nearestPointOnPath', () => {
    it('projects a target above a straight path onto its middle', () => {
        const nearest = nearestPointOnPath({ path: parsePath('M0,0L100,0'), target: { x: 50, y: 30 } });
        expect(nearest).toEqual({ x: 50, y: 0 });
    });

    it('clamps a target past the end to the end point', () => {
        const nearest = nearestPointOnPath({ path: parsePath('M0,0L100,0'), target: { x: 150, y: 20 } });
        expect(nearest).toEqual({ x: 100, y: 0 });
    });

    it('survives a zero-length chord instead of returning NaN', () => {
        const nearest = nearestPointOnPath({
            path: parsePath('M0,0L0,0L10,0'),
            target: { x: 5, y: 3 },
        });
        expect(nearest).toEqual({ x: 5, y: 0 });
    });

    it('returns the start of a path with no segments', () => {
        const nearest = nearestPointOnPath({ path: parsePath('M7,9'), target: { x: 1, y: 1 } });
        expect(nearest).toEqual({ x: 7, y: 9 });
    });

    it('lands on the drawn curve, not on a control point, for a cubic', () => {
        const target = { x: 50, y: 200 };
        const nearest = nearestPointOnPath({ path: parsePath('M0,0C0,100,100,100,100,0'), target });

        const samples = Array.from({ length: 1001 }, (_, index) => {
            const t = index / 1000;
            const mt = 1 - t;
            return {
                x: 3 * mt * t * t * 100 + t * t * t * 100,
                y: 3 * mt * mt * t * 100 + 3 * mt * t * t * 100,
            };
        });
        const gap = (point: { x: number; y: number }, other: { x: number; y: number }): number =>
            Math.hypot(point.x - other.x, point.y - other.y);
        const closestToTarget = Math.min(...samples.map((sample) => gap(sample, target)));
        const distanceToCurve = Math.min(...samples.map((sample) => gap(sample, nearest)));

        expect(gap(nearest, target)).toBeLessThanOrEqual(closestToTarget + 0.5);
        expect(distanceToCurve).toBeLessThan(0.5);
    });
});
