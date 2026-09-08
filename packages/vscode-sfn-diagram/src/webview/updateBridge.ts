/**
 * Build the script that receives host `updateContent`/`renderError` messages and hands
 * them to the live viewer. Deliberately separate from `buildHostBridgeScript`, which
 * owns the single permitted `acquireVsCodeApi()` call - this script only listens.
 *
 * `updateContent` is re-dispatched as an `sfn-set-content` `CustomEvent` on `document`,
 * which the inlined viewer controller (`viewerScript.ts`, in `sfn-diagram`) listens for.
 * `renderError` toggles a `[data-host="status"]` element's text and visibility; a later
 * `updateContent` clears it, since a successful refresh means whatever was wrong got fixed.
 *
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = `<script nonce="${nonce}">${buildUpdateBridgeScript()}</script>`
 * ```
 */
export function buildUpdateBridgeScript(): string {
    return `
(function () {
  var statusElement = document.querySelector('[data-host="status"]');

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.command === 'updateContent') {
      if (statusElement) {
        statusElement.hidden = true;
        statusElement.textContent = '';
      }
      document.dispatchEvent(new CustomEvent('sfn-set-content', {
        detail: {
          contentHtml: message.contentHtml,
          edgeData: message.edgeData,
          stateData: message.stateData,
        },
      }));
    } else if (message.command === 'renderError') {
      if (statusElement) {
        statusElement.hidden = false;
        statusElement.textContent = message.message;
      }
    }
  });
})();
`
}
