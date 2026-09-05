import type { ThemeOption } from '../../types';

/** Viewer chrome theme. Matches the diagram themes so the shell doesn't clash with the SVG. */
export type ViewerTheme = 'dark' | 'light';

/** Parameters for {@link resolveViewerTheme}. */
export interface ResolveViewerThemeParams {
    /** The diagram theme the SVG was rendered with. */
    theme?: ThemeOption;
}

/** Relative luminance below which a background counts as dark. */
const DARK_BACKGROUND_LUMINANCE = 0.5;

/**
 * Parse a `#rgb` or `#rrggbb` colour into its perceived luminance (0-1).
 * Returns `null` for anything else (named colours, `rgb()`, gradients).
 */
function hexLuminance(color: string): number | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!match) {
        return null;
    }

    const hex = match[1];
    const expanded =
        hex.length === 3
            ? hex
                  .split('')
                  .map((character) => character + character)
                  .join('')
            : hex;

    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);

    // Rec. 601 luma - good enough to decide light vs dark chrome.
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

/**
 * Decide which viewer chrome to use for a given diagram theme.
 *
 * Built-in themes map directly. A {@link CustomTheme} is classified by its
 * background luminance, so a custom dark palette gets dark chrome rather than
 * silently falling back to light.
 *
 * @param params - Resolution parameters
 * @param params.theme - The diagram theme the SVG was rendered with
 * @returns `'dark'` or `'light'`
 *
 * @example
 * ```typescript
 * resolveViewerTheme({ theme: 'dark' });                        // => 'dark'
 * resolveViewerTheme({ theme: { background: '#101820', ... } }); // => 'dark'
 * ```
 */
export function resolveViewerTheme(params: ResolveViewerThemeParams): ViewerTheme {
    const { theme } = params;

    if (theme === 'dark') {
        return 'dark';
    }
    if (theme === undefined || theme === 'light') {
        return 'light';
    }

    const luminance = hexLuminance(theme.background);
    return luminance !== null && luminance < DARK_BACKGROUND_LUMINANCE ? 'dark' : 'light';
}

/** Parameters for {@link buildViewerStyles}. */
export interface BuildViewerStylesParams {
    /**
     * `'document'` (default) includes the `html, body { height: 100% }` reset the
     * standalone HTML viewer needs to fill the page. `'element'` omits it - a
     * `<sfn-diagram interactive>` embedded in a larger page must not reach past
     * itself and resize the host document's `<body>`.
     */
    scope?: 'document' | 'element';
    /** Chrome theme. Defaults to `'light'`. */
    theme?: ViewerTheme;
}

interface ChromePalette {
    accent: string;
    border: string;
    mutedText: string;
    panelBackground: string;
    stageBackground: string;
    surface: string;
    surfaceHover: string;
    text: string;
}

const LIGHT_PALETTE: ChromePalette = {
    accent: '#0972d3',
    border: '#dddddd',
    mutedText: '#555555',
    panelBackground: '#ffffff',
    stageBackground: '#fafafa',
    surface: '#f2f2f2',
    surfaceHover: '#e6e6e6',
    text: '#16191f',
};

const DARK_PALETTE: ChromePalette = {
    accent: '#539fe5',
    border: '#3b4149',
    mutedText: '#a8adb4',
    panelBackground: '#1f2329',
    stageBackground: '#16191f',
    surface: '#2a2f36',
    surfaceHover: '#363c44',
    text: '#eaeded',
};

/**
 * Build the viewer's inline stylesheet.
 *
 * The chrome (stage background, toolbar, detail panel) is themed alongside the
 * diagram, so a dark-theme SVG no longer sits inside a light shell.
 *
 * @param params - Style parameters
 * @param params.theme - Chrome theme, `'light'` (default) or `'dark'`
 * @returns CSS text for inlining into a `<style>` element
 *
 * @example
 * ```typescript
 * const css = buildViewerStyles({ theme: 'dark' });
 * const head = `<style>${css}</style>`;
 * ```
 */
