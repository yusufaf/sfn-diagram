import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildDiagramGraph, renderSvgGraph } from '../src/pipeline';
import { mergeOptions } from '../src/config';
import { createLayoutCache, LAYOUT_CACHE_OPTION_KEYS } from '../src/layout';
import { generateHtml, generateSvg, generateViewerUpdate } from '../src/index';
import type { AslDefinition, DiagramOptions } from '../src/types';

/**
 * Exercises as many layout-affecting options as one machine can: a Parallel container
 * (so `collapseControls` and container header sizing matter), a Task with an icon and a
 * service type (`showIcons`, `showStateTypes`), and an `Assign` (`showVariables`).
 */
const DEFINITION: AslDefinition = {
    StartAt: 'Fan',
    States: {
        Fan: {
            Type: 'Parallel',
            Branches: [
                {
                    StartAt: 'Charge',
                    States: {
                        Charge: {
                            Type: 'Task',
                            Resource: 'arn:aws:states:::lambda:invoke',
                            Assign: { receiptId: '{% $states.result.id %}' },
                            End: true,
                        },
                    },
                },
                {
                    StartAt: 'Notify',
                    States: {
                        Notify: { Type: 'Task', Resource: 'arn:aws:states:::sns:publish', End: true },
                    },
                },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

/** Freeze an object graph, so any mutation of it throws instead of corrupting silently. */
function deepFreeze(value: unknown, seen = new Set<unknown>()): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
        return;
    }
    seen.add(value);
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
        deepFreeze(nested, seen);
    }
}

/**
 * DagreLayout's source with comments stripped.
 *
 * The enumeration guards below match against it, and a commented-out
 * `this.options.somethingUnkeyed` would otherwise satisfy them.
 */
function layoutSource(): string {
    return readFileSync(join(__dirname, '..', 'src', 'layout', 'DagreLayout.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

function graphFor(options: DiagramOptions) {
    const merged = mergeOptions(options);
    const { edges, nodes } = buildDiagramGraph({ definition: DEFINITION, options: merged });
    return { edges, merged, nodes };
}

/** The cache key for this definition under `options`. */
function keyFor(options: DiagramOptions): string {
    const cache = createLayoutCache();
    const { edges, merged, nodes } = graphFor(options);
    return cache.keyFor({ edges, nodes, options: merged });
}

/** Positions of every node, as the thing a stale cache hit would get wrong. */
function geometryFor(options: DiagramOptions): string {
    const cache = createLayoutCache();
    const { edges, merged, nodes } = graphFor(options);
    const key = cache.keyFor({ edges, nodes, options: merged });
    renderSvgGraph({ cache, edges, nodes, options: merged });
    const positioned = cache.get(key);
    return JSON.stringify(
        positioned?.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]),
    );
}

describe('createLayoutCache', () => {
    test('an unchanged definition under unchanged options hits', () => {
        const cache = createLayoutCache();
        const { edges, merged, nodes } = graphFor({});

        renderSvgGraph({ cache, edges, nodes, options: merged });
        renderSvgGraph({ cache, edges, nodes, options: merged });

        expect(cache.stats()).toEqual({ entries: 1, hits: 1, misses: 1 });
    });

    test('nothing is cached when no cache is passed', () => {
        const cache = createLayoutCache();
        const { edges, merged, nodes } = graphFor({});

        renderSvgGraph({ edges, nodes, options: merged });

        expect(cache.stats()).toEqual({ entries: 0, hits: 0, misses: 0 });
    });

    test('a warm hit produces the same SVG as a cold miss', () => {
        const cache = createLayoutCache();
        const { edges, merged, nodes } = graphFor({});

        const cold = renderSvgGraph({ edges, nodes, options: merged }).svg;
        renderSvgGraph({ cache, edges, nodes, options: merged });
        const warm = renderSvgGraph({ cache, edges, nodes, options: merged }).svg;

        expect(cache.stats().hits).toBe(1);
        expect(warm).toBe(cold);
    });

    test('rejects a non-positive maxEntries', () => {
        expect(() => createLayoutCache({ maxEntries: 0 })).toThrow(/positive integer/);
        expect(() => createLayoutCache({ maxEntries: -1 })).toThrow(/positive integer/);
        expect(() => createLayoutCache({ maxEntries: 1.5 })).toThrow(/positive integer/);
    });

    test('clear() drops every entry', () => {
        const cache = createLayoutCache();
        const { edges, merged, nodes } = graphFor({});

        renderSvgGraph({ cache, edges, nodes, options: merged });
        cache.clear();
        renderSvgGraph({ cache, edges, nodes, options: merged });

        expect(cache.stats().hits).toBe(0);
        expect(cache.stats().misses).toBe(2);
    });
});

describe('layout cache key covers every layout-affecting option', () => {
    // One case per field DagreLayout reads. A field missing from the key makes two
    // geometrically different renders share an entry, so the second returns the first's
    // positions - a silently wrong diagram, which no snapshot catches because the
    // snapshot tests never run against a warm cache (the cache is opt-in).
    //
    // Verified by deleting a field from LAYOUT_OPTION_KEYS in layoutCache.ts and
    // confirming that field's case below fails: each one does.
    const CASES: Array<{ field: string; options: DiagramOptions }> = [
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

    test('the case list matches the exported key list exactly', () => {
        expect(CASES.map((testCase) => testCase.field).sort()).toEqual(
            [...LAYOUT_CACHE_OPTION_KEYS].sort(),
        );
    });

    test.each(CASES)('changing $field changes the cache key', ({ options }) => {
        expect(keyFor(options)).not.toBe(keyFor({}));
    });

    // width and height are deprecated no-ops (#322): DagreLayout no longer reads them,
    // so they must not split the cache key either.
    test.each(['height', 'width'] as const)('%s does not change the cache key (deprecated no-op)', (field) => {
        expect(keyFor({ [field]: 4000 })).toBe(keyFor({}));
    });

    // The guard that survives future edits to DagreLayout: if someone adds a
    // `this.options.<field>` read without adding the field to LAYOUT_OPTION_KEYS, the
    // cache silently goes stale for it. Reading the source is the only way to notice.
    //
    // Verified by adding a throwaway `this.options.diagramTitle` read to DagreLayout and
    // confirming this fails naming `diagramTitle`.
    test('DagreLayout reads no option absent from the key list', () => {
        const source = layoutSource();
        const read = new Set(
            [...source.matchAll(/this\.options\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]),
        );
        const covered = new Set<string>(LAYOUT_CACHE_OPTION_KEYS);
        const uncovered = [...read].filter((field) => !covered.has(field)).sort();

        expect(uncovered).toEqual([]);
    });

    // The regexes above only see `this.options.<field>` / `this.theme.<field>`. A
    // destructure or a dynamic index widens the layout's real inputs invisibly to them,
    // so rather than quietly passing, fail and say the guard can no longer analyse the
    // file. Without this the guard is evadable by the most ordinary refactor there is.
    //
    // Verified by adding `const { padding } = this.options;` to DagreLayout and
    // confirming this fails while the two field tests above still pass.
    test('DagreLayout reads its options and theme only in forms the guard can see', () => {
        const source = layoutSource();
        const opaque = [
            /\}\s*=\s*this\.options/,
            /\}\s*=\s*this\.theme/,
            /this\.options\s*\[/,
            /this\.theme\s*\[/,
            // `this.theme` or `this.options` passed somewhere whole, rather than read.
            /[(,]\s*this\.(options|theme)\s*[,)]/,
        ];
        const found = opaque.filter((pattern) => pattern.test(source)).map(String);

        expect(found).toEqual([]);
    });

    // Same hazard on the theme side. DagreLayout resolves a theme in its constructor and
    // reads `fontSize` from it to size container headers, so a theme differing only in
    // fontSize is a different layout - the issue described theme as unable to affect it.
    //
    // Verified by removing `fontSize` from the key and confirming this fails.
    test('a custom theme fontSize changes the cache key', () => {
        expect(keyFor({ theme: { fontSize: 18 } })).not.toBe(keyFor({}));
    });

    test('reading another theme field would be uncovered', () => {
        const source = layoutSource();
        const themeFields = new Set(
            [...source.matchAll(/this\.theme\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]),
        );
        // Only fontSize is in the key, so this failing means the key needs widening.
        expect([...themeFields].sort()).toEqual(['fontSize']);
    });

    // The flip side, and the whole point of the issue: a change that cannot move geometry
    // must still hit. Both built-in themes agree on fontSize, so a light/dark toggle -
    // the VS Code preview's most common re-render - reuses the layout.
    test('toggling between the built-in themes hits', () => {
        const cache = createLayoutCache();
        const light = graphFor({ theme: 'light' });
        const dark = graphFor({ theme: 'dark' });

        renderSvgGraph({ cache, edges: light.edges, nodes: light.nodes, options: light.merged });
        renderSvgGraph({ cache, edges: dark.edges, nodes: dark.nodes, options: dark.merged });

        expect(cache.stats()).toEqual({ entries: 1, hits: 1, misses: 1 });
    });
});

describe('layout cache does not return a stale layout', () => {
    // The failure the cache risks, stated as a test: changing a geometry option must
    // produce different positions even when the cache is already warm for the old ones.
    const GEOMETRY_CASES: DiagramOptions[] = [
        { layout: 'LR' },
        { nodeSeparation: 200 },
        { nodeWidth: 400 },
        { padding: 90 },
        { rankSeparation: 220 },
    ];

    test.each(GEOMETRY_CASES)('%o lays out differently from the defaults', (options) => {
        expect(geometryFor(options)).not.toBe(geometryFor({}));
    });

    // The concrete proof that the theme belongs in the key at all. DagreLayout sizes a
    // container header from `theme.fontSize`, so a different font size resizes the
    // container - meaning a theme differing only in fontSize is a different layout,
    // contrary to the issue's premise that theme cannot affect it. Measured widths for
    // this definition: 257.12 at fontSize 8, 377.68 at 14, 317.40 at 30.
    //
    // The shared DEFINITION above cannot show this - its labels are short enough that a
    // minimum width dominates - which is why this case carries a long container label.
    //
    // Verified by removing `fontSize` from the key and confirming this fails.
    test('a container header responds to theme fontSize, so fontSize must be keyed', () => {
        const definition = {
            StartAt: 'Batch',
            States: {
                Batch: {
                    Type: 'Map',
                    Label: 'AVeryLongDistributedMapLabelHere',
                    MaxConcurrency: 25,
                    ItemProcessor: {
                        ProcessorConfig: { Mode: 'DISTRIBUTED' },
                        StartAt: 'Work',
                        States: { Work: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', End: true } },
                    },
                    End: true,
                },
            },
        } as AslDefinition;

        const widthAt = (fontSize: number): number | undefined => {
            const merged = mergeOptions({ theme: { fontSize } });
            const { edges, nodes } = buildDiagramGraph({ definition, options: merged });
            const cache = createLayoutCache();
            const key = cache.keyFor({ edges, nodes, options: merged });
            renderSvgGraph({ cache, edges, nodes, options: merged });
            return cache.get(key)?.nodes.find((node) => node.id === 'Batch')?.width;
        };

        expect(widthAt(8)).not.toBe(widthAt(30));
        expect(keyFor({ theme: { fontSize: 8 } })).not.toBe(keyFor({ theme: { fontSize: 30 } }));
    });

    test('a warm cache does not leak one view into another', () => {
        const cache = createLayoutCache();
        const base = graphFor({});
        const wide = graphFor({ nodeWidth: 400 });

        const baseFirst = renderSvgGraph({ cache, edges: base.edges, nodes: base.nodes, options: base.merged }).svg;
        const wideSvg = renderSvgGraph({ cache, edges: wide.edges, nodes: wide.nodes, options: wide.merged }).svg;
        const baseAgain = renderSvgGraph({ cache, edges: base.edges, nodes: base.nodes, options: base.merged }).svg;

        expect(wideSvg).not.toBe(baseFirst);
        expect(baseAgain).toBe(baseFirst);
        expect(cache.stats().hits).toBe(1);
    });

    // A hit hands back the stored object rather than a clone, which is only safe if no
    // consumer mutates it - otherwise the second render corrupts the entry for the third.
    // Freezing turns any such mutation into a throw instead of a silent wrong diagram.
    //
    // Verified by adding `positioned.nodes[0].x = 1` to renderSvgGraph and confirming
    // this fails with "Cannot assign to read only property".
    test('rendering does not mutate the cached layout', () => {
        const cache = createLayoutCache();
        const { edges, merged, nodes } = graphFor({});
        const key = cache.keyFor({ edges, nodes, options: merged });

        renderSvgGraph({ cache, edges, nodes, options: merged });
        const stored = cache.get(key);
        expect(stored).toBeDefined();
        deepFreeze(stored);

        expect(() => renderSvgGraph({ cache, edges, nodes, options: merged })).not.toThrow();
    });
});

describe('layout cache eviction', () => {
    test('evicts the least recently used entry past maxEntries', () => {
        const cache = createLayoutCache({ maxEntries: 2 });
        const first = graphFor({ nodeWidth: 101 });
        const second = graphFor({ nodeWidth: 102 });
        const third = graphFor({ nodeWidth: 103 });

        renderSvgGraph({ cache, edges: first.edges, nodes: first.nodes, options: first.merged });
        renderSvgGraph({ cache, edges: second.edges, nodes: second.nodes, options: second.merged });
        renderSvgGraph({ cache, edges: third.edges, nodes: third.nodes, options: third.merged });

        expect(cache.stats().entries).toBe(2);
        // The first is gone, so re-rendering it misses again.
        renderSvgGraph({ cache, edges: first.edges, nodes: first.nodes, options: first.merged });
        expect(cache.stats().hits).toBe(0);
    });

    // Recency, not insertion order: a `get` must move its entry to the back, or the LRU
    // degrades into a FIFO that evicts the entry you are actively using.
    //
    // Verified by removing the delete-then-set in `get` and confirming this fails.
    test('a hit refreshes an entry so it is not the next evicted', () => {
        const cache = createLayoutCache({ maxEntries: 2 });
        const first = graphFor({ nodeWidth: 201 });
        const second = graphFor({ nodeWidth: 202 });
        const third = graphFor({ nodeWidth: 203 });

        renderSvgGraph({ cache, edges: first.edges, nodes: first.nodes, options: first.merged });
        renderSvgGraph({ cache, edges: second.edges, nodes: second.nodes, options: second.merged });
        // Touch the first so the second becomes least recently used.
        renderSvgGraph({ cache, edges: first.edges, nodes: first.nodes, options: first.merged });
        renderSvgGraph({ cache, edges: third.edges, nodes: third.nodes, options: third.merged });

        const hitsBefore = cache.stats().hits;
        renderSvgGraph({ cache, edges: first.edges, nodes: first.nodes, options: first.merged });
        expect(cache.stats().hits).toBe(hitsBefore + 1);
    });
});

describe('layout cache through the public API', () => {
    test('generateSvg accepts a cache and reuses the layout', () => {
        const cache = createLayoutCache();

        const first = generateSvg({ aslDefinition: DEFINITION, cache });
        const second = generateSvg({ aslDefinition: DEFINITION, cache });

        expect(cache.stats().hits).toBe(1);
        expect(second.svg).toBe(first.svg);
    });

    // The entry point the issue is actually about: the VS Code preview and the React
    // wrapper call this on every change, including changes that cannot move geometry.
    test('generateViewerUpdate reuses the layout across a theme change', () => {
        const cache = createLayoutCache();

        const light = generateViewerUpdate({ aslDefinition: DEFINITION, cache, theme: 'light' });
        const dark = generateViewerUpdate({ aslDefinition: DEFINITION, cache, theme: 'dark' });

        // Two views per call (expanded plus collapsed), so a second call hits both.
        expect(cache.stats().hits).toBeGreaterThan(0);
        // Same geometry, different paint: the markup must still differ by theme.
        expect(dark.contentHtml).not.toBe(light.contentHtml);
    });

    test('generateHtml accepts a cache', () => {
        const cache = createLayoutCache();

        generateHtml({ aslDefinition: DEFINITION, cache });
        generateHtml({ aslDefinition: DEFINITION, cache });

        expect(cache.stats().hits).toBeGreaterThan(0);
    });

    test('the cache never reaches the rendered output', () => {
        const cache = createLayoutCache();
        const { svg } = generateSvg({ aslDefinition: DEFINITION, cache });

        // A cache leaking into the merged options would be serialised into the markup.
        expect(svg).not.toContain('keyFor');
        expect(svg).not.toContain('maxEntries');
    });
});
