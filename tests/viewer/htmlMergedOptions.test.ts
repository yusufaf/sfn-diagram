import { describe, it, expect, vi } from 'vitest';
import { generateHtml, generateHtmlAsync, generateViewerUpdate } from '../../src';
import { DEFAULT_DIAGRAM_OPTIONS } from '../../src/config';
import * as edgeDataModule from '../../src/renderers/viewer/edgeData';
import type { AslDefinition, ViewerEdge } from '../../src/types';

vi.mock('../../src/renderers/viewer/edgeData', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/renderers/viewer/edgeData')>();
    return { ...actual, collectEdgeData: vi.fn(actual.collectEdgeData) };
});

const collectEdgeDataSpy = vi.mocked(edgeDataModule.collectEdgeData);

const catchAsl: AslDefinition = {
    StartAt: 'Work',
    States: {
        Work: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:work',
            Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Recover' }],
            End: true,
        },
        Recover: { Type: 'Succeed' },
    },
};

const ERROR_EDGE_ID = 'Work->Recover#error#0';

function readEdgeBlob(html: string): Record<string, ViewerEdge> {
    const match = html.match(
        /<script type="application\/json" id="sfn-edge-data">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    return JSON.parse(match![1]) as Record<string, ViewerEdge>;
}

function lastCollectEdgeDataOptions(): unknown {
    const lastCall = collectEdgeDataSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    return lastCall![0].options;
}

describe('HTML viewer edge data uses the same merged options as the rendered SVG', () => {
    it('generateHtml labels the panel the way the diagram is drawn for a non-default catchLabelStyle', () => {
        const { html } = generateHtml({ aslDefinition: catchAsl, catchLabelStyle: 'catch-number' });

        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(html).toContain('Catch #1');
        expect(html).not.toContain('Error: States.ALL');
        expect(lastCollectEdgeDataOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
        });
    });

    it('generateHtml resolves an omitted catchLabelStyle from DEFAULT_DIAGRAM_OPTIONS', () => {
        const { html } = generateHtml({ aslDefinition: catchAsl });

        expect(DEFAULT_DIAGRAM_OPTIONS.catchLabelStyle).toBe('error-type');
        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Error: States.ALL');
        expect(html).toContain('Error: States.ALL');
        expect(lastCollectEdgeDataOptions()).toEqual(DEFAULT_DIAGRAM_OPTIONS);
    });

    it('generateHtmlAsync passes the same merged options', async () => {
        const { html } = await generateHtmlAsync({
            aslDefinition: catchAsl,
            catchLabelStyle: 'catch-number',
        });

        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(html).toContain('Catch #1');
        expect(lastCollectEdgeDataOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
        });
    });

    it('generateViewerUpdate passes the same merged options', () => {
        const update = generateViewerUpdate({
            aslDefinition: catchAsl,
            catchLabelStyle: 'catch-number',
        });

        expect(update.edgeData[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(update.contentHtml).toContain('Catch #1');
        expect(lastCollectEdgeDataOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
        });
    });
});
