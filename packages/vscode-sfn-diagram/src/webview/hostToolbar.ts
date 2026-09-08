import type { ExecutionOutput, LayoutDirection, ThemeOption } from 'sfn-diagram'

/** Execution overlay summary, as reported by `generateExecution`/`generateExecutionHtml`. */
export type ExecutionMetadata = ExecutionOutput['metadata']

/** Parameters for {@link buildHostToolbarHtml}. */
export interface BuildHostToolbarParams {
    /** Execution overlay summary. Present only while an overlay is active. */
    executionMetadata?: ExecutionMetadata
    /** Currently selected graph layout direction, preselected in the Layout dropdown. */
    layout: LayoutDirection
    /** Currently selected diagram theme, preselected in the Theme dropdown. */
    theme: ThemeOption
}

interface LayoutOption {
    label: string
    value: LayoutDirection
}

const LAYOUT_OPTIONS: LayoutOption[] = [
    { label: 'Top → Bottom', value: 'TB' },
    { label: 'Left → Right', value: 'LR' },
    { label: 'Right → Left', value: 'RL' },
    { label: 'Bottom → Top', value: 'BT' },
]

/** Render a `selected` attribute when `optionValue` matches `currentValue`. */
function selectedAttribute(optionValue: string, currentValue: unknown): string {
    return optionValue === currentValue ? ' selected' : ''
}

/** Render the execution-overlay legend and its Clear-overlay control. */
function buildLegendHtml(executionMetadata: ExecutionMetadata): string {
    const item = (color: string, label: string, count: number): string =>
        `<span class="sfn-host-legend-item"><span class="sfn-host-swatch" style="background:${color}"></span>${label} (${count})</span>`
    return `<span class="sfn-host-legend">
    ${item('#2e7d32', 'Succeeded', executionMetadata.succeeded.length)}
    ${item('#c62828', 'Failed', executionMetadata.failed.length)}
    ${item('#ef6c00', 'Caught', executionMetadata.caught.length)}
    ${item('#9e9e9e', 'Not reached', executionMetadata.notReached.length)}
    <button data-host="clear-execution" type="button">Clear overlay</button>
  </span>`
}

/**
 * Render the host toolbar's markup: a Layout dropdown, a Theme dropdown, a status
 * legend with a Clear-overlay button when an execution overlay is active, and a hidden
 * status chip (`buildUpdateBridgeScript` toggles it) that surfaces a debounced
 * keystroke's render error without replacing the last good diagram.
 *
 * Every control is a plain, un-styled-attribute element hooked with `data-host="…"`;
 * {@link buildHostBridgeScript} wires them up with `addEventListener` rather than
 * inline `on*=` attributes, which a nonce-only CSP does not allow.
 *
 * @param params - Toolbar parameters
 * @returns The toolbar's HTML markup, meant to be injected before `</body>`
 *
 * @example
 * ```typescript
 * const toolbar = buildHostToolbarHtml({ layout: 'TB', theme: 'dark' })
 * ```
 */
export function buildHostToolbarHtml(params: BuildHostToolbarParams): string {
    const { executionMetadata, layout, theme } = params
    const themeValue = theme === 'light' ? 'light' : 'dark'
    const layoutOptions = LAYOUT_OPTIONS.map(
        (option) =>
            `<option value="${option.value}"${selectedAttribute(option.value, layout)}>${option.label}</option>`,
    ).join('\n      ')

    return `<div class="sfn-host-toolbar" data-host="toolbar">
  <label class="sfn-host-field">Layout
    <select data-host="layout">
      ${layoutOptions}
    </select>
  </label>
  <label class="sfn-host-field">Theme
    <select data-host="theme">
      <option value="dark"${selectedAttribute('dark', themeValue)}>Dark</option>
      <option value="light"${selectedAttribute('light', themeValue)}>Light</option>
    </select>
  </label>
  ${executionMetadata ? buildLegendHtml(executionMetadata) : ''}
  <span class="sfn-host-status" data-host="status" hidden></span>
</div>`
}

/**
 * Build the host toolbar's stylesheet: a floating pill anchored to the bottom-left of
 * the viewer stage, styled from VS Code's own theme variables with plain-color
 * fallbacks. Bottom-left is the one corner the interactive viewer's own chrome never
 * occupies (its toolbar sits top-left, its minimap bottom-right, its detail panel
 * along the right edge), so the pill never collides with them.
 *
 * @returns CSS rules for the `.sfn-host-*` classes
 *
 * @example
 * ```typescript
 * const styles = buildHostToolbarStyles()
 * ```
 */
export function buildHostToolbarStyles(): string {
    return `
.sfn-host-toolbar {
  align-items: center;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: 6px;
  bottom: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  color: var(--vscode-editor-foreground, #cccccc);
  display: flex;
  flex-wrap: wrap;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: 12px;
  gap: 10px;
  left: 12px;
  padding: 6px 10px;
  position: absolute;
  z-index: 4;
}
.sfn-host-field { align-items: center; display: flex; gap: 6px; }
.sfn-host-field select {
  background: var(--vscode-dropdown-background, #3c3c3c);
  border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
  color: var(--vscode-dropdown-foreground, #cccccc);
  font-size: 12px;
  padding: 2px 4px;
}
.sfn-host-legend { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
.sfn-host-legend-item { align-items: center; display: flex; gap: 5px; }
.sfn-host-swatch { border-radius: 3px; display: inline-block; height: 10px; width: 10px; }
.sfn-host-legend button {
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  border: none;
  color: var(--vscode-button-secondaryForeground, #cccccc);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}
.sfn-host-legend button:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
.sfn-host-status {
  color: var(--vscode-inputValidation-warningForeground, #b89500);
}
`
}

/**
 * Build the host bridge script: acquires the webview API exactly once and wires the
 * host toolbar's controls to `postMessage` via `addEventListener`, rather than the
 * inline `on*=` attributes a nonce-only `script-src` does not allow.
 *
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = `<script nonce="${nonce}">${buildHostBridgeScript()}</script>`
 * ```
 */
export function buildHostBridgeScript(): string {
    return `
(function () {
  var vscode = acquireVsCodeApi();
  function send(command, value) { vscode.postMessage({ command: command, value: value }); }

  var layoutSelect = document.querySelector('[data-host="layout"]');
  if (layoutSelect) {
    layoutSelect.addEventListener('change', function (event) {
      send('setLayout', event.target.value);
    });
  }

  var themeSelect = document.querySelector('[data-host="theme"]');
  if (themeSelect) {
    themeSelect.addEventListener('change', function (event) {
      send('setTheme', event.target.value);
    });
  }

  var clearButton = document.querySelector('[data-host="clear-execution"]');
  if (clearButton) {
    clearButton.addEventListener('click', function () {
      send('clearExecution', '');
    });
  }
})();
`
}
