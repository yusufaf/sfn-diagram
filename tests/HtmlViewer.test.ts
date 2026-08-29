import { describe, it, expect } from 'vitest';
import { generateHtml, generateHtmlAsync, generateSvg } from '../src';
import { resolveViewerTheme, wrapSvgInInteractiveHtml } from '../src/renderers';
import type { AslDefinition, CustomTheme } from '../src/types';

const asl = { StartAt: 'A', States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } } };

// No external references — excludes the SVG xmlns namespace URI, which is a
// fixed identifier (never fetched over the network), not an external reference.
const EXTERNAL_REFERENCE = /https?:\/\/(?!www\.w3\.org\/)/;

/** Minimal custom theme; only `background` matters for chrome resolution. */
function customThemeWithBackground(background: string): CustomTheme {
    return {
        background,
        edgeColors: { choice: '#000', default: '#000', error: '#000', normal: '#000' },
        fontFamily: 'sans-serif',
        fontSize: 12,
        nodeColors: {},
    };
}

describe('generateHtml', () => {
    it('returns a self-contained HTML document embedding the SVG', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.html).toContain('<!DOCTYPE html>');
        expect(result.html).toContain('<svg');
        expect(result.html).not.toMatch(EXTERNAL_REFERENCE);
    });

    it('includes the pan/zoom controller and toolbar', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.html).toContain('data-sfn-zoom'); // toolbar hook
        expect(result.html).toContain('wheel'); // zoom handler wired
    });

    it('reports dimensions and metadata matching the SVG', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        expect(result.metadata.nodeCount).toBe(2);
    });

    it('accepts a JSON string definition', () => {
        const result = generateHtml({ aslDefinition: JSON.stringify(asl) });
        expect(result.html).toContain('<!DOCTYPE html>');
        expect(result.html).toContain('data-state-id="A"');
    });

    describe('search', () => {
        it('renders the search input and wires the keyboard shortcuts', () => {
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toContain('id="sfn-search"');
            expect(result.html).toContain('id="sfn-search-count"');
            expect(result.html).toContain("key === '/'"); // focus shortcut
            expect(result.html).toContain('sfn-dim'); // non-matches dimmed
        });
    });

    describe('detail panel', () => {
        it('embeds the state data blob as parseable JSON', () => {
            const result = generateHtml({ aslDefinition: asl });
            const match = result.html.match(
                /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/,
            );
            expect(match).not.toBeNull();
            expect(JSON.parse(match![1])).toEqual(asl.States);
        });

        it('renders the panel markup and the close control', () => {
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toContain('id="sfn-panel"');
            expect(result.html).toContain('id="sfn-panel-close"');
            expect(result.html).toContain('id="sfn-panel-body"');
        });

        it('survives a state whose content would otherwise close the script element', () => {
            const hostile: AslDefinition = {
                StartAt: 'Sneaky',
                States: {
                    Sneaky: {
                        Type: 'Pass',
                        Comment: '</script><script>alert(1)</script>',
                        End: true,
                    },
                },
            };

            const result = generateHtml({ aslDefinition: hostile, includeComments: false });

            // Exactly two script elements: the JSON blob and the viewer controller.
            // The hostile comment survives only as escaped text inside the blob, so it
            // never reaches an executable position.
            expect(result.html.match(/<script/g)).toHaveLength(2);
            expect(result.html).not.toContain('<script>alert');

            const match = result.html.match(
                /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/,
            );
            // Escaping is lossless — the panel still shows the real comment.
            expect(JSON.parse(match![1]).Sneaky.Comment).toBe('</script><script>alert(1)</script>');
        });

        it('omits the panel when no state data is supplied', () => {
            // generateHtml always supplies state data (an empty States map fails
            // validation), so exercise the panel-less branch through the wrapper.
            const html = wrapSvgInInteractiveHtml({ svg: '<svg width="10" height="10"></svg>' });

            expect(html).not.toContain('id="sfn-panel"');
            expect(html).not.toContain('sfn-state-data');
            // Pan/zoom and search still work without it.
            expect(html).toContain('data-sfn-zoom');
            expect(html).toContain('id="sfn-search"');
        });
    });

    describe('node addressability', () => {
        it('tags each node group with its state id and type', () => {
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toContain('data-state-id="A"');
            expect(result.html).toContain('data-state-id="B"');
            expect(result.html).toContain('data-state-type="Pass"');
        });

        it('tags container nodes too', () => {
            const withParallel: AslDefinition = {
                StartAt: 'Fork',
                States: {
                    Fork: {
                        Type: 'Parallel',
                        End: true,
                        Branches: [
                            { StartAt: 'Inner', States: { Inner: { Type: 'Pass', End: true } } },
                        ],
                    },
                },
            };

            const result = generateHtml({ aslDefinition: withParallel });
            expect(result.html).toMatch(
                /class="container container-Parallel" data-state-id="Fork"/,
            );
        });
    });

    describe('minimap', () => {
        it('renders the minimap container, toggle, and no external references', () => {
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toContain('id="sfn-minimap"');
            expect(result.html).toContain('id="sfn-minimap-thumb"');
            expect(result.html).toContain('id="sfn-minimap-viewport"');
            expect(result.html).toContain('data-sfn-minimap-toggle');
            expect(result.html).not.toMatch(EXTERNAL_REFERENCE);
        });

        it('starts collapsed for a diagram at or under the auto-visible threshold', () => {
            // asl has 2 states, well under the threshold.
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toMatch(/id="sfn-minimap" class="sfn-minimap-collapsed"/);
        });

        it('starts open for a diagram over the auto-visible threshold', () => {
            const states: AslDefinition['States'] = {};
            for (let index = 0; index < 30; index++) {
                const isLast = index === 29;
                states[`Step${index}`] = {
                    Type: 'Pass',
                    Next: isLast ? 'Done' : `Step${index + 1}`,
                };
            }
            states.Done = { Type: 'Succeed' };

            const result = generateHtml({ aslDefinition: { StartAt: 'Step0', States: states } });
            expect(result.html).toContain('id="sfn-minimap" data-sfn="minimap"><div id="sfn-minimap-thumb"');
            expect(result.html).not.toContain('id="sfn-minimap" class="sfn-minimap-collapsed"');
        });

        it('starts collapsed when called directly with no nodeCount', () => {
            const html = wrapSvgInInteractiveHtml({ svg: '<svg width="10" height="10"></svg>' });
            expect(html).toMatch(/id="sfn-minimap" class="sfn-minimap-collapsed"/);
        });
    });

    describe('theming', () => {
        it('uses light chrome by default', () => {
            const result = generateHtml({ aslDefinition: asl });
            expect(result.html).toContain('background: #fafafa');
        });

        it('uses dark chrome for the dark theme', () => {
            const result = generateHtml({ aslDefinition: asl, theme: 'dark' });
            expect(result.html).toContain('background: #16191f');
            expect(result.html).not.toContain('background: #fafafa');
        });
    });
});

