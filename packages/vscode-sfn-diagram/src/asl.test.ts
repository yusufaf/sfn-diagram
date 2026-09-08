import { describe, expect, it } from 'vitest'
import { isAslFileName } from './asl'

describe('isAslFileName', () => {
    it('matches an .asl.json file', () => {
        expect(isAslFileName({ fileName: 'order-processing.asl.json' })).toBe(true)
    })

    it('matches an .asl file', () => {
        expect(isAslFileName({ fileName: 'workflow.asl' })).toBe(true)
    })

    it('rejects package.json', () => {
        expect(isAslFileName({ fileName: 'package.json' })).toBe(false)
    })

    it('rejects tsconfig.json', () => {
        expect(isAslFileName({ fileName: 'tsconfig.json' })).toBe(false)
    })

    it('rejects settings.json', () => {
        expect(isAslFileName({ fileName: 'settings.json' })).toBe(false)
    })

    it('matches case-insensitively', () => {
        expect(isAslFileName({ fileName: 'ORDER.ASL.JSON' })).toBe(true)
    })

    it('matches a Windows-style path', () => {
        expect(isAslFileName({ fileName: 'C:\\repo\\workflows\\order.asl.json' })).toBe(true)
    })

    it('matches a POSIX-style path', () => {
        expect(isAslFileName({ fileName: '/repo/workflows/order.asl.json' })).toBe(true)
    })

    it('rejects a bare "asl.json" with no leading dot', () => {
        expect(isAslFileName({ fileName: 'asl.json' })).toBe(false)
    })

    it('rejects an unrelated ".aslx" suffix', () => {
        expect(isAslFileName({ fileName: 'weird.aslx' })).toBe(false)
    })

    it('rejects an empty string', () => {
        expect(isAslFileName({ fileName: '' })).toBe(false)
    })
})
