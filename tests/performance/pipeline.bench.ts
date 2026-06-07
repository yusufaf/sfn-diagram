import { bench, describe } from 'vitest';
import { generateMermaid, generateSvg } from '../../src';
import { parseAsl } from '../../src/AslParser';
import { DagreLayout } from '../../src/layout';
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

describe('end-to-end', () => {
    bench('generateSvg (500-state chain)', () => {
        generateSvg({ aslDefinition: linear500 });
    });

    bench('generateMermaid (200-branch choice)', () => {
        generateMermaid({ aslDefinition: wideChoice });
    });
});
