import * as vscode from 'vscode'
import { generateExecution, generateSvg } from 'sfn-diagram'
import type { ExecutionOutput, LayoutDirection } from 'sfn-diagram'
import { toDiagramOptions } from './settings'
import type { ResolvedTheme, SfnDiagramSettings } from './settings'

type ExecutionMetadata = ExecutionOutput['metadata']

export interface CreateOrShowParams {
    aslContent: string
    colorScheme: ResolvedTheme
    preserveFocus?: boolean
    settings: SfnDiagramSettings
}

export interface ApplySettingsParams {
    colorScheme: ResolvedTheme
    settings: SfnDiagramSettings
}

export class DiagramPanel {
    static currentPanel: DiagramPanel | undefined

    private readonly _panel: vscode.WebviewPanel
    private _disposables: vscode.Disposable[] = []
    private _collapse: boolean | undefined
    private _layout: LayoutDirection
    private _showIcons: boolean
    private _theme: ResolvedTheme
    private _layoutOverridden = false
    private _themeOverridden = false
    private _lastContent = ''
    /** Raw execution-history JSON (kept as a string per the ExecutionHistoryInput type gotcha). */
    private _history: string | undefined

    static createOrShow(params: CreateOrShowParams) {
        const { aslContent, colorScheme, preserveFocus, settings } = params
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn! + 1
            : vscode.ViewColumn.Two

        if (DiagramPanel.currentPanel) {
            DiagramPanel.currentPanel._panel.reveal(column, preserveFocus)
            // Re-applies the freshly-read settings/colorScheme too (not just aslContent) -
            // the caller already paid for reading them, and re-running the preview command
            // on an already-open panel should reflect any settings.json edit made since the
            // separate onDidChangeConfiguration listener last synced it, same as if the
            // panel had been closed and reopened. applySettings respects layout/theme
            // toolbar overrides exactly as it does when called from that listener.
            DiagramPanel.currentPanel.applySettings({ colorScheme, settings })
            DiagramPanel.currentPanel.update(aslContent)
            return
        }

        const panel = vscode.window.createWebviewPanel(
            'sfnDiagramPreview',
            'Step Functions Preview',
            { preserveFocus, viewColumn: column },
            { enableScripts: true, retainContextWhenHidden: true }
        )

        DiagramPanel.currentPanel = new DiagramPanel(panel, aslContent, colorScheme, settings)
    }

    private constructor(panel: vscode.WebviewPanel, aslContent: string, colorScheme: ResolvedTheme, settings: SfnDiagramSettings) {
        this._panel = panel
        const diagramOptions = toDiagramOptions({ colorScheme, settings })
        this._collapse = diagramOptions.collapse
        this._layout = diagramOptions.layout
        this._showIcons = diagramOptions.showIcons
        this._theme = diagramOptions.theme
        this.update(aslContent)

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        this._panel.webview.onDidReceiveMessage(
            (message: { command: string; value: string }) => {
                if (message.command === 'setLayout') {
                    this._layout = message.value as LayoutDirection
                    this._layoutOverridden = true
                } else if (message.command === 'setTheme') {
                    this._theme = message.value as ResolvedTheme
                    this._themeOverridden = true
                } else if (message.command === 'clearExecution') {
                    this._history = undefined
                } else {
                    return
                }
                this.update(this._lastContent)
            },
            null,
            this._disposables
        )
    }

    /**
     * Applies a configuration or color-theme change to an already-open preview.
     *
     * A layout or theme picked from the toolbar for the current session is left
     * alone, so an unrelated settings change doesn't clobber it.
     *
     * @param params - Parameters object.
     * @param params.colorScheme - The current VS Code color scheme.
     * @param params.settings - The freshly-resolved extension settings.
     * @example
     * DiagramPanel.currentPanel?.applySettings({ colorScheme, settings })
     */
    applySettings(params: ApplySettingsParams): void {
        const { colorScheme, settings } = params
        const diagramOptions = toDiagramOptions({ colorScheme, settings })
        this._collapse = diagramOptions.collapse
        this._showIcons = diagramOptions.showIcons
        if (!this._layoutOverridden) {
            this._layout = diagramOptions.layout
        }
        if (!this._themeOverridden) {
            this._theme = diagramOptions.theme
        }
        this.update(this._lastContent)
    }

    /**
     * Overlay a real execution onto the current diagram. Pass the raw history
     * JSON as a string (per the ExecutionHistoryInput type gotcha), or `undefined`
     * to clear the overlay and return to the plain definition.
     */
    setHistory(history: string | undefined) {
        this._history = history
        this.update(this._lastContent)
    }

    /** Whether an execution overlay is currently active. */
    hasHistory(): boolean {
        return this._history !== undefined
    }

