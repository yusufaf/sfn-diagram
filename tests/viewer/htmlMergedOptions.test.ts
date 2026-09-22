import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateHtml, generateHtmlAsync, generateViewerUpdate } from '../../src';
import { DEFAULT_DIAGRAM_OPTIONS } from '../../src/config';
import * as aslParserModule from '../../src/AslParser';
import type { AslDefinition, ViewerEdge } from '../../src/types';

vi.mock('../../src/AslParser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/AslParser')>();
    return { ...actual, parseAsl: vi.fn(actual.parseAsl) };
});

const parseAslSpy = vi.mocked(aslParserModule.parseAsl);

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

/**
 * The viewer's edge data and the rendered SVG come from one `parseAsl` call, so the
 * options that call received are the options both were built from.
 */
function soleParseOptions(): unknown {
    expect(parseAslSpy).toHaveBeenCalledTimes(1);
    return parseAslSpy.mock.calls[0][0].options;
}

beforeEach(() => {
    parseAslSpy.mockClear();
});

describe('HTML viewer edge data uses the same merged options as the rendered SVG', () => {
    it('generateHtml labels the panel the way the diagram is drawn for a non-default catchLabelStyle', () => {
        const { html } = generateHtml({ aslDefinition: catchAsl, catchLabelStyle: 'catch-number' });

        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(html).toContain('Catch #1');
        expect(html).not.toContain('Error: States.ALL');
        expect(soleParseOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
            edgeHitAreas: true,
        });
    });

    it('generateHtml resolves an omitted catchLabelStyle from DEFAULT_DIAGRAM_OPTIONS', () => {
        const { html } = generateHtml({ aslDefinition: catchAsl });

        expect(DEFAULT_DIAGRAM_OPTIONS.catchLabelStyle).toBe('error-type');
        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Error: States.ALL');
        expect(html).toContain('Error: States.ALL');
        expect(soleParseOptions()).toEqual({ ...DEFAULT_DIAGRAM_OPTIONS, edgeHitAreas: true });
    });

    it('generateHtmlAsync passes the same merged options', async () => {
        const { html } = await generateHtmlAsync({
            aslDefinition: catchAsl,
            catchLabelStyle: 'catch-number',
        });

        expect(readEdgeBlob(html)[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(html).toContain('Catch #1');
        expect(soleParseOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
            edgeHitAreas: true,
        });
    });

    it('generateViewerUpdate passes the same merged options', () => {
        const update = generateViewerUpdate({
            aslDefinition: catchAsl,
            catchLabelStyle: 'catch-number',
        });

        expect(update.edgeData[ERROR_EDGE_ID].label).toBe('Catch #1');
        expect(update.contentHtml).toContain('Catch #1');
        expect(soleParseOptions()).toEqual({
            ...DEFAULT_DIAGRAM_OPTIONS,
            catchLabelStyle: 'catch-number',
            edgeHitAreas: true,
        });
    });
});
