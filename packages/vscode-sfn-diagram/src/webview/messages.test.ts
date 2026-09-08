import { describe, expect, it } from 'vitest'
import type { ViewerUpdate } from 'sfn-diagram'
import { buildRenderErrorMessage, buildUpdateContentMessage } from './messages'

const update: ViewerUpdate = {
    contentHtml: '<svg>diagram</svg>',
    edgeData: { 'A->B#normal#0': { from: 'A', to: 'B', type: 'normal' } },
    hasCollapsedView: false,
    metadata: { edgeCount: 1, nodeCount: 2 },
    stateData: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
}

describe('buildUpdateContentMessage', () => {
    it('carries the exact contentHtml/edgeData/stateData payload shape', () => {
        expect(buildUpdateContentMessage({ update })).toEqual({
            command: 'updateContent',
            contentHtml: update.contentHtml,
            edgeData: update.edgeData,
            stateData: update.stateData,
        })
    })

    it('drops metadata and hasCollapsedView, which the webview does not need', () => {
        const message = buildUpdateContentMessage({ update })
        expect(message).not.toHaveProperty('metadata')
        expect(message).not.toHaveProperty('hasCollapsedView')
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
