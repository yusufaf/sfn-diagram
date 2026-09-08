import { describe, expect, it } from 'vitest'
import { buildErrorDocument, escapeHtml } from './errorDocument'

describe('escapeHtml', () => {
    it('escapes &, <, >, and "', () => {
        expect(escapeHtml('<script>alert("hi") & run</script>')).toBe(
            '&lt;script&gt;alert(&quot;hi&quot;) &amp; run&lt;/script&gt;',
        )
    })
})

describe('buildErrorDocument', () => {
    const params = { cspSource: 'vscode-webview://abc123', message: '<bad> & "json"', nonce: 'test-nonce' }

    it('escapes the message', () => {
        const document = buildErrorDocument(params)
        expect(document).toContain('&lt;bad&gt; &amp; &quot;json&quot;')
        expect(document).not.toContain('<bad>')
    })

    it('includes a CSP meta tag', () => {
        const document = buildErrorDocument(params)
        expect(document).toContain('Content-Security-Policy')
    })

    it('contains no script tag', () => {
        const document = buildErrorDocument(params)
        expect(document).not.toContain('<script')
    })
})
