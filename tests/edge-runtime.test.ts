import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { generateSvg, generateMermaid } from '../src';
import type { AslDefinition } from '../src';

/**
 * These tests prove the core SVG/Mermaid generation has no reliance on a DOM
 * (`document`/`window`), so the library runs in edge runtimes such as Cloudflare
 * Workers, Vercel Edge, Deno, and Bun in addition to Node and the browser.
 *
 * We temporarily remove `globalThis.document` and `globalThis.window` to simulate
 * a no-DOM environment; any accidental DOM access would throw `document is not defined`.
 */
const asl: AslDefinition = {
    StartAt: 'Start',
    States: {
        Start: { Type: 'Pass', Next: 'Decide' },
        Decide: {
            Type: 'Choice',
            Choices: [{ Variable: '$.ok', BooleanEquals: true, Next: 'Done' }],
            Default: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

describe('edge runtime (no DOM)', () => {
    const globalScope = globalThis as Record<string, unknown>;
    let savedDocument: unknown;
    let savedWindow: unknown;

    beforeEach(() => {
        savedDocument = globalScope.document;
        savedWindow = globalScope.window;
        delete globalScope.document;
        delete globalScope.window;
    });

    afterEach(() => {
        globalScope.document = savedDocument;
        globalScope.window = savedWindow;
    });

    test('generateSvg works without a DOM', () => {
        expect(globalScope.document).toBeUndefined();
        const { svg, width, height } = generateSvg({ aslDefinition: asl });
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
    });

    test('generateMermaid works without a DOM', () => {
        expect(globalScope.document).toBeUndefined();
        const { code } = generateMermaid({ aslDefinition: asl });
        expect(code).toContain('stateDiagram');
    });
});
