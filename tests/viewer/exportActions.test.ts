import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { generateHtml, generateMermaid, generateViewerUpdate } from '../../src';
import { buildViewerBody } from '../../src/renderers/viewer';
import { CANVAS_LIMITS, diagramSize, fitRasterScale } from '../../src/renderers/viewer/controller/rasterize';
import type { AslDefinition } from '../../src/types';

/**
 * The generate-time half of the toolbar's exports: the embedded Mermaid blob and the
 * buttons that read it. Driving the buttons themselves is in `viewerRuntime.test.ts`.
 */

const definition: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Next: 'Omega' },
        Omega: { Type: 'Succeed' },
    },
};

/** The parsed `#sfn-mermaid-data` blob, which holds a bare JSON string. */
function mermaidBlob(html: string): string {
    const match = /<script type="application\/json" id="sfn-mermaid-data">([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error('no #sfn-mermaid-data blob in the document');
    return JSON.parse(match[1]) as string;
}

describe('embedded Mermaid source', () => {
    it('embeds the same code generateMermaid would produce for the drawn diagram', () => {
        const { html } = generateHtml({ aslDefinition: definition });
        expect(mermaidBlob(html)).toBe(generateMermaid({ aslDefinition: definition }).code);
    });

    it('ships it on every document, so the button is never a dead end', () => {
        // No opt-in: the code is state names and transitions, all of which the SVG
        // beside it already draws, so there is nothing here the document did not
        // already disclose.
        const { html } = generateHtml({ aslDefinition: { StartAt: 'Only', States: { Only: { Type: 'Succeed' } } } });
        expect(mermaidBlob(html)).toContain('stateDiagram-v2');
    });

    it('describes the merged definition when diffing, so a removed state is in it', () => {
        const before: AslDefinition = {
            StartAt: 'Dropped',
            States: { Dropped: { Type: 'Pass', End: true } },
        };
        const { html } = generateHtml({ aslDefinition: definition, diff: { before } });
        expect(mermaidBlob(html)).toContain('Dropped');
    });

    it('carries the diff overlay, not just the structure under it', () => {
        const before: AslDefinition = {
            StartAt: 'Alpha',
            States: { Alpha: { Type: 'Task', Resource: 'arn:old', Next: 'Omega' }, Omega: { Type: 'Succeed' } },
        };
        const code = mermaidBlob(generateHtml({ aslDefinition: definition, diff: { before } }).html);

        // Mermaid has class definitions for a diff, so a copy taken from a diff
        // document should not silently drop the colours the reader came for.
        expect(code).toContain('classDef');
        expect(code).toContain('classDef diffModified');
        expect(code).toContain('class Alpha diffModified');
    });

    it('carries the execution overlay too', () => {
        const events = JSON.parse(
            readFileSync(join(__dirname, '..', 'fixtures', 'execution-success.json'), 'utf-8'),
        ).events as unknown[];
        const { html } = generateHtml({
            aslDefinition: JSON.parse(
                readFileSync(join(__dirname, '..', 'fixtures', 'simple.asl.json'), 'utf-8'),
            ) as AslDefinition,
            history: { events } as never,
        });

        expect(mermaidBlob(html)).toContain('classDef');
    });

    it('carries it on a viewer update too, so a swap cannot strand the old diagram', () => {
        const update = generateViewerUpdate({ aslDefinition: definition });
        expect(update.mermaid).toBe(generateMermaid({ aslDefinition: definition }).code);
    });
});

describe('export toolbar markup', () => {
    it('renders both buttons for a document that embedded Mermaid', () => {
        const { html } = generateHtml({ aslDefinition: definition });
        expect(html).toContain('data-sfn="export-svg"');
        expect(html).toContain('data-sfn="copy-mermaid"');
    });

    it('renders the PNG button between the SVG download and the Mermaid copy', () => {
        const { html } = generateHtml({ aslDefinition: definition });
        const svgAt = html.indexOf('data-sfn="export-svg"');
        const pngAt = html.indexOf('data-sfn="export-png"');
        const mermaidAt = html.indexOf('data-sfn="copy-mermaid"');
        expect(svgAt).toBeGreaterThan(-1);
        expect(pngAt).toBeGreaterThan(svgAt);
        expect(mermaidAt).toBeGreaterThan(pngAt);
    });

    it('renders neither unless asked, so an embedded body opts in', () => {
        const body = buildViewerBody({ minimapCollapsed: false, panel: false, svg: '<svg></svg>' });
        expect(body).not.toContain('data-sfn="export-svg"');
        expect(body).not.toContain('data-sfn="export-png"');
        expect(body).not.toContain('data-sfn="copy-mermaid"');
    });

    it('renders the PNG button on its own when asked', () => {
        const body = buildViewerBody({
            exportPng: true,
            minimapCollapsed: false,
            panel: false,
            svg: '<svg></svg>',
        });
        // The export group's own divider, not one of the two around the search box.
        expect(body).toContain('<span class="sfn-divider"></span>\n  <button data-sfn="export-png"');
        expect(body).not.toContain('data-sfn="export-svg"');
    });

    it('renders the download on its own when there is no Mermaid to copy', () => {
        const body = buildViewerBody({
            exportSvg: true,
            minimapCollapsed: false,
            panel: false,
            svg: '<svg></svg>',
        });
        expect(body).toContain('data-sfn="export-svg"');
        expect(body).not.toContain('data-sfn="copy-mermaid"');
    });
});

describe('fitRasterScale', () => {
    const [largest] = CANVAS_LIMITS;
    const smallest = CANVAS_LIMITS[CANVAS_LIMITS.length - 1];

    it('keeps the requested scale for an ordinary diagram', () => {
        expect(fitRasterScale({ height: 600, limit: largest, scale: 2, width: 800 })).toBe(2);
    });

    it('shrinks to the area cap', () => {
        const scale = fitRasterScale({ height: 20000, limit: largest, scale: 2, width: 20000 });
        expect(scale).toBeLessThan(2);
        expect(Math.floor(20000 * scale) ** 2).toBeLessThanOrEqual(largest.maxArea);
    });

    it('shrinks to the dimension cap', () => {
        const scale = fitRasterScale({ height: 100, limit: largest, scale: 2, width: 30000 });
        expect(scale).toBeLessThan(2);
        expect(Math.floor(30000 * scale)).toBeLessThanOrEqual(largest.maxDimension);
    });

    it('uses the smaller area on the last rung', () => {
        const scale = fitRasterScale({ height: 3000, limit: smallest, scale: 2, width: 3000 });
        expect(Math.floor(3000 * scale) ** 2).toBeLessThanOrEqual(16_777_216);
    });

    it('orders the ladder from largest to smallest area', () => {
        for (let index = 1; index < CANVAS_LIMITS.length; index++) {
            expect(CANVAS_LIMITS[index].maxArea).toBeLessThan(CANVAS_LIMITS[index - 1].maxArea);
        }
    });
});

describe('diagramSize', () => {
    /** Just enough of an Element for diagramSize, which only reads attributes. */
    const svgWith = (attributes: Record<string, string>): Element =>
        ({ getAttribute: (name: string) => attributes[name] ?? null }) as unknown as Element;

    it('reads plain pixel lengths, with or without a px unit', () => {
        expect(diagramSize({ svg: svgWith({ height: '210px', width: '160' }) })).toEqual({ height: 210, width: 160 });
    });

    it('accepts the other forms an SVG length can take', () => {
        expect(diagramSize({ svg: svgWith({ height: '1.2e3', width: '.5' }) })).toEqual({ height: 1200, width: 0.5 });
        expect(diagramSize({ svg: svgWith({ height: '+800', width: '800.' }) })).toEqual({ height: 800, width: 800 });
    });

    it('falls back to the viewBox for a percentage size', () => {
        const svg = svgWith({ height: '100%', viewBox: '0 0 400 600', width: '100%' });
        expect(diagramSize({ svg })).toEqual({ height: 600, width: 400 });
    });

    it('returns null when nothing gives a positive size', () => {
        expect(diagramSize({ svg: svgWith({ width: '100%' }) })).toBeNull();
        expect(diagramSize({ svg: svgWith({ height: '0', viewBox: '0 0 0 0', width: '0' }) })).toBeNull();
    });
});
