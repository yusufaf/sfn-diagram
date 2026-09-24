import type { AslState, ExecutionTimeline } from '../../types';
import { serializeEdgeData, type ViewerEdge } from './edgeData';
import { serializeStateData } from './stateData';
import { minimapStartsCollapsed } from './minimapThreshold';
import { serializeForScriptBlock } from './scriptJson';
import { buildViewerScript } from './viewerScript';
import { buildViewerStyles, type ViewerTheme } from './viewerStyles';
import type { RelayoutModel } from './relayout';

export { minimapStartsCollapsed };
export type { MinimapStartsCollapsedParams } from './minimapThreshold';

/** Parameters for {@link buildViewerBody}. */
export interface BuildViewerBodyParams {
    /**
     * Whether the minimap should start hidden when the collapsed view (below) is the
     * active one. Only meaningful alongside `collapsedSvg`; defaults to `minimapCollapsed`
     * when omitted. The collapse toggle (in `controller/collapse.ts`) re-reads this on every
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
    /**
     * Whether to render the execution playback bar. Only meaningful when a timeline
     * was embedded for {@link attachViewer} to replay; without one the controls would
     * have nothing to drive.
     */
    playback?: boolean;
    /**
     * Whether the document ships the in-browser relayout (see
     * {@link WrapSvgInInteractiveHtmlParams.relayoutModel}): the toolbar then gets the
     * collapse toggle even though there is only one view to show.
     */
    relayout?: boolean;
    /** The rendered SVG (or other) markup to embed as the stage content. */
    svg: string;
}

/** Characters a content-security-policy nonce may contain (base64 alphabet, plus `-`/`_`). */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

/**
 * Build the ` nonce="…"` attribute fragment for a `<style>`/`<script>` tag, or `''`
 * when no nonce was supplied - the exact same document as before nonce support
 * existed. Validates against {@link NONCE_PATTERN} first, so a value that could break
 * out of the attribute (e.g. containing `"` or `>`) throws instead of being embedded.
 */
