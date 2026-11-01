import { describe, expect, it } from 'vitest'
import type { ViewerUpdate } from 'sfn-diagram'
import { buildRenderErrorMessage, buildUpdateContentMessage } from './messages'
import { renderPreviewUpdate } from './render'

const parallelAsl = JSON.stringify({
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Branch1', States: { Branch1: { Type: 'Pass', End: true } } },
                { StartAt: 'Branch2', States: { Branch2: { Type: 'Pass', End: true } } },
            ],
            End: true,
        },
    },
})

const update: ViewerUpdate = {
    contentHtml: '<svg>diagram</svg>',
    edgeData: { 'A->B#normal#0': { from: 'A', to: 'B', type: 'normal' } },
    hasCollapsedView: false,
    mermaid: 'stateDiagram-v2',
    metadata: { edgeCount: 1, nodeCount: 2 },
    stateData: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
}

describe('buildUpdateContentMessage', () => {
    it('carries the exact contentHtml/edgeData/stateData payload shape', () => {
        expect(buildUpdateContentMessage({ update })).toEqual({
            command: 'updateContent',
            contentHtml: update.contentHtml,
            edgeData: update.edgeData,
            mermaid: update.mermaid,
            stateData: update.stateData,
        })
    })

    it('drops metadata and hasCollapsedView, which the webview does not need', () => {
        const message = buildUpdateContentMessage({ update })
        expect(message).not.toHaveProperty('metadata')
        expect(message).not.toHaveProperty('hasCollapsedView')
        expect(message).not.toHaveProperty('relayoutModel')
    })

    it('carries the relayout model when the update has one', () => {
        const parallelUpdate = renderPreviewUpdate({ aslContent: parallelAsl, layout: 'TB', theme: 'dark' })
        const message = buildUpdateContentMessage({ update: parallelUpdate })
        expect(message.relayoutModel).toBeDefined()
        expect(message.relayoutModel).toBe(parallelUpdate.relayoutModel)
    })
})

describe('buildRenderErrorMessage', () => {
    it('uses an Error instance\'s message', () => {
        expect(buildRenderErrorMessage({ error: new Error('bad JSON') })).toEqual({
            command: 'renderError',
            message: 'bad JSON',
        })
    })

    it('stringifies a non-Error value', () => {
        expect(buildRenderErrorMessage({ error: 'plain string' })).toEqual({
            command: 'renderError',
            message: 'plain string',
        })
        expect(buildRenderErrorMessage({ error: 42 })).toEqual({
            command: 'renderError',
            message: '42',
        })
    })
})
