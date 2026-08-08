import { describe, it, expect } from 'vitest';
import { generateHtml, generateHtmlAsync } from '../src';
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
            expect(result.html).toContain("e.key === '/'"); // focus shortcut
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
