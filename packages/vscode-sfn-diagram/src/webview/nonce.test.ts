import { describe, expect, it } from 'vitest'
import { createNonce } from './nonce'

describe('createNonce', () => {
    it('returns a 32-character alphanumeric string', () => {
        const nonce = createNonce()
        expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/)
    })

    it('returns a different value on each call', () => {
        const first = createNonce()
        const second = createNonce()
        expect(first).not.toBe(second)
    })
})
