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

describe('parser scaling', () => {
    test('parses a 2000-state linear chain quickly', () => {
        const asl = buildLinearChain({ length: 2000 });
        const elapsed = timeMs(() => parseAsl({ definition: asl }));
        expect(elapsed).toBeLessThan(500);
    });

    test('parse time scales roughly linearly with state count', () => {
        const small = buildLinearChain({ length: 500 });
        const large = buildLinearChain({ length: 2000 }); // 4x the states

        // Warm up to avoid first-run JIT skew dominating the measurement.
        parseAsl({ definition: small });
        parseAsl({ definition: large });

        const smallTime = timeMs(() => parseAsl({ definition: small })) || 0.01;
        const largeTime = timeMs(() => parseAsl({ definition: large }));

        // 4x input should stay well under quadratic (16x). Allow 8x headroom
        // for measurement noise; an O(n^2) regression would blow past this.
        expect(largeTime / smallTime).toBeLessThan(8);
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