function nonceAttribute(nonce?: string): string {
    if (nonce === undefined) return '';
    if (!NONCE_PATTERN.test(nonce)) {
        throw new Error('nonce must contain only letters, digits, "+", "/", "=", "-", or "_"');
    }
    return ` nonce="${nonce}"`;
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

/** Parameters for {@link buildViewerContent}. */
export interface BuildViewerContentParams {
    /**
     * Whether the minimap should start hidden when the collapsed view (below) is the
     * active one. Only meaningful alongside `collapsedSvg`; defaults to `minimapCollapsed`
     * when omitted.
     */
    collapsedMinimapCollapsed?: boolean;
    /**
     * A second, fully-collapsed rendering of the same diagram. When provided, both
     * `svg` and this are embedded (as two `data-sfn-view` wrapper divs, `svg` shown
     * first). Omit for a single view (unchanged behavior).
     */
    collapsedSvg?: string;
    /** Whether to start the minimap collapsed. */
    minimapCollapsed: boolean;
    /** The rendered SVG (or other) markup to embed as the stage content. */
    svg: string;
}

/**
 * Build the markup that fills the `data-sfn="content"` node: the diagram itself, or -
 * when a collapsed rendering is supplied - both views wrapped in `data-sfn-view`
 * siblings the collapse toggle (`controller/collapse.ts`) flips
 * between.
 *
 * Extracted so a running viewer can re-render just this fragment and hand it to
 * {@link ViewerHandle.setContent}, without rebuilding the surrounding toolbar/panel/
 * stage chrome {@link buildViewerBody} also produces.
 *
 * @param params - Content parameters
 * @returns HTML fragment to place inside `data-sfn="content"`
 *
 * @example
 * ```typescript
 * const contentHtml = buildViewerContent({ minimapCollapsed: true, svg });
 * ```
 */
export function buildViewerContent(params: BuildViewerContentParams): string {
    const { collapsedMinimapCollapsed = params.minimapCollapsed, collapsedSvg, minimapCollapsed, svg } = params;
    const hasCollapse = collapsedSvg !== undefined;

    // Two sibling wrapper divs when a collapsed rendering was supplied - the toggle
    // (controller/collapse.ts) flips `hidden` between them. Otherwise
    // the content node holds the SVG directly, exactly as before. The collapsed view's
    // marker ids are namespaced so the two copies don't collide - see namespaceMarkerIds.
    return hasCollapse
        ? `<div data-sfn-view="expanded" data-sfn-minimap-auto="${minimapCollapsed ? '1' : '0'}">${svg}</div><div data-sfn-view="collapsed" data-sfn-minimap-auto="${collapsedMinimapCollapsed ? '1' : '0'}" hidden>${namespaceMarkerIds(collapsedSvg!, 'collapsed')}</div>`
        : svg;
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
        playback = false,
        relayout = false,
        svg,
    } = params;
    const id = (name: string): string => (legacyIds ? ` id="sfn-${name}"` : '');
    const hasCollapse = collapsedSvg !== undefined || relayout;

    const panelMarkup = panel
        ? `<aside${id('panel')} data-sfn="panel" role="dialog" tabindex="-1">
  <div${id('panel-head')} data-sfn="panel-head">
    <span${id('panel-title')} data-sfn="panel-title"></span>
    <button${id('panel-close')} data-sfn="panel-close" title="Close (Esc)" aria-label="Close details">&times;</button>
  </div>
  <div${id('panel-body')} data-sfn="panel-body"></div>
</aside>\n`
        : '';

    const contentInner = buildViewerContent({ collapsedMinimapCollapsed, collapsedSvg, minimapCollapsed, svg });

    const collapseToggleMarkup = hasCollapse
        ? '<span class="sfn-divider"></span><button data-sfn="collapse-toggle" data-sfn-collapse-toggle title="Toggle collapsed containers" aria-expanded="true">Collapse</button>'
        : '';

    // Its own bar rather than more buttons on the toolbar: playback needs a full-width
    // scrubber and a clock, and it is only ever present for a document built from an
    // execution history.
    const playbackMarkup = playback
        ? `<div${id('playback')} data-sfn="playback">
  <button data-sfn="playback-play" data-sfn-playback="toggle" title="Play / pause (Space)" aria-label="Play">&#9654;</button>
  <button data-sfn="playback-prev" data-sfn-playback="prev" title="Previous step (Left arrow)" aria-label="Previous step">&#9198;</button>
  <button data-sfn="playback-next" data-sfn-playback="next" title="Next step (Right arrow)" aria-label="Next step">&#9197;</button>
  <input${id('playback-scrub')} data-sfn="playback-scrub" type="range" min="0" max="1000" value="0" aria-label="Playback position">
  <span${id('playback-time')} data-sfn="playback-time" role="status" aria-live="off"></span>
  <span class="sfn-divider"></span>
  <button data-sfn-speed="1" title="Normal speed" aria-pressed="true">1x</button>
  <button data-sfn-speed="4" title="4x speed" aria-pressed="false">4x</button>
  <button data-sfn-speed="16" title="16x speed" aria-pressed="false">16x</button>
  <button data-sfn-speed="Infinity" title="Jump to the end" aria-pressed="false">Instant</button>
  <button data-sfn-playback="proportional" title="Play in real-time proportions instead of compressed" aria-pressed="false">Real</button>
  <span${id('playback-entry')} data-sfn="playback-entry" role="status" aria-live="polite"></span>
</div>\n`
        : '';

    return `<div${id('toolbar')} data-sfn="toolbar">
  <button data-sfn="zoom-out" data-sfn-zoom="out" title="Zoom out" aria-label="Zoom out">-</button>
  <span${id('zoom-label')} data-sfn="zoom-label" role="status" aria-live="polite">100%</span>
  <button data-sfn="zoom-in" data-sfn-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
  <button data-sfn="zoom-fit" data-sfn-zoom="fit" title="Zoom to fit">Fit</button>
  <button data-sfn="zoom-reset" data-sfn-zoom="reset" title="Reset">Reset</button>
  <span class="sfn-divider"></span>
  <input${id('search')} data-sfn="search" type="search" placeholder="Search states (/)" aria-label="Search states">
  <span${id('search-count')} data-sfn="search-count" role="status" aria-live="polite"></span>
  <span class="sfn-divider"></span>
  <button data-sfn="minimap-toggle" data-sfn-minimap-toggle title="Toggle minimap (m)" aria-pressed="${minimapCollapsed ? 'false' : 'true'}">Map</button>${collapseToggleMarkup}
</div>
${playbackMarkup}${panelMarkup}<div${id('stage')} data-sfn="stage"><div${id('content')} data-sfn="content">${contentInner}</div><div${id('minimap')}${minimapCollapsed ? ' class="sfn-minimap-collapsed"' : ''} data-sfn="minimap" aria-hidden="true"><div${id('minimap-thumb')} data-sfn="minimap-thumb"></div><div${id('minimap-viewport')} data-sfn="minimap-viewport"></div></div></div>`;
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
     * Viewer-facing detail for each edge, keyed by edge id (as produced by
     * `collectEdgeData`). Enables the click-an-edge detail panel; omit it to leave
     * edges inert. Requires the embedded SVG to have been rendered with
     * `edgeHitAreas`, or only the drawn stroke itself is clickable.
     */
    edgeData?: Record<string, ViewerEdge>;
    /**
     * Node count from the rendered diagram's metadata. Decides the minimap's initial
     * visibility: collapsed at or below `MINIMAP_AUTO_VISIBLE_THRESHOLD` nodes,
     * open above it (still toggleable either way via the toolbar button or `m`). The
     * collapse toggle re-applies this rule (against `collapsedNodeCount` instead) on
     * every switch, unless the minimap has since been toggled by hand.
     * Omit it (or when unknown) to start collapsed.
     */
    nodeCount?: number;
    /**
     * Content-Security-Policy nonce to stamp on the document's `<style>` tag and every
     * `<script>` tag, so the document runs under a host with a strict
     * `script-src 'nonce-…'` policy (e.g. a VS Code webview). Must match
     * `/^[A-Za-z0-9+/=_-]+$/`; omit for a document with no nonce attributes at all
     * (the default, byte-identical to output produced before nonce support existed).
     */
    nonce?: string;
    /**
     * The parsed graph and render options for in-browser per-container collapse. When
     * provided, the document embeds it as JSON together with the relayout bundle, the
     * toolbar gets the collapse toggle, and `svg` should have been rendered with
     * `collapseControls` so each container carries its control. Mutually exclusive
     * with `collapsedSvg` in practice: a document that can re-render itself has no
     * use for a second pre-rendered view.
     */
    relayoutModel?: RelayoutModel;
    /**
     * Raw ASL for each state, keyed by graph node id (as produced by
     * `collectStateData`), which matches the `data-state-id` on the rendered node.
     * Enables the click-a-state detail panel; omit it to render the viewer without one.
     */
    stateData?: Record<string, AslState>;
    /**
     * The rendered SVG markup to embed. Dimensions are read from the SVG's own
     * width/height attributes at runtime, so they need not be passed separately.
     */
    svg: string;
    /**
     * The execution timeline to replay, from an execution overlay's
     * `metadata.timeline`. When provided, the document embeds it as JSON and gains the
     * playback bar; omit it for a document with no playback controls at all.
     */
    timeline?: ExecutionTimeline;
    /** Viewer chrome theme. Defaults to `'light'`. */
    theme?: ViewerTheme;
}

