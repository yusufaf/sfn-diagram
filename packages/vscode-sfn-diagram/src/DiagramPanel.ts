import * as vscode from 'vscode'
import type { LayoutDirection } from 'sfn-diagram'
import { buildErrorDocument } from './webview/errorDocument'
import { createNonce } from './webview/nonce'
import { buildPreviewDocument } from './webview/previewDocument'
import { renderPreview } from './webview/render'
import { toDiagramOptions } from './settings'
import type { ResolvedTheme, SfnDiagramSettings } from './settings'

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
        const nonce = createNonce()
        const cspSource = this._panel.webview.cspSource
        try {
            const rendered = renderPreview({
                aslContent,
                collapse: this._collapse,
                history: this._history,
                layout: this._layout,
                nonce,
                showIcons: this._showIcons,
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
