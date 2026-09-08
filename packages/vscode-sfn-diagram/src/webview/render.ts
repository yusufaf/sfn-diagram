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
 * Parallel/Map container worth collapsing. Used to detect when a debounced refresh must
 * fall back to a full document replace: the toggle button lives in the toolbar chrome,
 * outside the `data-sfn="content"` node `ViewerHandle.setContent` patches, so gaining or
 * losing one mid-edit can't be handled by an incremental update alone.
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
    /**
     * Collapse selection forwarded to the underlying renderer. Omit for its default.
     * Has no effect when `history` is set - `generateExecutionHtml` does not yet
     * support `collapse` (see its JSDoc `@remarks`).
     */
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
        theme,
        ...collapseOption,
        ...showIconsOption,
    })
}
