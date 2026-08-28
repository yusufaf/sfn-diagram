import { describe, expect, test } from 'vitest';
import { generateSvg, generateMermaid } from '../../src';
import { parseAsl } from '../../src/AslParser';
import type { AslDefinition, AslState } from '../../src';
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

interface MinTimeMsParams {
    /** The work to time */
    fn: () => void;
    /** How many samples to take */
    runs?: number;
}

/**
 * Best-of-N wall-clock ms across several runs.
 *
 * Parse times here are sub-millisecond, so a single sample is dominated by
 * scheduling noise — especially on shared CI runners. The minimum is the least
 * contaminated estimator: noise only ever adds time on top of the true cost, so
 * the fastest sample sits closest to it. A median let this ratio check flake
 * under load (#50) because a run where more than half the samples were
 * descheduled still passed its outlier through to the middle.
 */
function minTimeMs(params: MinTimeMsParams): number {
    const { fn, runs = 7 } = params;
    let best = Infinity;
    for (let run = 0; run < runs; run++) {
        best = Math.min(best, timeMs(fn));
    }
    return best;
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

        const smallTime = minTimeMs({ fn: () => parseAsl({ definition: small }) }) || 0.01;
        const largeTime = minTimeMs({ fn: () => parseAsl({ definition: large }) });

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

interface StatesAccessCounts {
    /** Times the top-level `States` object's own keys were enumerated */
    ownKeys: number;
    /** Times a property was read off the top-level `States` object */
    get: number;
}

/**
 * Wrap `definition.States` in a Proxy that counts enumeration and property reads,
 * without changing behavior. Used to assert directly that the parser enumerates
 * the top-level state map a bounded number of times, rather than inferring it
 * from a wall-clock ratio.
 */
function countStatesAccess(definition: AslDefinition): {
    counts: StatesAccessCounts;
    instrumented: AslDefinition;
} {
    const counts: StatesAccessCounts = { ownKeys: 0, get: 0 };
    const states = definition.States as Record<string, AslState>;

    const proxy = new Proxy(states, {
        ownKeys(target) {
            counts.ownKeys++;
            return Reflect.ownKeys(target);
        },
        get(target, property, receiver) {
            if (typeof property === 'string') {
                counts.get++;
            }
            return Reflect.get(target, property, receiver);
        },
    });

    return { counts, instrumented: { ...definition, States: proxy } };
}

describe('parser enumeration guard', () => {
    // The ratio check above infers "not quadratic" from timing, which is exactly
    // the measurement that flaked under load in #50. These assert one shape of
    // that property directly and deterministically: how many times the parser
    // touches the top-level `States` object itself, which is invariant to what
    // else the machine is doing. Verified by injecting a per-state re-touch of
    // `States` (an extra `states[name]` read for every other state) — both
    // checks below fail immediately, no timing involved.
    //
    // This is a complement to the ratio check, not a replacement for it: a
    // regression that scans a plain derived array (e.g. `stateNames.includes`
    // instead of a Set, the shape that motivated the comment at AslParser.ts:76)
    // never touches this Proxy, so only the wall-clock ratio catches it.
    test('enumerates the top-level States object a constant number of times', () => {
        const small = buildLinearChain({ length: 1000 });
        const large = buildLinearChain({ length: 8000 });

        const { counts: smallCounts, instrumented: smallInstrumented } =
            countStatesAccess(small);
        const { counts: largeCounts, instrumented: largeInstrumented } =
            countStatesAccess(large);

        parseAsl({ definition: smallInstrumented });
        parseAsl({ definition: largeInstrumented });

        // Object.keys/Object.entries/for-in on the same object each trigger one
        // ownKeys trap regardless of how many entries it has, so a parser that
        // scans States a fixed number of times (not once per state) produces the
        // same count at 1000 and 8000 states.
        expect(largeCounts.ownKeys).toBe(smallCounts.ownKeys);
        expect(smallCounts.ownKeys).toBeGreaterThan(0);
    });

    test('reads from the top-level States object scale linearly, not quadratically', () => {
        const small = buildLinearChain({ length: 1000 });
        const large = buildLinearChain({ length: 8000 }); // 8x the states

        const { counts: smallCounts, instrumented: smallInstrumented } =
            countStatesAccess(small);
        const { counts: largeCounts, instrumented: largeInstrumented } =
            countStatesAccess(large);

        parseAsl({ definition: smallInstrumented });
        parseAsl({ definition: largeInstrumented });

        // Object.entries fires one `get` per key per enumeration, so 8x the
        // states costs ~8x the gets on linear code. A per-state lookup back into
        // `states` (e.g. `states[candidate]` inside a loop over every state)
        // would cost ~64x. 12 sits clear of both.
        expect(largeCounts.get / smallCounts.get).toBeLessThan(12);
    });
});
