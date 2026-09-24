import { VIEWER_RELAYOUT_BUNDLE } from './viewerRelayout.generated';
import { VIEWER_CONTROLLER_BUNDLE } from './viewerScript.generated';

/** Parameters for {@link buildViewerScript}. */
export interface BuildViewerScriptParams {
    /** Whether the click-an-edge panel is wired up (only when edge data was embedded). */
    hasEdgeData?: boolean;
    /**
     * Whether per-container collapse is wired up (only when a relayout model was
     * embedded). Inlines the relayout bundle — the graph, layout and renderer code —
     * which the plain viewer never pays for.
     */
    hasRelayout?: boolean;
    /** Whether the click-a-state panel is wired up (only when state data was embedded). */
    hasStateData: boolean;
    /** Whether execution playback is wired up (only when a timeline was embedded). */
    hasTimeline?: boolean;
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
 * Also listens for a `sfn-set-content` `CustomEvent` on `document`, dispatching its
 * `detail` straight to the viewer's `setContent`. A host embedding this document (e.g.
 * a VS Code webview) can dispatch that event to patch the live diagram in place -
 * rebuilding just the diagram, not the whole page - without this script needing to
 * know anything about the host's own message transport.
 *
 * @param params - Script parameters
 * @param params.hasEdgeData - Whether to wire up the click-an-edge panel
 * @param params.hasRelayout - Whether to inline the relayout bundle and wire up per-container collapse
 * @param params.hasStateData - Whether to wire up the click-a-state panel
 * @param params.hasTimeline - Whether to wire up execution playback
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = buildViewerScript({ hasEdgeData: true, hasStateData: true });
 * const body = `<script>${script}</script>`;
 * ```
 */
export function buildViewerScript(params: BuildViewerScriptParams): string {
    const { hasEdgeData = false, hasRelayout = false, hasStateData, hasTimeline = false } = params;

    const reads =
        (hasStateData ? readBlob('stateData', 'sfn-state-data') : '') +
        (hasEdgeData ? readBlob('edgeData', 'sfn-edge-data') : '') +
        (hasRelayout ? readBlob('relayoutModel', 'sfn-relayout-model') : '') +
        (hasTimeline ? readBlob('timeline', 'sfn-timeline-data') : '');

    // Alphabetical, matching the AttachViewerParams field order.
    const attachArgs: string[] = [];
    if (hasEdgeData) attachArgs.push('edgeData: edgeData');
    if (hasRelayout) {
        attachArgs.push('relayout: { model: relayoutModel, render: sfnRelayout.renderCollapsedView }');
    }
    attachArgs.push('root: document');
    if (hasStateData) attachArgs.push('stateData: stateData');
    if (hasTimeline) attachArgs.push('timeline: timeline');

    return `
(function () {
${VIEWER_CONTROLLER_BUNDLE}
${hasRelayout ? VIEWER_RELAYOUT_BUNDLE : ''}
${reads}
  var handle = attachViewer({ ${attachArgs.join(', ')} });
  document.addEventListener('sfn-set-content', function (event) {
    handle.setContent(event.detail);
  });
})();
`;
}
