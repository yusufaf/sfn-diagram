import type { AslState } from '../../types';
import { serializeStateData } from './stateData';
import { buildViewerScript } from './viewerScript';
import { buildViewerStyles, type ViewerTheme } from './viewerStyles';

/** Node count at or below which the minimap starts collapsed. */
const MINIMAP_AUTO_VISIBLE_THRESHOLD = 25;

/** Parameters for {@link buildViewerBody}. */
export interface BuildViewerBodyParams {
    /**
     * Whether the minimap should start hidden when the collapsed view (below) is the
     * active one. Only meaningful alongside `collapsedSvg`; defaults to `minimapCollapsed`
     * when omitted. The collapse toggle (in `viewerController.ts`) re-reads this on every
     * switch, so the minimap's auto-visibility tracks whichever view is showing.
     */
    collapsedMinimapCollapsed?: boolean;
    /**
     * A second, fully-collapsed rendering of the same diagram. When provided, both
     * `svg` and this are embedded (as two `data-sfn-view` wrapper divs, `svg` shown
     * first) and the toolbar gains a toggle button that switches between them. Omit
     * for a single view with no toggle (unchanged behavior).
     */
    collapsedSvg?: string;
    /**
     * Emit the standalone HTML document's original `id="sfn-x"` attributes alongside
     * `data-sfn="x"`. The document keeps them for its own Puppeteer runtime suite and
     * for anyone who scripted against them; the custom element omits them, since more
     * than one instance sharing a page would otherwise collide on duplicate ids.
     */
    legacyIds?: boolean;
    /** Whether to start the minimap collapsed. */
    minimapCollapsed: boolean;
    /** Whether to render the click-a-state detail panel markup. */
    panel: boolean;
    /** The rendered SVG (or other) markup to embed as the stage content. */
    svg: string;
}

/**
 * `generateSvg()` emits fixed `id="arrowhead-{type}"` marker defs and matching
 * `url(#arrowhead-{type})` references - fine for one diagram, but the expanded and
 * collapsed views embed two renderings of the same diagram into one document, which
 * would otherwise duplicate every one of those ids. Beyond being invalid HTML,
 * `url(#...)` resolves the first matching id in the whole document rather than within
 * its own `<svg>`, so the second view would silently borrow the first's markers.
 * Prefixing one view's copies keeps them distinct without touching the shared
 * renderer, whose fixed ids are relied on elsewhere (e.g. single-diagram SVG export).
 *
 * `src/element/SfnDiagramElement.ts` solves the same collision per element instance;
 * that copy stays separate rather than shared, to avoid a `renderers` -> `element`
 * dependency in either direction.
 */
function namespaceMarkerIds(svg: string, prefix: string): string {
    // Anchored on `<marker id="` specifically, not a bare `id="` - a state literally
    // named e.g. "arrowhead-check" would otherwise also match inside its own
    // `data-state-id="arrowhead-check"` attribute and get silently corrupted.
    return svg.replace(/<marker id="arrowhead-|url\(#arrowhead-/g, (match) =>
        match.replace('arrowhead-', `arrowhead-${prefix}-`),
    );
}

/**
 * Build the viewer chrome markup - toolbar, optional detail panel, stage, and
 * minimap - around already-rendered diagram markup. Shared by
 * {@link wrapSvgInInteractiveHtml} (the standalone HTML document) and the
 * `sfn-diagram/element` custom element, so both stay wired to the same
 * `data-sfn="..."` hooks {@link attachViewer} expects.
 *
 * @param params - Body parameters
 * @returns HTML fragment: toolbar, optional panel, and stage - no `<html>`/`<body>`
 */
export function buildViewerBody(params: BuildViewerBodyParams): string {
    const {
        collapsedMinimapCollapsed = params.minimapCollapsed,
        collapsedSvg,
        legacyIds = false,
        minimapCollapsed,
        panel,
        svg,
    } = params;
    const id = (name: string): string => (legacyIds ? ` id="sfn-${name}"` : '');
    const hasCollapse = collapsedSvg !== undefined;

    const panelMarkup = panel
        ? `<aside${id('panel')} data-sfn="panel">
  <div${id('panel-head')} data-sfn="panel-head">
    <span${id('panel-title')} data-sfn="panel-title"></span>
    <button${id('panel-close')} data-sfn="panel-close" title="Close (Esc)" aria-label="Close details">&times;</button>
  </div>
  <div${id('panel-body')} data-sfn="panel-body"></div>
</aside>\n`
        : '';

    // Two sibling wrapper divs when a collapsed rendering was supplied - the toggle
    // (attachViewer, in viewerController.ts) flips `hidden` between them. Otherwise
    // the content node holds the SVG directly, exactly as before. The collapsed view's
    // marker ids are namespaced so the two copies don't collide - see namespaceMarkerIds.
    const contentInner = hasCollapse
        ? `<div data-sfn-view="expanded" data-sfn-minimap-auto="${minimapCollapsed ? '1' : '0'}">${svg}</div><div data-sfn-view="collapsed" data-sfn-minimap-auto="${collapsedMinimapCollapsed ? '1' : '0'}" hidden>${namespaceMarkerIds(collapsedSvg, 'collapsed')}</div>`
        : svg;

    const collapseToggleMarkup = hasCollapse
        ? '<span class="sfn-divider"></span><button data-sfn="collapse-toggle" data-sfn-collapse-toggle title="Toggle collapsed containers">Collapse</button>'
        : '';

    return `<div${id('toolbar')} data-sfn="toolbar">
  <button data-sfn="zoom-out" data-sfn-zoom="out" title="Zoom out">-</button>
  <span${id('zoom-label')} data-sfn="zoom-label">100%</span>
  <button data-sfn="zoom-in" data-sfn-zoom="in" title="Zoom in">+</button>
  <button data-sfn="zoom-fit" data-sfn-zoom="fit" title="Zoom to fit">Fit</button>
  <button data-sfn="zoom-reset" data-sfn-zoom="reset" title="Reset">Reset</button>
  <span class="sfn-divider"></span>
  <input${id('search')} data-sfn="search" type="search" placeholder="Search states (/)" aria-label="Search states">
  <span${id('search-count')} data-sfn="search-count"></span>
  <span class="sfn-divider"></span>
  <button data-sfn="minimap-toggle" data-sfn-minimap-toggle title="Toggle minimap (m)">Map</button>${collapseToggleMarkup}
</div>
${panelMarkup}<div${id('stage')} data-sfn="stage"><div${id('content')} data-sfn="content">${contentInner}</div><div${id('minimap')}${minimapCollapsed ? ' class="sfn-minimap-collapsed"' : ''} data-sfn="minimap"><div${id('minimap-thumb')} data-sfn="minimap-thumb"></div><div${id('minimap-viewport')} data-sfn="minimap-viewport"></div></div></div>`;
}

