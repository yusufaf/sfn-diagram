import { describe, expect, test } from 'vitest';
import { generateSvg, generateMermaid } from '../../src';
import { parseAsl } from '../../src/AslParser';
import { computeCollapsePlan } from '../../src/graph';
import { applySubstitutions, resolveIntrinsics } from '../../src/cfn/intrinsics';
import { evaluateHclLiteral } from '../../src/terraform/hclExpression';
import { tokenizeHcl } from '../../src/terraform/hclLexer';
import type { AslDefinition, AslState } from '../../src';
import {
    buildChoiceFanInChain,
    buildLinearChain,
    buildNestedContainerChain,
    buildParallel,
    buildSharedCatchChain,
    buildWideChoice,
} from './fixtures';

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

interface MeasureLayoutRatioParams {
    /** Builds the machine for a given size */
    build: (size: number) => AslDefinition;
    /** The larger size */
    large: number;
    /** The smaller size */
    small: number;
}

interface LayoutRatio {
    /** SVG height at the larger size */
    largeHeight: number;
    /** Best large-size time over best small-size time */
    ratio: number;
    /** SVG height at the smaller size */
    smallHeight: number;
}

/**
 * How much longer `generateSvg` takes at the larger size than at the smaller one.
 *
 * It times `generateSvg`, not `DagreLayout`, so the same check holds for any layout
 * engine (#545, #547); parsing and rendering are a small, linear share of the time.
 * No `cache` is passed, so every call lays out again (`pipeline.ts` only caches when
 * given one). A ratio rather than a time budget keeps the check independent of how
 * fast the runner is. The heights let a caller check the shape it timed.
 */
function measureLayoutRatio(params: MeasureLayoutRatioParams): LayoutRatio {
    const { build, large, small } = params;
    const smallDefinition = build(small);
    const largeDefinition = build(large);
    const renderSmall = () => generateSvg({ aslDefinition: smallDefinition });
    const renderLarge = () => generateSvg({ aslDefinition: largeDefinition });

    // Warm up both sizes, as the other ratio checks do, so JIT doesn't skew the first sample.
    const smallHeight = renderSmall().height;
    const largeHeight = renderLarge().height;

    const smallTime = minTimeMs({ fn: renderSmall, runs: 5 });
    const largeTime = minTimeMs({ fn: renderLarge, runs: 5 });
    return { largeHeight, ratio: largeTime / smallTime, smallHeight };
}

/**
 * Limit for the chain, shared Catch and Choice fan-in layout ratios. Every case spans
 * 8x: linear-shaped layouts measured 7-14x here, quadratic is about 64x, and the Choice
 * fan-in (#434) measures about 70x today. It catches engine-level blowups such as a
 * dummy node per rank for long edges, not a cheap `O(n)` scan per edge, which dagre's
 * own cost hides at these sizes (#704).
 */
const LAYOUT_RATIO_LIMIT = 24;

/**
 * Limit for the nested container ratio. dagre lays out chains of Parallel states
 * superlinearly, nested or not (about n^1.3-1.45, and each Parallel widens about 20 px
 * per Parallel that follows it). 5 -> 40 measured 10-16x on a quiet machine and up to
 * 24x under heavy load, and the ratio grows with size (26-38x at 20 -> 160), so the
 * shared limit would flake. 40 stays below quadratic (64x) and far below a long-edge
 * blowup (about 100x).
 */
const CONTAINER_LAYOUT_RATIO_LIMIT = 40;

/**
 * At 8x the Parallels, the stacked layout is about 7.7x as tall today. Side by side
 * (container ranking broken) it is 1.0x and times a much cheaper, mostly disconnected
 * graph, which would pass the ratio check.
 */
const CONTAINER_MIN_HEIGHT_GROWTH = 4;

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

