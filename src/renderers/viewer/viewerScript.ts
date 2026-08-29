import { VIEWER_CONTROLLER_BUNDLE } from './viewerScript.generated';

/** Parameters for {@link buildViewerScript}. */
export interface BuildViewerScriptParams {
    /** Whether the detail panel is wired up (only when state data was embedded). */
    hasStateData: boolean;
}

/**
 * Build the viewer's inline controller script for the self-contained HTML document.
 *
 * Inlines the compiled {@link VIEWER_CONTROLLER_BUNDLE} (generated from
 * `viewerController.ts` by `scripts/build-viewer-script.mjs`, the same logic the
 * `sfn-diagram/element` custom element runs) and calls `attachViewer({ root: document })`,
 * parsing the embedded state-data blob first when `hasStateData` is set. No external
 * references, so the document stays self-contained and works from `file://`.
 *
 * @param params - Script parameters
 * @param params.hasStateData - Whether to wire up the detail panel
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = buildViewerScript({ hasStateData: true });
 * const body = `<script>${script}</script>`;
 * ```
 */
export function buildViewerScript(params: BuildViewerScriptParams): string {
    const { hasStateData } = params;

    const stateDataRead = hasStateData
        ? `
  var stateData = {};
  try {
    stateData = JSON.parse(document.getElementById('sfn-state-data').textContent) || {};
  } catch (err) {
    stateData = {};
  }
`
        : '';

    return `
(function () {
${VIEWER_CONTROLLER_BUNDLE}
${stateDataRead}
  attachViewer({ root: document${hasStateData ? ', stateData: stateData' : ''} });
})();
`;
}
