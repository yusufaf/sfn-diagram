import { bench, describe } from 'vitest';
import { generateExecution, generateMermaid, generateSvg } from '../../src';
import { parseAsl } from '../../src/AslParser';
import { createLayoutCache, DagreLayout } from '../../src/layout';
import { mergeOptions } from '../../src/config';
import { buildLinearChain, buildLinearChainHistory, buildParallel, buildWideChoice } from './fixtures';

/**
 * Micro-benchmarks for the diagram pipeline. Run with `npm run bench`.
 *
 * These do not assert; they track relative throughput of each stage so
 * regressions show up as a drop in ops/sec between runs. The scaling
 * thresholds live in scaling.test.ts (run as part of `npm test`).
 */

const linear500 = buildLinearChain({ length: 500 });
const parallel = buildParallel({ branches: 20, statesPerBranch: 25 });
const wideChoice = buildWideChoice({ width: 200 });
const options = mergeOptions({});

describe('parse', () => {
    bench('linear chain (500 states)', () => {
        parseAsl({ definition: linear500 });
    });

    bench('parallel (20x25 nested states)', () => {
        parseAsl({ definition: parallel });
    });

    bench('wide choice (200 branches)', () => {
        parseAsl({ definition: wideChoice });
    });
});

describe('layout', () => {
    const { nodes, edges } = parseAsl({ definition: linear500 });

    bench('dagre layout (500-state chain)', () => {
        new DagreLayout(options).calculate(nodes, edges);
    });
});

describe('layout cache', () => {
    // The case the cache exists for: a re-render that cannot change geometry, such as a
    // theme switch on an unchanged definition.
    // The cold bench below pays full layout every iteration; the warm one pays the key
    // build and a Map lookup instead, so the gap is what a cache hit actually buys.
    const warmCache = createLayoutCache();
    generateSvg({ aslDefinition: linear500, cache: warmCache });

    bench('generateSvg (500-state chain), no cache', () => {
        generateSvg({ aslDefinition: linear500 });
    });

    bench('generateSvg (500-state chain), warm cache', () => {
        generateSvg({ aslDefinition: linear500, cache: warmCache });
    });

    // Parse and cache construction are hoisted: leaving `parseAsl` in the timed body
    // measured parse + key build and overstated the key by ~70%, which is the number the
    // cache's whole cost argument rests on. The `layout` describe above hoists for the
    // same reason.
    const keyProbe = createLayoutCache();
    const keyGraph = parseAsl({ definition: linear500 });

    bench('cache key build only (500-state chain)', () => {
        keyProbe.keyFor({ edges: keyGraph.edges, nodes: keyGraph.nodes, options });
    });
});

describe('follow re-render (500-state chain)', () => {
    // What `--follow` does each poll: re-render one definition with a newer history.
    // A completed state gains a duration annotation, which is part of the cache key,
    // so a tick only hits when no state finished since the last one. The paced runs
    // below model a fast run (a state finishes every tick) and a slower one (every
    // third tick), each over 30 ticks with one cache for the whole run, as the CLI does.
    const TICKS = 30;
    const history = buildLinearChainHistory({ completed: 250 });
    const warmCache = createLayoutCache();
    generateExecution({ aslDefinition: linear500, cache: warmCache, history });

    /** One history per tick, with a step completing every `pace` ticks. */
    const pacedHistories = (pace: number) =>
        Array.from({ length: TICKS }, (_, tick) =>
            buildLinearChainHistory({ completed: 10 + Math.floor(tick / pace) }),
        );
    const everyTick = pacedHistories(1);
    const everyThirdTick = pacedHistories(3);

    bench('generateExecution, no cache', () => {
        generateExecution({ aslDefinition: linear500, history });
    });

    bench('generateExecution, warm cache (unchanged history)', () => {
        generateExecution({ aslDefinition: linear500, cache: warmCache, history });
    });

    bench('30 ticks advancing every tick, no cache', () => {
        for (const tickHistory of everyTick) {
            generateExecution({ aslDefinition: linear500, history: tickHistory });
        }
    });

    bench('30 ticks advancing every tick, one cache', () => {
        const cache = createLayoutCache();
        for (const tickHistory of everyTick) {
            generateExecution({ aslDefinition: linear500, cache, history: tickHistory });
        }
    });

    bench('30 ticks advancing every 3rd tick, no cache', () => {
        for (const tickHistory of everyThirdTick) {
            generateExecution({ aslDefinition: linear500, history: tickHistory });
        }
    });

    bench('30 ticks advancing every 3rd tick, one cache', () => {
        const cache = createLayoutCache();
        for (const tickHistory of everyThirdTick) {
            generateExecution({ aslDefinition: linear500, cache, history: tickHistory });
        }
    });
});

describe('end-to-end', () => {
    bench('generateSvg (500-state chain)', () => {
        generateSvg({ aslDefinition: linear500 });
    });

    bench('generateMermaid (200-branch choice)', () => {
        generateMermaid({ aslDefinition: wideChoice });
    });
});
