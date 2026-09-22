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
    it('parses once and lays out each shipped view once for a diagram with a container', () => {
        const { html } = generateHtml({ aslDefinition: parallelAsl });

        expect(html).toContain('data-sfn-collapse-toggle');
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        // Expanded view plus the collapsed view behind the toggle.
        expect(layoutSpy).toHaveBeenCalledTimes(2);
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

    it('generateViewerUpdate parses once too', () => {
        const update = generateViewerUpdate({ aslDefinition: parallelAsl });

        expect(update.hasCollapsedView).toBe(true);
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(2);
    });
});

describe('generateHtmlAsync fetches each icon once across both views', () => {
    it('shares one fetch per distinct icon URL between the expanded and collapsed views', async () => {
        const fetchMock = vi.fn(
            async (): Promise<Response> => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const { html } = await generateHtmlAsync({ aslDefinition: parallelAsl, showIcons: true });

        expect(html).toContain('data-sfn-collapse-toggle');
        expect(html).not.toMatch(EXTERNAL_REFERENCE);
        expect(parseAslSpy).toHaveBeenCalledTimes(1);
        expect(layoutSpy).toHaveBeenCalledTimes(2);

        // Both Lambda tasks share one icon; it must be fetched once, not once per view.
        const fetchedUrls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(fetchedUrls.length).toBeGreaterThan(0);
        expect(new Set(fetchedUrls).size).toBe(fetchedUrls.length);
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
