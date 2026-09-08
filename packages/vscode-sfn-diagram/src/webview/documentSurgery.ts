/** Parameters for {@link injectIntoHead} and {@link injectBeforeBodyEnd}. */
export interface InjectMarkupParams {
    /** The HTML document to inject into. */
    html: string
    /** The markup to insert at the anchor. */
    markup: string
}

/**
 * Insert markup immediately after a document's opening `<head>` tag.
 *
 * Throws rather than silently no-op'ing when the anchor is missing, so a future
 * change to the wrapped document's shape surfaces as a loud error instead of a
 * webview that quietly renders without its CSP meta tag.
 *
 * @param params - Injection parameters
 * @returns The document with `markup` inserted right after `<head>`
 * @throws {Error} If the document has no `<head>` tag
 *
 * @example
 * ```typescript
 * const withCsp = injectIntoHead({ html, markup: buildContentSecurityPolicyMeta(params) })
 * ```
 */
export function injectIntoHead(params: InjectMarkupParams): string {
    const { html, markup } = params
    const anchor = '<head>'
    const index = html.indexOf(anchor)
    if (index === -1) {
        throw new Error('injectIntoHead: no <head> tag found in the document')
    }
    const insertAt = index + anchor.length
    return html.slice(0, insertAt) + markup + html.slice(insertAt)
}

/**
 * Insert markup immediately before a document's closing `</body>` tag.
 *
 * Throws rather than silently no-op'ing when the anchor is missing - see
 * {@link injectIntoHead} for why.
 *
 * @param params - Injection parameters
 * @returns The document with `markup` inserted right before `</body>`
 * @throws {Error} If the document has no `</body>` tag
 *
 * @example
 * ```typescript
 * const withToolbar = injectBeforeBodyEnd({ html, markup: buildHostToolbarHtml(params) })
 * ```
 */
export function injectBeforeBodyEnd(params: InjectMarkupParams): string {
    const { html, markup } = params
    const anchor = '</body>'
    const index = html.indexOf(anchor)
    if (index === -1) {
        throw new Error('injectBeforeBodyEnd: no </body> tag found in the document')
    }
    return html.slice(0, index) + markup + html.slice(index)
}