/**
 * Wrap rendered SVG in a self-contained HTML document with an inline viewer:
 * pan/zoom (drag to pan, wheel to zoom, fit/reset toolbar), state search, and — when
 * `stateData` or `edgeData` is supplied — a detail panel showing a clicked state's raw
 * ASL, or a clicked edge's id, endpoints, type, and Choice condition.
 *
 * No external references, so it works offline and from `file://`. Note that the
 * embedded SVG itself may reference CDN-hosted icons when generated with
 * `showIcons`; run it through `embedIcons` first (or use `generateHtmlAsync`)
 * to keep the document fully offline.
 *
 * @param params - Wrapping parameters
 * @param params.edgeData - Detail per edge id; enables the click-an-edge panel
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
    const {
        collapsedNodeCount,
        collapsedSvg,
        edgeData,
        nodeCount,
        nonce,
        relayoutModel,
        stateData,
        svg,
        theme = 'light',
        timeline,
    } = params;
    const hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
    const hasEdgeData = edgeData !== undefined && Object.keys(edgeData).length > 0;
    const hasRelayout = relayoutModel !== undefined;
    const minimapCollapsed = minimapStartsCollapsed({ nodeCount });
    const collapsedMinimapCollapsed =
        collapsedNodeCount === undefined
            ? minimapCollapsed
            : minimapStartsCollapsed({ nodeCount: collapsedNodeCount });
    const nonceAttr = nonceAttribute(nonce);

    const stateDataScript = hasStateData
        ? `<script${nonceAttr} type="application/json" id="sfn-state-data">${serializeStateData({ stateData })}</script>\n`
        : '';
    const edgeDataScript = hasEdgeData
        ? `<script${nonceAttr} type="application/json" id="sfn-edge-data">${serializeEdgeData({ edgeData })}</script>\n`
        : '';

    const relayoutModelScript = hasRelayout
        ? `<script${nonceAttr} type="application/json" id="sfn-relayout-model">${serializeForScriptBlock({ value: relayoutModel })}</script>\n`
        : '';

    const hasTimeline = timeline !== undefined && timeline.entries.length > 0;
    const timelineScript = hasTimeline
        ? `<script${nonceAttr} type="application/json" id="sfn-timeline-data">${serializeForScriptBlock({ value: timeline })}</script>\n`
        : '';

    const body = buildViewerBody({
        collapsedMinimapCollapsed,
        collapsedSvg,
        legacyIds: true,
        minimapCollapsed,
        panel: hasStateData || hasEdgeData,
        playback: hasTimeline,
        relayout: hasRelayout,
        svg,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sfn-diagram</title>
<style${nonceAttr}>${buildViewerStyles({ theme })}</style>
</head>
<body>
${body}
${stateDataScript}${edgeDataScript}${relayoutModelScript}${timelineScript}<script${nonceAttr}>${buildViewerScript({ hasEdgeData, hasRelayout, hasStateData, hasTimeline })}</script>
</body>
</html>`;
}
