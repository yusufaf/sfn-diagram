import { describe, expect, test } from 'vitest';
import { generateSvg, generateMermaid } from '../../src';
import { parseAsl } from '../../src/AslParser';
import { buildLinearChain, buildParallel, buildWideChoice } from './fixtures';

/**
 * Performance guard tests.
 *
 * These assert that large inputs complete within a generous time budget and,
 * more importantly, that runtime scales roughly linearly with input size. The
 * ratio checks are the real defense against accidentally reintroducing an
 * O(n^2) hot path (e.g. an `Array.find` inside a per-edge loop); the absolute
 * budgets are loose so the suite stays stable across CI hardware.
 */

function timeMs(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
}

interface MedianTimeMsParams {
    /** The work to time */
    fn: () => void;
    /** How many samples to take */
    runs?: number;
}

/**
 * Median wall-clock ms across several runs.
 *
 * Parse times here are sub-millisecond, so a single sample is dominated by
 * scheduling noise — especially on shared CI runners, where an unlucky
 * denominator used to make the ratio check below fail spuriously.
 */
function medianTimeMs(params: MedianTimeMsParams): number {
    const { fn, runs = 7 } = params;
    const samples: number[] = [];
    for (let run = 0; run < runs; run++) {
        samples.push(timeMs(fn));
    }
    samples.sort((first, second) => first - second);
    return samples[Math.floor(samples.length / 2)];
}

describe('parser scaling', () => {
    test('parses a 2000-state linear chain quickly', () => {
        const asl = buildLinearChain({ length: 2000 });
        const elapsed = timeMs(() => parseAsl({ definition: asl }));
        expect(elapsed).toBeLessThan(500);
    });

    test('parse time scales roughly linearly with state count', () => {
        const small = buildLinearChain({ length: 1000 });
        const large = buildLinearChain({ length: 8000 }); // 8x the states

        // Warm up to avoid first-run JIT skew dominating the measurement.
        parseAsl({ definition: small });
        parseAsl({ definition: large });

        const smallTime = medianTimeMs({ fn: () => parseAsl({ definition: small }) }) || 0.01;
        const largeTime = medianTimeMs({ fn: () => parseAsl({ definition: large }) });

        // 8x input costs ~12x on linear code (GC and cache effects add a little
        // over the ideal 8x) versus ~64x if quadratic. 24x sits well clear of
        // both. The span has to be this wide to separate the two curves: across
        // a 4x span the quadratic term is still too small to stand out from
        // noise, which is how an O(n^2) validator once passed this check.
        expect(largeTime / smallTime).toBeLessThan(24);
    });

    test('parses a wide Parallel without quadratic blowup', () => {
        const asl = buildParallel({ branches: 40, statesPerBranch: 25 }); // ~1000 nested states
        const elapsed = timeMs(() => parseAsl({ definition: asl }));
        expect(elapsed).toBeLessThan(750);
    });
});

describe('end-to-end scaling', () => {
    test('renders SVG for a 1000-state chain within budget', () => {
        const asl = buildLinearChain({ length: 1000 });
        let output = '';
        const elapsed = timeMs(() => {
            output = generateSvg({ aslDefinition: asl }).svg;
        });
        expect(output).toContain('<svg');
        expect(elapsed).toBeLessThan(5000);
    });

    test('renders Mermaid for a wide Choice within budget', () => {
        const asl = buildWideChoice({ width: 500 });
        let code = '';
        const elapsed = timeMs(() => {
            code = generateMermaid({ aslDefinition: asl }).code;
        });
        expect(code).toContain('stateDiagram');
        expect(elapsed).toBeLessThan(2000);
    });
});
