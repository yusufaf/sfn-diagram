import { describe, expect, it } from 'vitest'
import { generateHtml } from 'sfn-diagram'
import type { AslDefinition } from 'sfn-diagram'
import { injectBeforeBodyEnd, injectIntoHead } from './documentSurgery'

const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', End: true } } }

describe('injectIntoHead', () => {
    it('inserts the markup immediately after the opening head tag', () => {
        const result = injectIntoHead({ html: '<html><head><title>x</title></head></html>', markup: '<meta>' })
        expect(result).toBe('<html><head><meta><title>x</title></head></html>')
    })

    it('throws when no head tag is present', () => {
        expect(() => injectIntoHead({ html: '<html><body></body></html>', markup: '<meta>' })).toThrow(
            /<head>/,
        )
    })
})

describe('injectBeforeBodyEnd', () => {
    it('inserts the markup immediately before the closing body tag', () => {
        const result = injectBeforeBodyEnd({ html: '<html><body><p>x</p></body></html>', markup: '<div></div>' })
        expect(result).toBe('<html><body><p>x</p><div></div></body></html>')
    })

    it('throws when no closing body tag is present', () => {
        expect(() =>
            injectBeforeBodyEnd({ html: '<html><body><p>x</p></html>', markup: '<div></div>' }),
        ).toThrow(/<\/body>/)
    })
})

describe('drift guard against the real viewer document', () => {
    it('finds exactly one <head> and one </body> anchor in generateHtml output', () => {
        const { html } = generateHtml({ aslDefinition: asl })
        expect(html.match(/<head>/g)).toHaveLength(1)
        expect(html.match(/<\/body>/g)).toHaveLength(1)
    })
})
