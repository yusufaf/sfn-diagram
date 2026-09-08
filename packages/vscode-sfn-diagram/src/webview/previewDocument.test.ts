import { describe, expect, it } from 'vitest'
import { generateHtml } from 'sfn-diagram'
import type { AslDefinition } from 'sfn-diagram'
import { buildPreviewDocument } from './previewDocument'

const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', End: true } } }
const CSP_SOURCE = 'vscode-webview://abc123'
const NONCE = 'test-nonce'

function buildDocument(overrides: Partial<Parameters<typeof buildPreviewDocument>[0]> = {}) {
    const { html: viewerHtml } = generateHtml({ aslDefinition: asl, nonce: NONCE })
    return buildPreviewDocument({
        cspSource: CSP_SOURCE,
        layout: 'TB',
        nonce: NONCE,
        theme: 'dark',
        viewerHtml,
        ...overrides,
    })
}

describe('buildPreviewDocument', () => {
    it('places the CSP meta tag in <head>, before the first style/script tag', () => {
        const document = buildDocument()
        const headIndex = document.indexOf('<head>')
        const cspIndex = document.indexOf('Content-Security-Policy')
        const firstStyleIndex = document.indexOf('<style')
        const firstScriptIndex = document.indexOf('<script')

        expect(headIndex).toBeGreaterThanOrEqual(0)
        expect(cspIndex).toBeGreaterThan(headIndex)
        expect(cspIndex).toBeLessThan(firstStyleIndex)
        expect(cspIndex).toBeLessThan(firstScriptIndex)
    })

    it('stamps every script tag with the same nonce', () => {
        const document = buildDocument()
        const scriptTags = document.match(/<script\b[^>]*>/g) ?? []
        expect(scriptTags.length).toBeGreaterThan(0)
        for (const tag of scriptTags) {
            expect(tag).toContain(`nonce="${NONCE}"`)
        }
    })

    it('contains no inline event-handler attributes', () => {
        const document = buildDocument()
        expect(document).not.toMatch(/ on[a-z]+="/)
    })

    it('calls acquireVsCodeApi exactly once', () => {
        const document = buildDocument()
        expect(document.match(/acquireVsCodeApi\(\)/g)).toHaveLength(1)
    })

    it('includes the update bridge script, nonce-stamped, and the status chip hook', () => {
        const document = buildDocument()
        expect(document).toContain('sfn-set-content')
        expect(document).toContain('data-host="status"')
        const updateBridgeScript = (document.match(/<script[^>]*>[^<]*sfn-set-content[\s\S]*?<\/script>/) ?? [])[0]
        expect(updateBridgeScript).toContain(`nonce="${NONCE}"`)
    })

    it('preselects the current layout and theme in the host pill', () => {
        const document = buildDocument({ layout: 'LR', theme: 'light' })
        expect(document).toMatch(/<option value="LR" selected>/)
        expect(document).toMatch(/<option value="light" selected>/)
    })

    it('omits the execution legend and clear-overlay control with no execution metadata', () => {
        const document = buildDocument()
        expect(document).not.toContain('Clear overlay')
    })

    it('includes the execution legend and clear-overlay control when execution metadata is supplied', () => {
        const document = buildDocument({
            executionMetadata: {
                caught: [],
                edgeCount: 1,
                executionStatus: 'succeeded',
                failed: [],
                nodeCount: 1,
                notReached: [],
                running: [],
                succeeded: ['A'],
                takenEdgeCount: 0,
            },
        })
        expect(document).toContain('Clear overlay')
        expect(document).toContain('Succeeded (1)')
    })
})