describe('collapse closure scaling', () => {
    test('collapse closure time scales roughly linearly with descendant count', () => {
        // Same 8x span as the parser ratio check, for the same reason: it takes
        // that much separation for a quadratic queue (`shift()` per visit) to
        // stand out from timing noise.
        const small = parseAsl({ definition: buildParallel({ branches: 80, statesPerBranch: 25 }) });
        const large = parseAsl({ definition: buildParallel({ branches: 640, statesPerBranch: 25 }) });

        const collapseSmall = (): void => {
            computeCollapsePlan({ collapse: true, edges: small.edges, nodes: small.nodes });
        };
        const collapseLarge = (): void => {
            computeCollapsePlan({ collapse: true, edges: large.edges, nodes: large.nodes });
        };

        collapseSmall();
        collapseLarge();

        const largePlan = computeCollapsePlan({ collapse: true, edges: large.edges, nodes: large.nodes });
        expect(largePlan.hiddenIdsByTarget.get('Fork')?.size).toBeGreaterThan(16000);

        const smallTime = minTimeMs({ fn: collapseSmall }) || 0.01;
        const largeTime = minTimeMs({ fn: collapseLarge });

        expect(largeTime / smallTime).toBeLessThan(24);
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

    test('renders SVG for a 200-state chain sharing one Catch handler within budget', () => {
        const asl = buildSharedCatchChain({ length: 200 });
        let output = '';
        const elapsed = timeMs(() => {
            output = generateSvg({ aslDefinition: asl }).svg;
        });
        expect(output).toContain('<svg');
        expect(elapsed).toBeLessThan(1500);
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

describe('layout scaling', () => {
    test('chain layout scales roughly linearly with state count', { timeout: 60_000 }, () => {
        const { ratio } = measureLayoutRatio({
            build: (size) => buildLinearChain({ length: size }),
            large: 1000,
            small: 125,
        });
        expect(ratio).toBeLessThan(LAYOUT_RATIO_LIMIT);
    });

    test('shared Catch layout scales roughly linearly with state count', { timeout: 60_000 }, () => {
        // Guards the catch lanes (#364, #419): without them every Catch edge spans the
        // ranks down to the shared handler and dagre adds a dummy node per rank.
        const { ratio } = measureLayoutRatio({
            build: (size) => buildSharedCatchChain({ length: size }),
            large: 800,
            small: 100,
        });
        expect(ratio).toBeLessThan(LAYOUT_RATIO_LIMIT);
    });

    test('nested container layout stays well below quadratic in container count', { timeout: 60_000 }, () => {
        // 76 -> 601 parsed nodes (61 -> 481 laid out by dagre). The sizes stay small
        // because dagre's own exponent on this shape grows with the graph.
        const { largeHeight, ratio, smallHeight } = measureLayoutRatio({
            build: (size) => buildNestedContainerChain({ length: size }),
            large: 40,
            small: 5,
        });
        // The Parallels stack, so this times a chain of containers, not a wide row.
        expect(largeHeight).toBeGreaterThan(smallHeight * CONTAINER_MIN_HEIGHT_GROWTH);
        expect(ratio).toBeLessThan(CONTAINER_LAYOUT_RATIO_LIMIT);
    });

    test(
        'the Choice fan-in fixture renders at both sizes, with every Default edge into Cleanup',
        { timeout: 60_000 },
        () => {
            // The test.fails below passes on any thrown error, so this proves the fixture
            // parses and renders at the exact sizes it times (about 1 s for 128).
            const { edges } = parseAsl({ definition: buildChoiceFanInChain({ length: 16 }) });
            const intoCleanup = edges.filter((edge) => edge.to === 'Cleanup');
            expect(intoCleanup).toHaveLength(16);
            expect(intoCleanup.every((edge) => edge.type === 'default')).toBe(true);
            for (const length of [16, 128]) {
                const { svg } = generateSvg({ aslDefinition: buildChoiceFanInChain({ length }) });
                expect(svg).toContain('<svg');
                expect(svg).not.toContain('NaN');
            }
        },
    );

    // Quadratic today (#434): each Default edge spans many ranks and dagre inserts a
    // dummy node per rank, about 70x here. Once that is fixed this starts passing,
    // vitest reports the test.fails as failed, and the fix turns it into a plain test.
    test.fails('Choice fan-in layout scales roughly linearly with state count (#434)', { timeout: 60_000 }, () => {
        const { ratio } = measureLayoutRatio({
            build: (size) => buildChoiceFanInChain({ length: size }),
            large: 128,
            small: 16,
        });
        expect(ratio).toBeLessThan(LAYOUT_RATIO_LIMIT);
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

describe('Fn::Sub substitution scaling', () => {
    // The timing half of the js/polynomial-redos fix in src/cfn/intrinsics.ts. The
    // substitution pattern was `[^}]+`, unanchored on the right, so a template of
    // repeated `${` with no closing brace cost one end-of-string rescan per occurrence.
    // CloudFormation templates are untrusted input to the CLI, the library and the
    // Action alike, so that is a denial-of-service vector rather than a slow path.
    //
    // Asserted as a ratio rather than a wall-clock budget, like the checks above.
    function timeResolve(repeats: number): number {
        const value = { 'Fn::Sub': '${'.repeat(repeats) };
        const start = performance.now();
        resolveIntrinsics({ value });
        return performance.now() - start;
    }

    test('a template of repeated "${" does not degrade quadratically', () => {
        timeResolve(8000); // warm up, so JIT cost does not land on the first measurement

        const small = Math.max(timeResolve(8000), 0.5);
        const large = timeResolve(32000); // 4x the input

        // Linear is ~4x and quadratic ~16x. 8 sits clear of both.
        expect(large / small).toBeLessThan(8);
    });

    // The same pattern now also scans the whole DefinitionString once, outside Fn::Sub.
    function timeApply(repeats: number): number {
        const value = '${'.repeat(repeats);
        const start = performance.now();
        applySubstitutions({ substitutions: { X: 'y' }, value });
        return performance.now() - start;
    }

    test('substituting a definition of repeated "${" does not degrade quadratically', () => {
        timeApply(8000);

        const small = Math.max(timeApply(8000), 0.5);
        const large = timeApply(32000);

        expect(large / small).toBeLessThan(8);
    });
});

describe('Terraform scanning', () => {
    // Terraform files are untrusted input to the CLI, the library and the Action, like CFN
    // templates (#352). The HCL lexer must visit each character once: a scanner that rescans
    // from the next character after a failed `${` or `%{` is quadratic. Asserted as a ratio
    // (4x the input costs ~4x when linear, ~16x when quadratic; 8 sits clear of both).
    function timeTokenize(source: string): number {
        return minTimeMs({
            fn: () => {
                try {
                    tokenizeHcl({ source });
                } catch {
                    // Inputs built to be rejected must be rejected in linear time too.
                }
            },
        });
    }

    function expectLinear(build: (repeats: number) => string): void {
        timeTokenize(build(8000)); // warm up, so JIT cost does not land on the first measurement
        const small = Math.max(timeTokenize(build(8000)), 0.5);
        const large = timeTokenize(build(32000));
        expect(large / small).toBeLessThan(8);
    }

    test('a heredoc full of interpolations scans in linear time', () => {
        expectLinear((repeats) => `x = <<EOF\n${'"a": "${x.y}",'.repeat(repeats)}\nEOF\n`);
    });

    test('a quoted string full of interpolations scans in linear time', () => {
        expectLinear((repeats) => `x = "${'a${x}'.repeat(repeats)}"`);
    });

    test('an unterminated %{ directive is rejected in linear time', () => {
        expectLinear((repeats) => `x = <<EOF\n%{ ${'a '.repeat(repeats)}\nEOF\n`);
        expectLinear((repeats) => `x = "%{ ${'a '.repeat(repeats)}"`);
    });

    test('repeated "%{" is rejected in linear time', () => {
        expectLinear((repeats) => `x = <<EOF\n${'%{'.repeat(repeats)}\nEOF\n`);
        expectLinear((repeats) => `x = "${'%{'.repeat(repeats)}"`);
    });

    test('a jsonencode object with many keys evaluates in linear time', () => {
        function timeEvaluate(repeats: number): number {
            const keys = Array.from({ length: repeats }, (_, index) => `k${index} = ${index}`);
            const source = `{\n${keys.join('\n')}\n}`;
            const tokens = tokenizeHcl({ source }).filter((token) => token.kind !== 'eof');
            return minTimeMs({ fn: () => evaluateHclLiteral({ source, tokens }) });
        }

        timeEvaluate(8000);
        const small = Math.max(timeEvaluate(8000), 0.5);
        const large = timeEvaluate(32000);

        expect(large / small).toBeLessThan(8);
    });
});
