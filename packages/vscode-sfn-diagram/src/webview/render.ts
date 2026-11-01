import { generateExecutionHtml, generateHtml, generateViewerUpdate } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption, ViewerUpdate } from 'sfn-diagram'
import type { ExecutionMetadata } from './hostToolbar'

/** Parameters for {@link hasCollapseToggle}. */
export interface HasCollapseToggleParams {
    /** A rendered viewer document, from `renderPreview` or `generateHtml`. */
    html: string
}

/**
 * Whether a rendered viewer document embeds a collapse toggle - i.e. the diagram has a
 * Parallel/Map container worth collapsing. In a full render the toggle is present
 * exactly when the document also ships the relayout bundle that per-container collapse
 * runs on. Both live in the document chrome, outside the `data-sfn="content"` node
 * `ViewerHandle.setContent` patches, so a document opened without them can't gain
 * per-container collapse from an incremental update. See {@link needsFullRender}.
 *
 * @param params - Detection parameters
 * @returns Whether `html` contains the collapse-toggle hook
 *
 * @example
 * ```typescript
 * hasCollapseToggle({ html: renderPreview(params).html }) // => true for a Parallel/Map diagram
 * ```
 */
export function hasCollapseToggle(params: HasCollapseToggleParams): boolean {
    return params.html.includes('data-sfn-collapse-toggle')
}

/** Parameters for {@link renderPreview}. */
export interface RenderPreviewParams {
    /** ASL definition, as a JSON string (matches what the editor buffer holds). */
    aslContent: string
    /** Collapse selection forwarded to the underlying renderer, execution overlay included. Omit for its default. */
    collapse?: boolean
    /**
     * Raw execution-history JSON. When present, renders the execution overlay via
     * `generateExecutionHtml` instead of the plain diagram.
     */
    history?: string
    /** Graph layout direction. */
    layout: LayoutDirection
    /** Content-Security-Policy nonce, forwarded to the interactive viewer. */
    nonce: string
    /** Whether to render AWS service icons. Omit for the renderer's default. */
    showIcons?: boolean
    /** Diagram theme. */
    theme: ThemeOption
}

/** Result of {@link renderPreview}. */
export interface RenderedPreview {
    /** Execution overlay summary. Present only when `history` was given. */
    executionMetadata?: ExecutionMetadata
    /** Whether `html` embeds a collapse toggle. See {@link hasCollapseToggle}. */
    hasCollapsedView: boolean
    /** The interactive viewer document. */
    html: string
}

/**
 * Render an ASL definition as the same interactive viewer document `sfn-diagram
 * --format html` produces, dispatching to the execution-overlay renderer when
 * execution history is supplied.
 *
 * A vscode-free seam between `DiagramPanel` and `sfn-diagram`'s HTML generators, so
 * the panel itself only ever deals with strings and VS Code API calls.
 *
 * @param params - Render parameters
 * @returns The rendered viewer document, plus execution metadata when applicable
 * @throws {SyntaxError} If `aslContent` (or `history`) is not valid JSON
 *
 * @example
 * ```typescript
 * const { html } = renderPreview({ aslContent, layout: 'TB', nonce, theme: 'dark' })
 * ```
 */
export function renderPreview(params: RenderPreviewParams): RenderedPreview {
    const { aslContent, collapse, history, layout, nonce, showIcons, theme } = params
    const collapseOption = collapse !== undefined ? { collapse } : {}
    const showIconsOption = showIcons !== undefined ? { showIcons } : {}

    if (history !== undefined) {
        const { html, metadata } = generateExecutionHtml({
            aslDefinition: aslContent,
            history,
            layout,
            nonce,
            theme,
            ...collapseOption,
            ...showIconsOption,
        })
        return { executionMetadata: metadata, hasCollapsedView: hasCollapseToggle({ html }), html }
    }

    const { html } = generateHtml({
        aslDefinition: aslContent,
        layout,
        nonce,
        theme,
        ...collapseOption,
        ...showIconsOption,
    })
    return { hasCollapsedView: hasCollapseToggle({ html }), html }
}

