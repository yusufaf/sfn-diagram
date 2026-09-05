import { VIEWER_CONTROLLER_BUNDLE } from './viewerScript.generated';

/** Parameters for {@link buildViewerScript}. */
export interface BuildViewerScriptParams {
    /** Whether the click-an-edge panel is wired up (only when edge data was embedded). */
    hasEdgeData?: boolean;
    /** Whether the click-a-state panel is wired up (only when state data was embedded). */
    hasStateData: boolean;
}

/**
 * Build a snippet that parses one embedded JSON blob into `variableName`, falling back
 * to an empty object when the element is missing or its contents fail to parse.
 */
function readBlob(variableName: string, elementId: string): string {
    return `
  var ${variableName} = {};
  try {
    ${variableName} = JSON.parse(document.getElementById('${elementId}').textContent) || {};
  } catch (err) {
    ${variableName} = {};
  }
`;
}

/**
 * Build the viewer's inline controller script for the self-contained HTML document.
 *
 * Inlines the compiled {@link VIEWER_CONTROLLER_BUNDLE} (generated from
 * `viewerController.ts` by `scripts/build-viewer-script.mjs`, the same logic the
 * `sfn-diagram/element` custom element runs) and calls `attachViewer({ root: document })`,
 * parsing each embedded data blob first when its flag is set. No external references,
 * so the document stays self-contained and works from `file://`.
 *
 * @param params - Script parameters
 * @param params.hasEdgeData - Whether to wire up the click-an-edge panel
 * @param params.hasStateData - Whether to wire up the click-a-state panel
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = buildViewerScript({ hasEdgeData: true, hasStateData: true });
 * const body = `<script>${script}</script>`;
 * ```
 */
export function buildViewerScript(params: BuildViewerScriptParams): string {
    const { hasEdgeData = false, hasStateData } = params;

    const reads =
        (hasStateData ? readBlob('stateData', 'sfn-state-data') : '') +
        (hasEdgeData ? readBlob('edgeData', 'sfn-edge-data') : '');

    const attachArgs = ['root: document'];
    if (hasEdgeData) attachArgs.unshift('edgeData: edgeData');
    if (hasStateData) attachArgs.push('stateData: stateData');

    return `
(function () {
${VIEWER_CONTROLLER_BUNDLE}
${reads}
  attachViewer({ ${attachArgs.join(', ')} });
})();
`;
}