describe('resolveViewerTheme', () => {
    it('maps the built-in themes directly', () => {
        expect(resolveViewerTheme({ theme: 'dark' })).toBe('dark');
        expect(resolveViewerTheme({ theme: 'light' })).toBe('light');
        expect(resolveViewerTheme({})).toBe('light');
    });

    it('classifies a custom theme by background luminance', () => {
        expect(resolveViewerTheme({ theme: customThemeWithBackground('#101820') })).toBe('dark');
        expect(resolveViewerTheme({ theme: customThemeWithBackground('#fff') })).toBe('light');
    });

    it('falls back to light for a background it cannot parse', () => {
        expect(resolveViewerTheme({ theme: customThemeWithBackground('rebeccapurple') })).toBe(
            'light',
        );
    });
});

describe('generateHtmlAsync', () => {
    it('matches generateHtml when the diagram has no remote icons', async () => {
        const sync = generateHtml({ aslDefinition: asl });
        const async = await generateHtmlAsync({ aslDefinition: asl });
        expect(async.html).toBe(sync.html);
        expect(async.metadata).toEqual(sync.metadata);
    });

    it('produces a document with no external references', async () => {
        const result = await generateHtmlAsync({ aslDefinition: asl });
        expect(result.html).not.toMatch(EXTERNAL_REFERENCE);
    });
});

