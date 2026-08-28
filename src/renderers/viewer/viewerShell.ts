import type { AslState } from '../../types';
import { serializeStateData } from './stateData';
import { buildViewerScript } from './viewerScript';
import { buildViewerStyles, type ViewerTheme } from './viewerStyles';

/** Node count at or below which the minimap starts collapsed. */
const MINIMAP_AUTO_VISIBLE_THRESHOLD = 25;

/** Parameters for {@link wrapSvgInInteractiveHtml}. */
export interface WrapSvgInInteractiveHtmlParams {
    /**
     * Node count from the rendered diagram's metadata. Decides the minimap's initial
     * visibility: collapsed at or below {@link MINIMAP_AUTO_VISIBLE_THRESHOLD} nodes,
     * open above it (still toggleable either way via the toolbar button or `m`).
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
    const { nodeCount, stateData, svg, theme = 'light' } = params;
    const hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
    const minimapCollapsed = nodeCount === undefined || nodeCount <= MINIMAP_AUTO_VISIBLE_THRESHOLD;

    const stateDataScript = hasStateData
        ? `<script type="application/json" id="sfn-state-data">${serializeStateData({ stateData })}</script>\n`
        : '';

    const panelMarkup = hasStateData
        ? `<aside id="sfn-panel">
  <div id="sfn-panel-head">
    <span id="sfn-panel-title"></span>
    <button id="sfn-panel-close" title="Close (Esc)" aria-label="Close details">&times;</button>
  </div>
  <div id="sfn-panel-body"></div>
</aside>\n`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sfn-diagram</title>
<style>${buildViewerStyles({ theme })}</style>
</head>
<body>
<div id="sfn-toolbar">
  <button data-sfn-zoom="out" title="Zoom out">-</button>
  <span id="sfn-zoom-label">100%</span>
  <button data-sfn-zoom="in" title="Zoom in">+</button>
  <button data-sfn-zoom="fit" title="Zoom to fit">Fit</button>
  <button data-sfn-zoom="reset" title="Reset">Reset</button>
  <span class="sfn-divider"></span>
  <input id="sfn-search" type="search" placeholder="Search states (/)" aria-label="Search states">
  <span id="sfn-search-count"></span>
  <span class="sfn-divider"></span>
  <button data-sfn-minimap-toggle title="Toggle minimap (m)">Map</button>
</div>
${panelMarkup}<div id="sfn-stage"><div id="sfn-content">${svg}</div><div id="sfn-minimap"${minimapCollapsed ? ' class="sfn-minimap-collapsed"' : ''}><div id="sfn-minimap-thumb"></div><div id="sfn-minimap-viewport"></div></div></div>
${stateDataScript}<script>${buildViewerScript({ hasStateData })}</script>
</body>
</html>`;
}
