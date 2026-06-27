import * as vscode from 'vscode'
import { generateSvg } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'

export class DiagramPanel {
    static currentPanel: DiagramPanel | undefined

    private readonly _panel: vscode.WebviewPanel
    private _disposables: vscode.Disposable[] = []
    private _layout: LayoutDirection = 'TB'
    private _theme: ThemeOption = 'dark'

    static createOrShow(extensionUri: vscode.Uri, aslContent: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn! + 1
            : vscode.ViewColumn.Two

        if (DiagramPanel.currentPanel) {
            DiagramPanel.currentPanel._panel.reveal(column)
            DiagramPanel.currentPanel.update(aslContent)
            return
        }

        const panel = vscode.window.createWebviewPanel(
            'sfnDiagramPreview',
            'Step Functions Preview',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        )

        DiagramPanel.currentPanel = new DiagramPanel(panel, aslContent)
    }

    private constructor(panel: vscode.WebviewPanel, aslContent: string) {
        this._panel = panel
        this.update(aslContent)

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        this._panel.webview.onDidReceiveMessage(
            (message: { command: string; value: string }) => {
                if (message.command === 'setLayout') {
                    this._layout = message.value as LayoutDirection
                } else if (message.command === 'setTheme') {
                    this._theme = message.value as ThemeOption
                }
            },
            null,
            this._disposables
        )
    }

    update(aslContent: string) {
        try {
            const { svg } = generateSvg({
                aslDefinition: aslContent,
                layout: this._layout,
                theme: this._theme,
            })
            this._panel.webview.html = this._getHtml(svg)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this._panel.webview.html = this._getErrorHtml(message)
        }
    }

    private _getHtml(svg: string): string {
        const nonce = getNonce()
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Step Functions Preview</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; }
  .toolbar { align-items: center; background: var(--vscode-editorGroupHeader-tabsBackground); border-bottom: 1px solid var(--vscode-editorGroup-border); display: flex; flex-shrink: 0; gap: 12px; padding: 6px 12px; }
  .toolbar label { align-items: center; display: flex; font-size: 12px; gap: 6px; }
  .toolbar select { background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); color: var(--vscode-dropdown-foreground); font-size: 12px; padding: 2px 4px; }
  .diagram { align-items: flex-start; display: flex; flex: 1; justify-content: center; overflow: auto; padding: 20px; }
  .diagram svg { height: auto; max-width: 100%; }
</style>
</head>
<body>
<div class="toolbar">
  <label>Layout:
    <select id="layout" onchange="send('setLayout', this.value)">
      <option value="TB" selected>Top → Bottom</option>
      <option value="LR">Left → Right</option>
      <option value="RL">Right → Left</option>
      <option value="BT">Bottom → Top</option>
    </select>
  </label>
  <label>Theme:
    <select id="theme" onchange="send('setTheme', this.value)">
      <option value="dark" selected>Dark</option>
      <option value="light">Light</option>
    </select>
  </label>
</div>
<div class="diagram">${svg}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function send(command, value) { vscode.postMessage({ command, value }); }
</script>
</body>
</html>`
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