    /**
     * Re-render for a newly-activated editor. If the definition actually changed
     * (a different file), any overlay is dropped since it was tied to the prior
     * definition; simply re-focusing the same document keeps the overlay.
     */
    syncActiveEditor(aslContent: string) {
        if (aslContent !== this._lastContent) {
            this._history = undefined
        }
        this.update(aslContent)
    }

    update(aslContent: string) {
        this._lastContent = aslContent
        try {
            if (this._history !== undefined) {
                const { svg, metadata } = generateExecution({
                    aslDefinition: aslContent,
                    collapse: this._collapse,
                    history: this._history,
                    layout: this._layout,
                    showIcons: this._showIcons,
                    theme: this._theme,
                })
                this._panel.webview.html = this._getHtml(svg, metadata)
                return
            }
            const { svg } = generateSvg({
                aslDefinition: aslContent,
                collapse: this._collapse,
                layout: this._layout,
                showIcons: this._showIcons,
                theme: this._theme,
            })
            this._panel.webview.html = this._getHtml(svg)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this._panel.webview.html = this._getErrorHtml(message)
        }
    }

    private _selected(optionValue: string, currentValue: unknown): string {
        return optionValue === currentValue ? ' selected' : ''
    }

    private _getHtml(svg: string, metadata?: ExecutionMetadata): string {
        const nonce = getNonce()
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- img-src allows AWS service icons, rendered as <image> tags referencing the jsDelivr CDN when sfnDiagram.showIcons is on. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://cdn.jsdelivr.net; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Step Functions Preview</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; }
  .toolbar { align-items: center; background: var(--vscode-editorGroupHeader-tabsBackground); border-bottom: 1px solid var(--vscode-editorGroup-border); display: flex; flex-shrink: 0; flex-wrap: wrap; gap: 12px; padding: 6px 12px; }
  .toolbar label { align-items: center; display: flex; font-size: 12px; gap: 6px; }
  .toolbar select { background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); color: var(--vscode-dropdown-foreground); font-size: 12px; padding: 2px 4px; }
  .toolbar button { background: var(--vscode-button-secondaryBackground); border: none; color: var(--vscode-button-secondaryForeground); cursor: pointer; font-size: 12px; padding: 3px 8px; }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .legend { align-items: center; display: flex; flex-wrap: wrap; font-size: 12px; gap: 12px; margin-left: auto; }
  .legend .item { align-items: center; display: flex; gap: 5px; }
  .legend .swatch { border-radius: 3px; display: inline-block; height: 11px; width: 11px; }
  .diagram { align-items: flex-start; display: flex; flex: 1; justify-content: center; overflow: auto; padding: 20px; }
  .diagram svg { height: auto; max-width: 100%; }
</style>
</head>
<body>
<div class="toolbar">
  <label>Layout:
    <select id="layout" onchange="send('setLayout', this.value)">
      <option value="TB"${this._selected('TB', this._layout)}>Top → Bottom</option>
      <option value="LR"${this._selected('LR', this._layout)}>Left → Right</option>
      <option value="RL"${this._selected('RL', this._layout)}>Right → Left</option>
      <option value="BT"${this._selected('BT', this._layout)}>Bottom → Top</option>
    </select>
  </label>
  <label>Theme:
    <select id="theme" onchange="send('setTheme', this.value)">
      <option value="dark"${this._selected('dark', this._theme)}>Dark</option>
      <option value="light"${this._selected('light', this._theme)}>Light</option>
    </select>
  </label>
  ${metadata ? this._getLegendHtml(metadata) : ''}
</div>
<div class="diagram">${svg}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function send(command, value) { vscode.postMessage({ command, value }); }
</script>
</body>
</html>`
    }

    private _getLegendHtml(metadata: ExecutionMetadata): string {
        const item = (color: string, label: string, count: number): string =>
            `<span class="item"><span class="swatch" style="background:${color}"></span>${label} (${count})</span>`
        return `<div class="legend">
    ${item('#2e7d32', 'Succeeded', metadata.succeeded.length)}
    ${item('#c62828', 'Failed', metadata.failed.length)}
    ${item('#ef6c00', 'Caught', metadata.caught.length)}
    ${item('#9e9e9e', 'Not reached', metadata.notReached.length)}
    <button onclick="send('clearExecution', '')">Clear overlay</button>
  </div>`
    }

    private _getErrorHtml(message: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body { background: var(--vscode-editor-background); color: var(--vscode-errorForeground); font-family: monospace; padding: 20px; }
</style></head>
<body><strong>Error:</strong> ${escapeHtml(message)}</body>
</html>`
    }

    dispose() {
        DiagramPanel.currentPanel = undefined
        this._panel.dispose()
        this._disposables.forEach((disposable) => disposable.dispose())
        this._disposables = []
    }
}

function getNonce(): string {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
