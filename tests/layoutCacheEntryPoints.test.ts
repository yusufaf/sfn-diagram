import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { exportPng } from '../src/png';
import { createLayoutCache, LAYOUT_CACHE_OPTION_KEYS } from '../src/layout';
import { generateDiagram, generateFromAwsResponse, generateSvg, SfnDiagramGenerator } from '../src/index';
import type { AslDefinition, DiagramOptions } from '../src/types';

const FIXTURE_DIR = join(__dirname, 'fixtures');
const FIXTURES = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.asl.json'))
    .map((name) => ({
        aslDefinition: JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8')) as AslDefinition,
        name,
    }));

const DEFINITION: AslDefinition = {
    StartAt: 'Work',
    States: {
        Done: { End: true, Type: 'Succeed' },
        Work: { Next: 'Done', Type: 'Pass' },
    },
};

// One option per keyed field, each chosen to move geometry (or the key) on DEFINITION.
const KEYED_OPTIONS: Array<{ field: string; options: DiagramOptions }> = [
    { field: 'collapseControls', options: { collapseControls: true } },
    { field: 'iconPosition', options: { iconPosition: 'left', showIcons: true } },
    { field: 'layout', options: { layout: 'LR' } },
    { field: 'nodeAnnotations', options: { nodeAnnotations: { Done: 'annotated' } } },
    { field: 'nodeHeight', options: { nodeHeight: 123 } },
    { field: 'nodeSeparation', options: { nodeSeparation: 137 } },
    { field: 'nodeWidth', options: { nodeWidth: 321 } },
    { field: 'padding', options: { padding: 77 } },
    { field: 'rankSeparation', options: { rankSeparation: 149 } },
    { field: 'showIcons', options: { showIcons: true } },
    { field: 'showStateTypes', options: { showStateTypes: true } },
    { field: 'showVariables', options: { showVariables: false } },
];

describe('warm renders match cold renders', () => {
    test('the fixture set is not empty', () => {
        expect(FIXTURES.length).toBeGreaterThan(5);
    });

    test.each(FIXTURES)('generateSvg is byte-identical warm and cold: $name', ({ aslDefinition }) => {
        const cache = createLayoutCache();
        const cold = generateSvg({ aslDefinition });

        generateSvg({ aslDefinition, cache });
        const warm = generateSvg({ aslDefinition, cache });

        expect(cache.stats().hits).toBe(1);
        expect(warm.svg).toBe(cold.svg);
    });

    test.each(FIXTURES)('SfnDiagramGenerator is byte-identical warm and cold: $name', ({ aslDefinition }) => {
        const cache = createLayoutCache();
        const cold = new SfnDiagramGenerator().generateSvg({ aslDefinition });
        const generator = new SfnDiagramGenerator({ cache });

        generator.generateSvg({ aslDefinition });
        const warm = generator.generateSvg({ aslDefinition });

        expect(cache.stats().hits).toBe(1);
        expect(warm.svg).toBe(cold.svg);
    });
});

describe('every keyed option is a miss through the entry points', () => {
    test('the case list matches the exported key list exactly', () => {
        expect(KEYED_OPTIONS.map((testCase) => testCase.field).sort()).toEqual(
            [...LAYOUT_CACHE_OPTION_KEYS].sort(),
        );
    });

    test.each(KEYED_OPTIONS)('changing $field misses and renders like a cold call', ({ options }) => {
        const cache = createLayoutCache();

        generateSvg({ aslDefinition: DEFINITION, cache });
        const changed = generateSvg({ aslDefinition: DEFINITION, cache, ...options });

        expect(cache.stats()).toMatchObject({ entries: 2, hits: 0, misses: 2 });
        expect(changed.svg).toBe(generateSvg({ aslDefinition: DEFINITION, ...options }).svg);
    });
});

describe('generateDiagram', () => {
    test('forwards the cache for svg', () => {
        const cache = createLayoutCache();

        generateDiagram({ aslDefinition: DEFINITION, cache });
        generateDiagram({ aslDefinition: DEFINITION, cache });

        expect(cache.stats().hits).toBe(1);
    });

    test('forwards the cache for html', () => {
        const cache = createLayoutCache();

        generateDiagram({ aslDefinition: DEFINITION, cache, format: 'html' });
        generateDiagram({ aslDefinition: DEFINITION, cache, format: 'html' });

        expect(cache.stats().hits).toBeGreaterThan(0);
    });

    test('ignores the cache for mermaid, which does no layout', () => {
        const cache = createLayoutCache();

        const withCache = generateDiagram({ aslDefinition: DEFINITION, cache, format: 'mermaid' });
        const without = generateDiagram({ aslDefinition: DEFINITION, format: 'mermaid' });

        expect(cache.stats()).toMatchObject({ entries: 0, hits: 0, misses: 0 });
        expect(withCache).toEqual(without);
    });
});

describe('generateFromAwsResponse', () => {
    test('forwards the cache through generateDiagram', () => {
        const cache = createLayoutCache();
        const response = { definition: JSON.stringify(DEFINITION) } as Parameters<
            typeof generateFromAwsResponse
        >[0]['response'];

        generateFromAwsResponse({ cache, response });
        generateFromAwsResponse({ cache, response });

        expect(cache.stats().hits).toBe(1);
    });
});

describe('SfnDiagramGenerator', () => {
    test('caches nothing unless given a cache', () => {
        const generator = new SfnDiagramGenerator();
        const first = generator.generateSvg({ aslDefinition: DEFINITION });

        expect(generator.generateSvg({ aslDefinition: DEFINITION }).svg).toBe(first.svg);
    });

    test('generate() shares the cache with generateSvg()', () => {
        const cache = createLayoutCache();
        const generator = new SfnDiagramGenerator({ cache });

        generator.generateSvg({ aslDefinition: DEFINITION });
        generator.generate({ aslDefinition: DEFINITION });

        expect(cache.stats().hits).toBe(1);
    });

    test('setOptions that changes layout misses; a theme change still hits', () => {
        const cache = createLayoutCache();
        const generator = new SfnDiagramGenerator({ cache });

        generator.generateSvg({ aslDefinition: DEFINITION });
        generator.setOptions({ theme: 'dark' }).generateSvg({ aslDefinition: DEFINITION });
        expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });

        generator.setOptions({ layout: 'LR' }).generateSvg({ aslDefinition: DEFINITION });
        expect(cache.stats()).toMatchObject({ hits: 1, misses: 2 });
    });

    test('the cache never leaks into the merged options or the markup', () => {
        const generator = new SfnDiagramGenerator({ cache: createLayoutCache() });
        const { svg } = generator.generateSvg({ aslDefinition: DEFINITION });

        expect(svg).not.toContain('keyFor');
        expect(svg).not.toContain('maxEntries');
    });
});

describe('exportPng', () => {
    test('reuses the layout and renders the same bytes warm and cold', async () => {
        const cache = createLayoutCache();
        const cold = await exportPng({ aslDefinition: DEFINITION });

        await exportPng({ aslDefinition: DEFINITION, cache });
        const warm = await exportPng({ aslDefinition: DEFINITION, cache });

        expect(cache.stats().hits).toBe(1);
        expect(Buffer.compare(warm.buffer, cold.buffer)).toBe(0);
    });
});
