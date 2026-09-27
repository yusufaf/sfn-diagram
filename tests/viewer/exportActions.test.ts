import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { generateHtml, generateMermaid, generateViewerUpdate } from '../../src';
import { buildViewerBody } from '../../src/renderers/viewer';
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

    it('renders neither unless asked, so an embedded body opts in', () => {
        const body = buildViewerBody({ minimapCollapsed: false, panel: false, svg: '<svg></svg>' });
        expect(body).not.toContain('data-sfn="export-svg"');
        expect(body).not.toContain('data-sfn="copy-mermaid"');
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