/** Parameters for {@link wrapSvgInInteractiveHtml}. */
export interface WrapSvgInInteractiveHtmlParams {
    /**
     * Node count of `collapsedSvg`'s rendering, from its own metadata. Decides the
     * minimap's auto-visibility while the collapsed view is active, same rule as
     * `nodeCount` below. Ignored without `collapsedSvg`; defaults to `nodeCount`'s
     * outcome when omitted.
     */
    collapsedNodeCount?: number;
    /**
     * A second, fully-collapsed rendering of the same diagram. When provided, both
     * `svg` and this are embedded (as two `data-sfn-view` wrapper divs, `svg` shown
     * first) and the toolbar gains a toggle button that switches between them. Omit
     * for a single view with no toggle (unchanged behavior).
     */
    collapsedSvg?: string;
    /**
     * Node count from the rendered diagram's metadata. Decides the minimap's initial
     * visibility: collapsed at or below {@link MINIMAP_AUTO_VISIBLE_THRESHOLD} nodes,
     * open above it (still toggleable either way via the toolbar button or `m`). The
     * collapse toggle re-applies this rule (against `collapsedNodeCount` instead) on
     * every switch, unless the minimap has since been toggled by hand.
     * Omit it (or when unknown) to start collapsed.
     */
    nodeCount?: number;
    /**
     * Raw ASL for each state, keyed by state name (as produced by `collectStateData`).
     * Enables the click-a-state detail panel; omit it to render the viewer without one.
     */
    stateData?: Record<string, AslState>;
    /**
     * The rendered SVG markup to embed. Dimensions are read from the SVG's own
     * width/height attributes at runtime, so they need not be passed separately.
     */
    svg: string;
    /** Viewer chrome theme. Defaults to `'light'`. */
    theme?: ViewerTheme;
}

/**
 * Wrap rendered SVG in a self-contained HTML document with an inline viewer:
 * pan/zoom (drag to pan, wheel to zoom, fit/reset toolbar), state search, and —
 * when `stateData` is supplied — a click-a-state detail panel showing raw ASL.
 *
 * No external references, so it works offline and from `file://`. Note that the
 * embedded SVG itself may reference CDN-hosted icons when generated with
 * `showIcons`; run it through `embedIcons` first (or use `generateHtmlAsync`)
 * to keep the document fully offline.
 *
 * @param params - Wrapping parameters
 * @param params.nodeCount - Diagram node count; decides the minimap's initial visibility
 * @param params.stateData - Raw ASL per state; enables the detail panel
 * @param params.svg - Rendered SVG markup to embed
 * @param params.theme - Viewer chrome theme, `'light'` (default) or `'dark'`
 * @returns Complete HTML document as a string
 *
 * @example
 * ```typescript
 * const { svg, metadata } = generateSvg({ aslDefinition: asl });
 * const html = wrapSvgInInteractiveHtml({
 *     nodeCount: metadata.nodeCount,
 *     stateData: collectStateData({ definition: asl }),
 *     svg,
 *     theme: 'dark',
 * });
 * ```
 */
export function wrapSvgInInteractiveHtml(params: WrapSvgInInteractiveHtmlParams): string {
    const { collapsedNodeCount, collapsedSvg, nodeCount, stateData, svg, theme = 'light' } = params;
    const hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
    const minimapCollapsed = nodeCount === undefined || nodeCount <= MINIMAP_AUTO_VISIBLE_THRESHOLD;
    const collapsedMinimapCollapsed =
        collapsedNodeCount === undefined
            ? minimapCollapsed
            : collapsedNodeCount <= MINIMAP_AUTO_VISIBLE_THRESHOLD;

    const stateDataScript = hasStateData
        ? `<script type="application/json" id="sfn-state-data">${serializeStateData({ stateData })}</script>\n`
        : '';

    const body = buildViewerBody({
        collapsedMinimapCollapsed,
        collapsedSvg,
        legacyIds: true,
        minimapCollapsed,
        panel: hasStateData,
        svg,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sfn-diagram</title>
<style>${buildViewerStyles({ theme })}</style>
</head>
<body>
${body}
${stateDataScript}<script>${buildViewerScript({ hasStateData })}</script>
</body>
</html>`;
}