/** Parameters for {@link renderPreviewUpdate}. */
export interface RenderPreviewUpdateParams {
    /** ASL definition, as a JSON string (matches what the editor buffer holds). */
    aslContent: string
    /** Collapse selection forwarded to the underlying renderer. Omit for its default. */
    collapse?: boolean
    /** Graph layout direction. */
    layout: LayoutDirection
    /** Whether to render AWS service icons. Omit for the renderer's default. */
    showIcons?: boolean
    /** Diagram theme. */
    theme: ThemeOption
}

/**
 * Render just the diagram content for an already-open preview - the debounced
 * keystroke path. No nonce (the content carries no `<script>`/`<style>` of its own)
 * and no `history`: the execution-overlay path stays on the full-document render via
 * {@link renderPreview}.
 *
 * The content is rendered for per-container collapse, like the full document: a
 * diagram with a Parallel/Map container gets one view with header controls plus a
 * `relayoutModel`, not the older expanded/collapsed view pair. That only works in a
 * document that shipped the relayout bundle; see {@link needsFullRender}.
 *
 * @param params - Render parameters
 * @returns Content markup plus the data `ViewerHandle.setContent` needs to rewire it
 * @throws {SyntaxError} If `aslContent` is not valid JSON
 *
 * @example
 * ```typescript
 * const update = renderPreviewUpdate({ aslContent, layout: 'TB', theme: 'dark' })
 * webview.postMessage(buildUpdateContentMessage({ update }))
 * ```
 */
export function renderPreviewUpdate(params: RenderPreviewUpdateParams): ViewerUpdate {
    const { aslContent, collapse, layout, showIcons, theme } = params
    const collapseOption = collapse !== undefined ? { collapse } : {}
    const showIconsOption = showIcons !== undefined ? { showIcons } : {}

    return generateViewerUpdate({
        aslDefinition: aslContent,
        layout,
        relayout: true,
        theme,
        ...collapseOption,
        ...showIconsOption,
    })
}

/** Parameters for {@link needsFullRender}. */
export interface NeedsFullRenderParams {
    /** Whether the open document embeds a collapse toggle, from its last full render. See {@link hasCollapseToggle}. */
    documentHasCollapseToggle: boolean
    /** The debounced edit's freshly-rendered content, from {@link renderPreviewUpdate}. */
    update: ViewerUpdate
}

/**
 * Whether a debounced edit must replace the whole preview document instead of patching
 * its diagram in place.
 *
 * Per-container collapse runs on a relayout bundle that only a full render ships. An
 * edit that gives a diagram its first container produces an update with a
 * `relayoutModel`, but a document opened without a container has no bundle or toggle to
 * use it with, so the viewer would strip the header controls. Only that case needs a
 * full render. A document that has the bundle keeps it across any number of patches, so
 * an edit that removes every container and a later one that restores them both patch.
 *
 * @param params - The open document's state and the edit's update
 * @returns `true` when the update carries a relayout model the open document can't use
 *
 * @example
 * ```typescript
 * const update = renderPreviewUpdate({ aslContent, layout: 'TB', theme: 'dark' })
 * if (needsFullRender({ documentHasCollapseToggle, update })) {
 *     // re-render with renderPreview
 * } else {
 *     webview.postMessage(buildUpdateContentMessage({ update }))
 * }
 * ```
 *
 * @remarks `documentHasCollapseToggle` must come from the last full render only. A patch
 * never adds or removes the bundle, so updating the flag from a patch would make the next
 * edit to a container diagram fall back to a full render for no reason.
 */
export function needsFullRender(params: NeedsFullRenderParams): boolean {
    return params.update.relayoutModel !== undefined && !params.documentHasCollapseToggle
}
