import { describe, expect, it } from 'vitest'
import { buildUpdateBridgeScript } from './updateBridge'

describe('buildUpdateBridgeScript', () => {
    it('dispatches sfn-set-content on an updateContent message', () => {
        expect(buildUpdateBridgeScript()).toContain('sfn-set-content')
    })

    it('references both command names', () => {
        const script = buildUpdateBridgeScript()
        expect(script).toContain("'updateContent'")
        expect(script).toContain("'renderError'")
    })

    it('references the status chip hook', () => {
        expect(buildUpdateBridgeScript()).toContain('data-host="status"')
    })

    it('does not call acquireVsCodeApi, guarding against a double-acquire', () => {
        expect(buildUpdateBridgeScript()).not.toContain('acquireVsCodeApi')
    })
})
