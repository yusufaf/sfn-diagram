import { describe, it, expect } from 'vitest';
import {
    buildViewerBody,
    buildViewerContent,
    minimapStartsCollapsed,
    VIEWER_STRINGS,
    wrapSvgInInteractiveHtml,
} from '../../src/renderers/viewer';

describe('buildViewerContent', () => {
    it('renders the svg directly for a single view', () => {
        const contentHtml = buildViewerContent({ minimapCollapsed: true, svg: '<svg>one</svg>' });
        expect(contentHtml).toBe('<svg>one</svg>');
    });

    it('matches the contentInner buildViewerBody embeds for a single view', () => {
        const params = { minimapCollapsed: true, panel: false, svg: '<svg>one</svg>' };
        const body = buildViewerBody(params);
        const contentHtml = buildViewerContent(params);
        expect(body).toContain(`data-sfn="content">${contentHtml}</div>`);
    });

    it('wraps two views with minimap-auto flags when a collapsed rendering is supplied', () => {
        const contentHtml = buildViewerContent({
            collapsedMinimapCollapsed: false,
            collapsedSvg: '<svg>collapsed</svg>',
            minimapCollapsed: true,
            svg: '<svg>expanded</svg>',
        });
        expect(contentHtml).toBe(
            '<div data-sfn-view="expanded" data-sfn-minimap-auto="1"><svg>expanded</svg></div>' +
                '<div data-sfn-view="collapsed" data-sfn-minimap-auto="0" hidden><svg>collapsed</svg></div>',
        );
    });

    it('defaults collapsedMinimapCollapsed to minimapCollapsed when omitted', () => {
        const contentHtml = buildViewerContent({
            collapsedSvg: '<svg>collapsed</svg>',
            minimapCollapsed: false,
            svg: '<svg>expanded</svg>',
        });
        expect(contentHtml).toContain('data-sfn-view="expanded" data-sfn-minimap-auto="0"');
        expect(contentHtml).toContain('data-sfn-view="collapsed" data-sfn-minimap-auto="0"');
    });

    it('namespaces marker ids in the collapsed view so the two copies never collide', () => {
        const contentHtml = buildViewerContent({
            collapsedSvg: '<marker id="arrowhead-normal"></marker><path marker-end="url(#arrowhead-normal)"></path>',
            minimapCollapsed: true,
            svg: '<marker id="arrowhead-normal"></marker>',
        });
        expect(contentHtml).toContain('id="arrowhead-collapsed-normal"');
        expect(contentHtml).toContain('url(#arrowhead-collapsed-normal)');
    });

    it('namespaces the collapsed view after a caller idPrefix', () => {
        const contentHtml = buildViewerContent({
            collapsedSvg:
                '<marker id="p-arrowhead-normal"></marker><path marker-end="url(#p-arrowhead-normal)"></path>',
            minimapCollapsed: true,
            svg: '<marker id="p-arrowhead-normal"></marker>',
        });
        expect(contentHtml).toContain('id="p-arrowhead-collapsed-normal"');
        expect(contentHtml).toContain('url(#p-arrowhead-collapsed-normal)');
    });

    it('matches the contentInner buildViewerBody embeds for two views', () => {
        const params = {
            collapsedMinimapCollapsed: true,
            collapsedSvg: '<svg>collapsed</svg>',
            minimapCollapsed: false,
            panel: false,
            svg: '<svg>expanded</svg>',
        };
        const body = buildViewerBody(params);
        const contentHtml = buildViewerContent(params);
        expect(body).toContain(`data-sfn="content">${contentHtml}</div>`);
    });
});

describe('minimapStartsCollapsed', () => {
    it('starts collapsed at the threshold', () => {
        expect(minimapStartsCollapsed({ nodeCount: 25 })).toBe(true);
    });

    it('starts collapsed below the threshold', () => {
        expect(minimapStartsCollapsed({ nodeCount: 1 })).toBe(true);
    });

    it('starts open above the threshold', () => {
        expect(minimapStartsCollapsed({ nodeCount: 26 })).toBe(false);
    });

    it('starts collapsed when nodeCount is undefined', () => {
        expect(minimapStartsCollapsed({})).toBe(true);
    });
});

describe('VIEWER_STRINGS', () => {
    it('supplies every word of the full-featured toolbar markup', () => {
        const body = buildViewerBody({
            copyMermaid: true,
            exportPng: true,
            exportSvg: true,
            minimapCollapsed: false,
            panel: true,
            playback: true,
            relayout: true,
            svg: '<svg></svg>',
        });
        const { documentTitle, lang, ...shellStrings } = VIEWER_STRINGS;
        expect(documentTitle).toBe('sfn-diagram');
        expect(lang).toBe('en');
        for (const [key, value] of Object.entries(shellStrings)) {
            const asAttribute = ['title', 'aria-label', 'placeholder'].some((attribute) =>
                body.includes(`${attribute}="${value}"`),
            );
            expect(asAttribute || body.includes(`>${value}</button>`), key).toBe(true);
        }
    });

    it('sets the document language', () => {
        expect(wrapSvgInInteractiveHtml({ svg: '<svg></svg>' })).toContain('<html lang="en">');
    });
});
