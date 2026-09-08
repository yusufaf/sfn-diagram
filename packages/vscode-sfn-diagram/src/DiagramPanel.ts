import * as vscode from 'vscode'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { buildErrorDocument } from './webview/errorDocument'
import { createNonce } from './webview/nonce'
import { buildPreviewDocument } from './webview/previewDocument'
import { renderPreview } from './webview/render'

export class DiagramPanel {
    static currentPanel: DiagramPanel | undefined

    private readonly _panel: vscode.WebviewPanel
    private _disposables: vscode.Disposable[] = []
    private _layout: LayoutDirection = 'TB'
    private _theme: ThemeOption = 'dark'
    private _lastContent = ''
    /** Raw execution-history JSON (kept as a string per the ExecutionHistoryInput type gotcha). */
    private _history: string | undefined

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
        const nonce = createNonce()
        const cspSource = this._panel.webview.cspSource
        try {
            const rendered = renderPreview({
                aslContent,
                history: this._history,
                layout: this._layout,
                nonce,
                theme: this._theme,
            })
            this._panel.webview.html = buildPreviewDocument({
                cspSource,
                executionMetadata: rendered.executionMetadata,
                layout: this._layout,
                nonce,
                theme: this._theme,
                viewerHtml: rendered.html,
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this._panel.webview.html = buildErrorDocument({ cspSource, message, nonce })
        }
    }

    dispose() {
        DiagramPanel.currentPanel = undefined
        this._panel.dispose()
        this._disposables.forEach((disposable) => disposable.dispose())
        this._disposables = []
    }
}
