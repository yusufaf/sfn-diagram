import { describe, expect, it } from 'vitest'
import { buildUpdateContentMessage } from './messages'
import { needsFullRender, renderPreview, renderPreviewUpdate } from './render'
import { runUpdateBridge } from './testing/runUpdateBridge'

const parallelAsl = JSON.stringify({
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
})

const editedParallelAsl = parallelAsl.replace(/"Done"/g, '"Finished"')

describe('an edit to an open preview', () => {
    it('keeps per-container collapse', () => {
        const preview = renderPreview({ aslContent: parallelAsl, layout: 'TB', nonce: 'n1', theme: 'dark' })
        const update = renderPreviewUpdate({ aslContent: editedParallelAsl, layout: 'TB', theme: 'dark' })

        expect(needsFullRender({ documentHasCollapseToggle: preview.hasCollapsedView, update })).toBe(false)

        const bridge = runUpdateBridge()
        bridge.post(buildUpdateContentMessage({ update }))

        expect(bridge.dispatched).toHaveLength(1)
        const detail = bridge.dispatched[0].detail as { contentHtml: string; relayoutModel?: unknown }
        expect(detail.relayoutModel).toBeDefined()
        expect(detail.relayoutModel).toBe(update.relayoutModel)
        expect(detail.contentHtml).toContain('data-sfn-collapse-target="FanOut"')
        expect(detail.contentHtml).not.toContain('data-sfn-view="collapsed"')
    })
})