describe('collapse toggle', () => {
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

    it('embeds two views and a toggle button when the diagram has a container', () => {
        const result = generateHtml({ aslDefinition: parallelAsl });
        expect(result.html).toContain('data-sfn-view="expanded"');
        expect(result.html).toContain('data-sfn-view="collapsed"');
        expect(result.html).toContain('data-sfn-collapse-toggle');
        // Collapsed wrapper starts hidden; expanded is the default view.
        expect(result.html).toMatch(/data-sfn-view="collapsed" hidden/);
    });

    it('embeds only one view and no toggle when the diagram has no container', () => {
        const result = generateHtml({ aslDefinition: asl }); // top-level `asl` fixture: no Parallel/Map
        // Not a plain `.not.toContain('data-sfn-view')`: the compiled viewer controller
        // is inlined into every document (the toggle is detected at runtime, per the
        // architecture note above), and its `querySelector('[data-sfn-view="..."]')`
        // calls contain that substring unconditionally. Assert on the markup pattern
        // (`<div data-sfn-view=...`) specifically, which only the two-view branch emits.
        expect(result.html).not.toMatch(/<div data-sfn-view=/);
        expect(result.html).not.toContain('data-sfn-collapse-toggle');
    });

    it('namespaces marker ids so the two embedded views never collide', () => {
        const result = generateHtml({ aslDefinition: parallelAsl });

        const markerIds = result.html.match(/id="arrowhead-[^"]*"/g) ?? [];
        expect(markerIds.length).toBeGreaterThan(1); // both views define their own
        expect(new Set(markerIds).size).toBe(markerIds.length);

        // Every reference must still resolve to an id that exists in the document.
        const definedIds = new Set(
            markerIds.map((attribute) => attribute.slice('id="'.length, -1)),
        );
        const references = result.html.match(/url\(#(arrowhead-[^)]*)\)/g) ?? [];
        for (const reference of references) {
            expect(definedIds).toContain(reference.slice('url(#'.length, -1));
        }
    });

    it('embeds only one view and no toggle when the caller\'s collapse selection is a no-op', () => {
        // `collapse: []` resolves to nothing being collapsed, so a second render would
        // be byte-identical to the expanded one and the toggle button would do nothing.
        const result = generateHtml({ aslDefinition: parallelAsl, collapse: [] });
        expect(result.html).not.toMatch(/<div data-sfn-view=/);
        expect(result.html).not.toContain('data-sfn-collapse-toggle');
    });

    it('reports the expanded view\'s metadata/dimensions, not the collapsed one\'s', () => {
        const expandedOnly = generateSvg({ aslDefinition: parallelAsl });
        const result = generateHtml({ aslDefinition: parallelAsl });
        expect(result.metadata.nodeCount).toBe(expandedOnly.metadata.nodeCount);
        expect(result.width).toBe(expandedOnly.width);
    });

    it.each([true, false])(
        'keeps the expanded view genuinely expanded when the caller passes collapse: %s',
        (collapse) => {
            const result = generateHtml({ aslDefinition: parallelAsl, collapse });
            // The expanded view must always show the real branch states, regardless of
            // what `collapse` the caller passed - only the collapsed/toggle-target view
            // should honor it. Branch1/Branch2 must appear exactly once (in the expanded
            // view only); if the two views collided (both collapsed or both expanded),
            // they'd either both be missing or both present.
            const branch1Count = (result.html.match(/data-state-id="Branch1"/g) ?? []).length;
            const branch2Count = (result.html.match(/data-state-id="Branch2"/g) ?? []).length;
            expect(branch1Count).toBe(1);
            expect(branch2Count).toBe(1);
        },
    );
});
