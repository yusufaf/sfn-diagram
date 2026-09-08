const NONCE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const NONCE_LENGTH = 32

/**
 * Generate a random Content-Security-Policy nonce for a webview document.
 *
 * @returns A 32-character alphanumeric nonce, safe to embed in a `nonce="…"`
 * attribute and to pass through to `sfn-diagram`'s `nonce` option.
 *
 * @example
 * ```typescript
 * const nonce = createNonce()
 * ```
 */
export function createNonce(): string {
    let nonce = ''
    for (let index = 0; index < NONCE_LENGTH; index++) {
        nonce += NONCE_CHARACTERS.charAt(Math.floor(Math.random() * NONCE_CHARACTERS.length))
    }
    return nonce
}
