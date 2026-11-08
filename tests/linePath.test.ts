import { curveBasis, curveLinear, line } from 'd3-shape';
import { describe, expect, it } from 'vitest';
import { buildLinePath } from '../src/utils/linePath';
import type { LineCurve, LinePoint } from '../src/utils/linePath';

// d3-shape stays a devDependency only for this file: the in-house path builder has to
// keep producing exactly what d3 did, or every rendered SVG (and its snapshot) shifts.
const D3_CURVES = { basis: curveBasis, linear: curveLinear } as const;

function d3Path(curve: LineCurve, points: LinePoint[]): string | null {
    return line<LinePoint>()
        .x((point) => point.x)
        .y((point) => point.y)
        .curve(D3_CURVES[curve])(points);
}

/** mulberry32: a tiny seeded PRNG, so a failure always reproduces. */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = state;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

const CURVES: LineCurve[] = ['basis', 'linear'];

describe('buildLinePath', () => {
    describe.each(CURVES)('%s', (curve) => {
        it('returns null for no points, as d3 does', () => {
            expect(buildLinePath({ curve, points: [] })).toBeNull();
            expect(d3Path(curve, [])).toBeNull();
        });

        it.each([1, 2, 3, 4, 5])('matches d3 for %i integer points', (count) => {
            const points = Array.from({ length: count }, (_, index) => ({
                x: index * 40,
                y: (index % 2) * 25,
            }));
            expect(buildLinePath({ curve, points })).toBe(d3Path(curve, points));
        });

        it('matches d3 for repeated, negative and very large or small coordinates', () => {
            const points = [
                { x: -0, y: 0 },
                { x: 0, y: 0 },
                { x: -12.5, y: 1e21 },
                { x: 1e-7, y: -3.3333333333333335 },
                { x: 1e-7, y: -3.3333333333333335 },
            ];
            expect(buildLinePath({ curve, points })).toBe(d3Path(curve, points));
        });

        it('matches d3 where a reordered sum would round the other way', () => {
            // (2 * 133.2836 - 209.2837) / 3 sits exactly on a three-decimal rounding
            // boundary; 133.2836 + (-209.2837 - 133.2836) / 3 lands just past it.
            const points = [
                { x: 133.2836, y: 0 },
                { x: -209.2837, y: 0 },
                { x: 40, y: 10 },
            ];
            expect(buildLinePath({ curve, points })).toBe(d3Path(curve, points));
        });

        // Coordinates with four decimals, like the half and quarter pixels dagre produces,
        // land the curve math on rounding boundaries far more often than arbitrary
        // floats. That is where an operation order different from d3's shows up.
        it('matches d3 character for character over 2,000 random routes', () => {
            const random = seededRandom(615);
            const coordinate = (): number => Math.round((random() - 0.5) * 20_000_000) / 10_000;
            for (let route = 0; route < 2000; route++) {
                const points = Array.from({ length: 1 + Math.floor(random() * 12) }, () => ({
                    x: coordinate(),
                    y: coordinate(),
                }));
                const expected = d3Path(curve, points);
                const actual = buildLinePath({ curve, points });
                if (actual !== expected) {
                    expect({ actual, points }).toEqual({ actual: expected, points });
                }
            }
        });
    });
});
