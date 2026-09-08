import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { buildContentSecurityPolicyMeta } from './csp'
import { injectBeforeBodyEnd, injectIntoHead } from './documentSurgery'
import { buildHostBridgeScript, buildHostToolbarHtml, buildHostToolbarStyles } from './hostToolbar'
import type { ExecutionMetadata } from './hostToolbar'

/** Parameters for {@link buildPreviewDocument}. */
export interface BuildPreviewDocumentParams {
    /** The webview's own resource origin, from `webview.cspSource`. */
    cspSource: string
    /** Execution overlay summary. Present only while an overlay is active. */
    executionMetadata?: ExecutionMetadata
    /** Currently selected graph layout direction. */
    layout: LayoutDirection
    /** Nonce shared with the viewer document's own `<style>`/`<script>` tags. */
    nonce: string
    /** Currently selected diagram theme. */
    theme: ThemeOption
    /** The interactive viewer document produced by `generateHtml`/`generateExecutionHtml`. */
    viewerHtml: string
}

/**
 * Wrap the interactive viewer document in the CSP meta tag a VS Code webview requires
 * and the host toolbar (Layout/Theme selects, execution legend + Clear-overlay) that
 * replaces the settings a static-SVG preview could only offer through its own markup.
 *
 * Both insertions are anchored, throwing string surgery (see {@link injectIntoHead},
 * {@link injectBeforeBodyEnd}) rather than a template rebuild, so the viewer's own
 * document shape stays exactly what `generateHtml`/`generateExecutionHtml` produced.
 *
 * @param params - Document parameters
 * @returns The complete webview document
 *
 * @example
 * ```typescript
 * const document = buildPreviewDocument({
 *     cspSource: webview.cspSource,
 *     layout: 'TB',
 *     nonce,
 *     theme: 'dark',
 *     viewerHtml: generateHtml({ aslDefinition: asl, nonce }).html,
 * })
 * ```
 */
export function buildPreviewDocument(params: BuildPreviewDocumentParams): string {
    const { cspSource, executionMetadata, layout, nonce, theme, viewerHtml } = params

    const withCsp = injectIntoHead({
        html: viewerHtml,
        markup: `\n${buildContentSecurityPolicyMeta({ cspSource, nonce })}`,
    })

    const toolbarMarkup = `<style nonce="${nonce}">${buildHostToolbarStyles()}</style>
${buildHostToolbarHtml({ executionMetadata, layout, theme })}
<script nonce="${nonce}">${buildHostBridgeScript()}</script>`

    return injectBeforeBodyEnd({ html: withCsp, markup: `\n${toolbarMarkup}\n` })
}
