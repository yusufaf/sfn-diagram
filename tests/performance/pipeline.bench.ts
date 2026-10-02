import { bench, describe } from 'vitest';
import { generateMermaid, generateSvg } from '../../src';
import { parseAsl } from '../../src/AslParser';
import { createLayoutCache, DagreLayout } from '../../src/layout';
import { mergeOptions } from '../../src/config';
import { buildLinearChain, buildParallel, buildWideChoice } from './fixtures';

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
    // The case the cache exists for: a re-render that cannot change geometry - a theme
    // change, an icon toggle, an execution overlay painted on an unchanged definition.
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

    bench('cache key build only (500-state chain)', () => {
        const probe = createLayoutCache();
        const { edges, nodes } = parseAsl({ definition: linear500 });
        probe.keyFor({ edges, nodes, options });
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