export function buildViewerStyles(params: BuildViewerStylesParams = {}): string {
    const { scope = 'document', theme = 'light' } = params;
    const palette = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;

    const documentReset =
        scope === 'document'
            ? `html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; color: ${palette.text}; }\n`
            : '';

    // Selectors key off [data-sfn="..."] rather than #sfn-... ids: markup may carry
    // matching ids too (the standalone viewer document does, for back-compat), but
    // attribute selectors are what let more than one viewer share a page without
    // id collisions - see viewerController.ts.
    return `
  ${documentReset}[data-sfn-viewer] { position: relative; display: block; overflow: hidden; font-family: system-ui, sans-serif; color: ${palette.text}; }
  [data-sfn="stage"] { position: absolute; inset: 0; overflow: hidden; background: ${palette.stageBackground}; cursor: grab; }
  /* The panel precedes the stage in the markup, so it can shrink it rather than
     cover the diagram. Fit/centre maths reads clientWidth, so this stays correct. */
  [data-sfn="panel"].sfn-open ~ [data-sfn="stage"] { right: 360px; }
  [data-sfn="stage"].sfn-dragging { cursor: grabbing; }
  [data-sfn="content"] { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  [data-sfn="toolbar"] { position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 4px; align-items: center;
    background: ${palette.panelBackground}; border: 1px solid ${palette.border}; border-radius: 8px; padding: 4px 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  [data-sfn="toolbar"] button { border: 0; background: ${palette.surface}; color: ${palette.text}; border-radius: 4px;
    padding: 4px 8px; cursor: pointer; font-size: 14px; }
  [data-sfn="toolbar"] button:hover { background: ${palette.surfaceHover}; }
  [data-sfn="zoom-label"] { min-width: 44px; text-align: center; font-size: 12px; color: ${palette.mutedText}; }
  [data-sfn="search"] { width: 160px; border: 1px solid ${palette.border}; background: ${palette.panelBackground};
    color: ${palette.text}; border-radius: 4px; padding: 4px 8px; font-size: 13px; font-family: inherit; }
  [data-sfn="search"]:focus { outline: 2px solid ${palette.accent}; outline-offset: -1px; }
  [data-sfn="search-count"] { min-width: 52px; text-align: center; font-size: 12px; color: ${palette.mutedText}; }
  .sfn-divider { width: 1px; align-self: stretch; background: ${palette.border}; margin: 0 4px; }
  [data-state-id] { cursor: pointer; }
  [data-edge-id] { cursor: pointer; }
  .sfn-dim { opacity: .15; pointer-events: none; }
  .sfn-hit > :first-child { outline: 3px solid ${palette.accent}; }
  /* CSS properties beat SVG presentation attributes, so these win over the stroke and
     width the renderer wrote inline without needing !important. The hit-area copy is
     excluded so the highlight lands on the drawn stroke rather than a 12px slab. */
  .sfn-edge-selected:not([data-edge-hit-area]) { stroke: ${palette.accent}; stroke-width: 3; }
  .sfn-edge-endpoint > :first-child { outline: 2px dashed ${palette.accent}; }
  [data-sfn="panel"] { position: absolute; top: 0; right: 0; bottom: 0; width: 360px; z-index: 3; display: none;
    flex-direction: column; background: ${palette.panelBackground}; border-left: 1px solid ${palette.border};
    box-shadow: -2px 0 8px rgba(0,0,0,.12); }
  [data-sfn="panel"].sfn-open { display: flex; }
  [data-sfn="panel-head"] { display: flex; align-items: center; gap: 8px; padding: 12px 14px;
    border-bottom: 1px solid ${palette.border}; }
  [data-sfn="panel-title"] { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; flex: 1; }
  [data-sfn="panel-close"] { margin-left: auto; border: 0; background: ${palette.surface}; color: ${palette.text};
    border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 16px; line-height: 1.4; }
  [data-sfn="panel-body"] { overflow: auto; padding: 12px 14px; }
  .sfn-field { display: flex; gap: 8px; font-size: 12px; margin-bottom: 6px; }
  .sfn-field dt { color: ${palette.mutedText}; min-width: 76px; flex-shrink: 0; }
  .sfn-field dd { margin: 0; overflow-wrap: anywhere; }
  .sfn-panel-json { margin: 12px 0 0; padding: 10px; background: ${palette.surface}; border-radius: 6px;
    font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  [data-sfn="minimap"] { position: absolute; bottom: 12px; right: 12px; z-index: 2; width: 180px; height: 130px;
    background: ${palette.panelBackground}; border: 1px solid ${palette.border}; border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,.12); overflow: hidden; }
  [data-sfn="minimap"].sfn-minimap-collapsed { display: none; }
  [data-sfn="minimap-thumb"] { position: absolute; inset: 0; cursor: pointer; }
  [data-sfn="minimap-thumb"] svg { display: block; }
  [data-sfn="minimap-viewport"] { position: absolute; border: 2px solid ${palette.accent}; pointer-events: none; }
`;
}
