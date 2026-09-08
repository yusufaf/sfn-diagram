import { buildContentSecurityPolicyMeta } from './csp'

/** Parameters for {@link buildErrorDocument}. */
export interface BuildErrorDocumentParams {
    /** The webview's own resource origin, from `webview.cspSource`. */
    cspSource: string
    /** The error message to display, escaped before embedding. */
    message: string
    /** Nonce shared with the document's `<style>` tag. */
    nonce: string
}

/**
 * Escape text for safe embedding in HTML.
 *
 * @param text - Raw text to escape
 * @returns `text` with `&`, `<`, `>`, and `"` replaced by their HTML entities
 *
 * @example
 * ```typescript
 * escapeHtml('<bad> & "input"') // '&lt;bad&gt; &amp; &quot;input&quot;'
 * ```
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * Build the webview document shown when rendering the preview fails (e.g. invalid
 * JSON, or an unrecognized state type), carrying the same CSP the interactive-viewer
 * document does.
 *
 * @param params - Document parameters
 * @returns The complete error webview document
 *
 * @example
 * ```typescript
 * const document = buildErrorDocument({ cspSource: webview.cspSource, message, nonce })
 * ```
 */
export function buildErrorDocument(params: BuildErrorDocumentParams): string {
    const { cspSource, message, nonce } = params
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
${buildContentSecurityPolicyMeta({ cspSource, nonce })}
<title>Step Functions Preview</title>
<style nonce="${nonce}">
  body { background: var(--vscode-editor-background); color: var(--vscode-errorForeground); font-family: monospace; padding: 20px; }
</style>
</head>
<body><strong>Error:</strong> ${escapeHtml(message)}</body>
</html>`
}
