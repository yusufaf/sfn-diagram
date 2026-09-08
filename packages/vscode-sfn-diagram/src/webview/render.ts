import { generateExecutionHtml, generateHtml } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import type { ExecutionMetadata } from './hostToolbar'

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
        return { executionMetadata: metadata, html }
    }

    const { html } = generateHtml({
        aslDefinition: aslContent,
        layout,
        nonce,
        theme,
        ...collapseOption,
        ...showIconsOption,
    })
    return { html }
}
