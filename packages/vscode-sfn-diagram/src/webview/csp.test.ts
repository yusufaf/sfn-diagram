import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, buildContentSecurityPolicyMeta } from './csp'

const params = { cspSource: 'vscode-webview://abc123', nonce: 'test-nonce' }

describe('buildContentSecurityPolicy', () => {
    it('builds the exact expected policy string', () => {
        expect(buildContentSecurityPolicy(params)).toBe(
            "default-src 'none'; img-src vscode-webview://abc123 https://cdn.jsdelivr.net data:; script-src 'nonce-test-nonce'; style-src vscode-webview://abc123 'unsafe-inline';",
        )
    })

    it('scopes script-src to the nonce only, never unsafe-inline or unsafe-eval', () => {
        const policy = buildContentSecurityPolicy(params)
        const scriptSrc = policy.match(/script-src ([^;]+);/)?.[1]
        expect(scriptSrc).toBe("'nonce-test-nonce'")
        expect(scriptSrc).not.toContain('unsafe-inline')
        expect(scriptSrc).not.toContain('unsafe-eval')
    })

    it('scopes img-src to the webview source, the icon CDN, and data URIs', () => {
        const policy = buildContentSecurityPolicy(params)
        const imgSrc = policy.match(/img-src ([^;]+);/)?.[1]
        expect(imgSrc).toContain('vscode-webview://abc123')
        expect(imgSrc).toContain('https://cdn.jsdelivr.net')
        expect(imgSrc).toContain('data:')
    })

    it("defaults every other directive to 'none'", () => {
        expect(buildContentSecurityPolicy(params)).toContain("default-src 'none';")
    })

    it('rejects a nonce that could break out of the script-src directive', () => {
        expect(() => buildContentSecurityPolicy({ ...params, nonce: "x'; script-src *" })).toThrow(
            /nonce must contain only/,
        )
    })
})

describe('buildContentSecurityPolicyMeta', () => {
    it('wraps the policy in a CSP meta tag', () => {
        const meta = buildContentSecurityPolicyMeta(params)
        expect(meta).toBe(
            `<meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(params)}">`,
        )
    })
})
