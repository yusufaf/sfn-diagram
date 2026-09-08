/** Parameters for {@link buildContentSecurityPolicy} and {@link buildContentSecurityPolicyMeta}. */
export interface BuildContentSecurityPolicyParams {
    /** The webview's own resource origin, from `webview.cspSource`. */
    cspSource: string
    /** Nonce shared with every `<style>`/`<script>` tag in the document. */
    nonce: string
}

// Mirrors core's own guard (src/renderers/viewer/viewerShell.ts) on the identical
// value: createNonce() only ever emits alphanumeric characters today, so this can't
// fire yet, but the nonce lands unescaped inside an HTML attribute here too - a
// future caller-supplied nonce must not be able to break out of it.
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/

function validatedNonce(nonce: string): string {
    if (!NONCE_PATTERN.test(nonce)) {
        throw new Error('nonce must contain only letters, digits, "+", "/", "=", "-", or "_"')
    }
    return nonce
}

/**
 * Build the Content-Security-Policy string for the interactive-viewer webview.
 *
 * `script-src` is nonce-only (no `unsafe-inline`/`unsafe-eval`); `img-src` allows the
 * webview's own resources, the AWS icon CDN, and `data:` URIs; `style-src` allows the
 * webview's own resources plus `unsafe-inline`, since VS Code's injected default
 * styles may not carry the same nonce.
 *
 * @param params - CSP parameters
 * @returns The policy string, ready to embed in a CSP `<meta>` tag's `content` attribute
 *
 * @example
 * ```typescript
 * const policy = buildContentSecurityPolicy({ cspSource: webview.cspSource, nonce })
 * ```
 */
export function buildContentSecurityPolicy(params: BuildContentSecurityPolicyParams): string {
    const { cspSource, nonce } = params
    return `default-src 'none'; img-src ${cspSource} https://cdn.jsdelivr.net data:; script-src 'nonce-${validatedNonce(nonce)}'; style-src ${cspSource} 'unsafe-inline';`
}

/**
 * Build a complete CSP `<meta>` tag for the interactive-viewer webview.
 *
 * @param params - CSP parameters
 * @returns The `<meta http-equiv="Content-Security-Policy" …>` tag as a string
 *
 * @example
 * ```typescript
 * const meta = buildContentSecurityPolicyMeta({ cspSource: webview.cspSource, nonce })
 * ```
 */
export function buildContentSecurityPolicyMeta(params: BuildContentSecurityPolicyParams): string {
    return `<meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(params)}">`
}
