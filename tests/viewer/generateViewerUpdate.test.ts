import { describe, it, expect } from 'vitest';
import { generateHtml, generateViewerUpdate } from '../../src';
import { collectEdgeData, collectStateData } from '../../src/renderers';
import type { AslDefinition } from '../../src/types';

const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } } };

const parallelAsl: AslDefinition = {
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

describe('generateViewerUpdate', () => {
    it("matches generateHtml's content node for the same input", () => {
        const { html } = generateHtml({ aslDefinition: asl });
        const update = generateViewerUpdate({ aslDefinition: asl });

        const match = html.match(/data-sfn="content">([\s\S]*?)<\/div><div[^>]* data-sfn="minimap"/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(update.contentHtml);
    });

    it('deep-equals collectStateData/collectEdgeData for stateData/edgeData', () => {
        const update = generateViewerUpdate({ aslDefinition: asl });
        expect(update.stateData).toEqual(collectStateData({ definition: asl }));
        expect(update.edgeData).toEqual(collectEdgeData({ definition: asl }));
    });

    it('reports hasCollapsedView: true for a diagram with a container', () => {
        const update = generateViewerUpdate({ aslDefinition: parallelAsl });
        expect(update.hasCollapsedView).toBe(true);
        expect(update.contentHtml).toContain('data-sfn-view="expanded"');
        expect(update.contentHtml).toContain('data-sfn-view="collapsed"');
    });

    it('reports hasCollapsedView: false for a flat diagram', () => {
        const update = generateViewerUpdate({ aslDefinition: asl });
        expect(update.hasCollapsedView).toBe(false);
        expect(update.contentHtml).not.toMatch(/<div data-sfn-view=/);
    });

    it('reports hasCollapsedView: false when collapse: false is passed', () => {
        const update = generateViewerUpdate({ aslDefinition: parallelAsl, collapse: false });
        expect(update.hasCollapsedView).toBe(false);
    });

    it('reports metadata matching the expanded view', () => {
        const { metadata } = generateHtml({ aslDefinition: parallelAsl });
        const update = generateViewerUpdate({ aslDefinition: parallelAsl });
        expect(update.metadata).toEqual(metadata);
    });

    it('accepts a JSON string definition', () => {
        const update = generateViewerUpdate({ aslDefinition: JSON.stringify(asl) });
        expect(update.contentHtml).toContain('data-state-id="A"');
    });

    it('throws on malformed JSON input', () => {
        expect(() => generateViewerUpdate({ aslDefinition: '{not valid json' })).toThrow();
    });
});
