import { describe, expect, it } from 'vitest'
import { runUpdateBridge } from './testing/runUpdateBridge'
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

    it('forwards relayoutModel in the sfn-set-content detail', () => {
        const bridge = runUpdateBridge()
        const model = { marker: 1 }
        bridge.post({
            command: 'updateContent',
            contentHtml: 'x',
            edgeData: {},
            mermaid: 'm',
            relayoutModel: model,
            stateData: {},
        })

        expect(bridge.dispatched).toHaveLength(1)
        expect(bridge.dispatched[0].type).toBe('sfn-set-content')
        expect((bridge.dispatched[0].detail as { relayoutModel?: unknown }).relayoutModel).toBe(model)
    })

    it('leaves relayoutModel undefined when the message has none', () => {
        const bridge = runUpdateBridge()
        bridge.post({ command: 'updateContent', contentHtml: 'x', edgeData: {}, mermaid: 'm', stateData: {} })

        expect(bridge.dispatched).toHaveLength(1)
        expect((bridge.dispatched[0].detail as { relayoutModel?: unknown }).relayoutModel).toBeUndefined()
    })
})
