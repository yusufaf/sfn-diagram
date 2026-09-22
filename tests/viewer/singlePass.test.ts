import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDiff, generateHtml, generateHtmlAsync, generateViewerUpdate } from '../../src';
import * as aslParserModule from '../../src/AslParser';
import { DagreLayout } from '../../src/layout';
import type { AslDefinition } from '../../src/types';

vi.mock('../../src/AslParser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/AslParser')>();
    return { ...actual, parseAsl: vi.fn(actual.parseAsl) };
});

const parseAslSpy = vi.mocked(aslParserModule.parseAsl);
const layoutSpy = vi.spyOn(DagreLayout.prototype, 'calculate');

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, '..', 'fixtures', `${name}.asl.json`), 'utf-8'),
    ) as AslDefinition;
}

const parallelAsl = loadFixture('parallel');
const simpleAsl = loadFixture('simple');

// No external references — excludes the SVG xmlns namespace URI, which is a
// fixed identifier (never fetched over the network), not an external reference.
const EXTERNAL_REFERENCE = /https?:\/\/(?!www\.w3\.org\/)/;

beforeEach(() => {
    parseAslSpy.mockClear();
    layoutSpy.mockClear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * The interactive HTML pipeline parses and lays out once per view, never once per
 * consumer: the expanded SVG, the collapsed SVG, and the viewer's edge/state data all
 * derive from a single `parseAsl` call, and the collapsed view is laid out only when
 * the collapse selection removes something.
 */
describe('generateHtml parses once', () => {
    it('parses once and lays out once for a diagram with a container - the collapsed view is rendered in the browser', () => {
        const { html } = generateHtml({ aslDefinition: parallelAsl });

        expect(html).toContain('data-sfn-collapse-toggle');
        expect(html).toContain('id="sfn-relayout-model"');
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });

    it('parses once and lays out once when there is nothing to collapse', () => {
        generateHtml({ aslDefinition: simpleAsl });

        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });

    it('skips the collapsed layout for an empty collapse selection', () => {
        generateHtml({ aslDefinition: parallelAsl, collapse: [] });

        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });

    it('generateViewerUpdate lays out both pre-rendered views from one parse', () => {
        const update = generateViewerUpdate({ aslDefinition: parallelAsl });

        expect(update.hasCollapsedView).toBe(true);
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        // Expanded view plus the collapsed view behind the toggle.
        expect(layoutSpy).toHaveBeenCalledTimes(2);
    });
});

describe('generateHtmlAsync fetches each icon once', () => {
    it('fetches each distinct icon URL once and embeds it in the relayout model too', async () => {
        const fetchMock = vi.fn(
            async (): Promise<Response> => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const { html } = await generateHtmlAsync({ aslDefinition: parallelAsl, showIcons: true });

        expect(html).toContain('data-sfn-collapse-toggle');
        expect(html).not.toMatch(EXTERNAL_REFERENCE);
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);

        // Both Lambda tasks share one icon; it must be fetched once.
        const fetchedUrls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(fetchedUrls.length).toBeGreaterThan(0);
        expect(new Set(fetchedUrls).size).toBe(fetchedUrls.length);

        // A container collapsed in the browser re-renders from the model, so the
        // model's icon URLs must be the data URIs as well or it would go back online.
        const match = html.match(
            /<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        const model = JSON.parse(match![1]) as { nodes: { iconUrl?: string }[] };
        const iconUrls = model.nodes.flatMap((node) => (node.iconUrl ? [node.iconUrl] : []));
        expect(iconUrls.length).toBeGreaterThan(0);
        for (const url of iconUrls) expect(url).toMatch(/^data:/);
    });
});

describe('generateDiff parses once', () => {
    it('serves the collapse plan and the render from one parse', () => {
        const { svg } = generateDiff({ after: parallelAsl, before: simpleAsl, collapse: true });

        expect(svg).toContain('<svg');
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });
});

describe('overlays ride the same single parse', () => {
    const history = readFileSync(
        join(__dirname, '..', 'fixtures', 'execution-parallel-edges.json'),
        'utf-8',
    );

    it('generateHtml with a history parses once and lays out the one shipped view', () => {
        generateHtml({ aslDefinition: parallelAsl, history });

        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });

    it('generateHtml with a diff parses the merged definition once', () => {
        generateHtml({ aslDefinition: parallelAsl, diff: { before: simpleAsl } });

        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(1);
    });
});
