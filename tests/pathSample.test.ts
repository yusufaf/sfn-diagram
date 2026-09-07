import { describe, it, expect } from 'vitest';
import { parsePath, pointAtHalfLength } from '../src/utils/pathSample';

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
