import * as vscode from 'vscode'
import type { LayoutDirection } from 'sfn-diagram'
import { createDebouncer, type Debouncer } from './debounce'
import { buildErrorDocument } from './webview/errorDocument'
import { buildRenderErrorMessage, buildUpdateContentMessage } from './webview/messages'
import { createNonce } from './webview/nonce'
import { buildPreviewDocument } from './webview/previewDocument'
import { renderPreview, renderPreviewUpdate } from './webview/render'
import { toDiagramOptions } from './settings'
import type { ResolvedTheme, SfnDiagramSettings } from './settings'

/** Milliseconds to wait after the last keystroke before refreshing the preview. */
const REFRESH_DEBOUNCE_MS = 200

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
    /** Whether the last successfully rendered document embeds a collapse toggle. */
    private _hasCollapsedView = false
    /** Whether the webview is currently showing the error document, not a diagram. */
    private _showingError = false
    private readonly _refreshDebouncer: Debouncer<string>
    /** A debounced refresh's content, held back while the panel is hidden. */
    private _pendingContent: string | undefined
    /**
     * The most recently `scheduleRefresh`d content, while its debounce is still
     * pending. `_lastContent` only advances once that debounce actually fires (or a
     * full `update()` runs), so anything reading "the current truth" between a
     * keystroke and its debounced refresh - the toolbar message handler below,
     * `setHistory` - must prefer this over `_lastContent` or it renders stale,
     * pre-keystroke content and (via `update`'s `cancel()`) drops the pending edit
     * entirely rather than just deferring it.
     */
    private _scheduledContent: string | undefined

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
        this._refreshDebouncer = createDebouncer({
            delayMs: REFRESH_DEBOUNCE_MS,
            run: (content) => this._refresh(content),
        })
        const diagramOptions = toDiagramOptions({ colorScheme, settings })
        this._collapse = diagramOptions.collapse
        this._layout = diagramOptions.layout
        this._showIcons = diagramOptions.showIcons
        this._theme = diagramOptions.theme
        this.update(aslContent)

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible && this._pendingContent !== undefined) {
                    const content = this._pendingContent
                    this._pendingContent = undefined
                    this._performRefresh(content)
                }
            },
            null,
            this._disposables
        )

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
                this.update(this.currentContent())
            },
            null,
            this._disposables
        )
    }

    /** The freshest known content: a still-pending debounced edit, or the last rendered one. */
    private currentContent(): string {
        return this._scheduledContent ?? this._lastContent
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
        this.update(this.currentContent())
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
        this._refreshDebouncer.cancel()
        this._scheduledContent = undefined
        // A full render is always for `aslContent`, a specific document's content - any
        // patch still queued for a *different* one (set while the panel was hidden, see
        // `_refresh`) is now stale and would otherwise get applied to the wrong diagram
        // once the panel becomes visible again.
        this._pendingContent = undefined
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
            this._hasCollapsedView = rendered.hasCollapsedView
            this._showingError = false
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this._panel.webview.html = buildErrorDocument({ cspSource, message, nonce })
            this._showingError = true
        }
    }

    /**
     * Queue a keystroke-driven refresh. Coalesces edits into one render
     * {@link REFRESH_DEBOUNCE_MS} after the last one, patching the live viewer in
     * place so pan/zoom/search/an open detail panel survive - rather than
     * {@link update}'s full `webview.html` replace, which loses all of that.
     */
    scheduleRefresh(aslContent: string) {
        this._scheduledContent = aslContent
        this._refreshDebouncer.schedule(aslContent)
    }

    /**
     * Handle a debounced keystroke. Skips the render entirely while the panel is
     * hidden - there is no visible viewer to patch, and `retainContextWhenHidden`
     * means the eventual reveal doesn't need one replayed - remembering the content
     * so `onDidChangeViewState` can render it once the panel becomes visible again.
     */
    private _refresh(aslContent: string) {
        // The debounce fired, so this content is no longer merely "scheduled" - either
        // it gets rendered below or deferred into `_pendingContent`, but either way
        // `currentContent()` must fall back to `_lastContent` again from here on.
        this._scheduledContent = undefined
        if (aslContent === this._lastContent) {
            return
        }
        this._lastContent = aslContent

        if (!this._panel.visible) {
            this._pendingContent = aslContent
            return
        }

        this._performRefresh(aslContent)
    }

    /**
     * Render a debounced keystroke's content and patch it into the live viewer.
     * Falls back to a full {@link update} when the diagram is showing an execution
     * overlay or the error document, when rendering fails, or when the diagram just
     * gained a collapse toggle it didn't have a moment ago (the toolbar's toggle
     * button lives outside the `data-sfn="content"` node an incremental update
     * patches, so a genuinely new button can't be added that way - see webview/render.ts).
     */
    private _performRefresh(aslContent: string) {
        if (this._history !== undefined || this._showingError) {
            this.update(aslContent)
            return
        }

        try {
            const update = renderPreviewUpdate({
                aslContent,
                collapse: this._collapse,
                layout: this._layout,
                showIcons: this._showIcons,
                theme: this._theme,
            })
            if (update.hasCollapsedView && !this._hasCollapsedView) {
                this.update(aslContent)
                return
            }
            this._hasCollapsedView = update.hasCollapsedView
            void this._panel.webview.postMessage(buildUpdateContentMessage({ update }))
        } catch (err) {
            void this._panel.webview.postMessage(buildRenderErrorMessage({ error: err }))
        }
    }

    dispose() {
        DiagramPanel.currentPanel = undefined
        this._refreshDebouncer.cancel()
        this._panel.dispose()
        this._disposables.forEach((disposable) => disposable.dispose())
        this._disposables = []
    }
}
