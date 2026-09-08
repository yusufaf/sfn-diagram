import { describe, expect, it } from 'vitest'
import { generateExecution } from 'sfn-diagram'
import { renderPreview } from './render'

const simpleAsl = JSON.stringify({
    StartAt: 'A',
    States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
})

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

const historyEvents = JSON.stringify([
    { id: 1, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
    {
        id: 2,
        type: 'PassStateEntered',
        previousEventId: 1,
        stateEnteredEventDetails: { name: 'A' },
        timestamp: '2024-01-01T00:00:00.100Z',
    },
    {
        id: 3,
        type: 'PassStateExited',
        previousEventId: 2,
        stateExitedEventDetails: { name: 'A' },
        timestamp: '2024-01-01T00:00:00.200Z',
    },
    {
        id: 4,
        type: 'SucceedStateEntered',
        previousEventId: 3,
        stateEnteredEventDetails: { name: 'B' },
        timestamp: '2024-01-01T00:00:00.300Z',
    },
    { id: 5, type: 'ExecutionSucceeded', previousEventId: 4, timestamp: '2024-01-01T00:00:00.400Z' },
])

describe('renderPreview', () => {
    it('renders the plain interactive viewer with no execution metadata when no history is given', () => {
        const result = renderPreview({ aslContent: simpleAsl, layout: 'TB', nonce: 'n1', theme: 'dark' })

        expect(result.executionMetadata).toBeUndefined()
        expect(result.html).toContain('data-sfn-zoom')
        expect(result.html).toContain('data-sfn="search"')
    })

    it('includes the collapse-toggle hook for a diagram with a container', () => {
        const result = renderPreview({ aslContent: parallelAsl, layout: 'TB', nonce: 'n1', theme: 'dark' })
        expect(result.html).toContain('data-sfn-collapse-toggle')
    })

    it('omits the collapse-toggle hook for a diagram with no container', () => {
        const result = renderPreview({ aslContent: simpleAsl, layout: 'TB', nonce: 'n1', theme: 'dark' })
        expect(result.html).not.toContain('data-sfn-collapse-toggle')
    })

    it('renders the execution overlay and reports metadata matching generateExecution', () => {
        const expected = generateExecution({ aslDefinition: simpleAsl, history: historyEvents })
        const result = renderPreview({
            aslContent: simpleAsl,
            history: historyEvents,
            layout: 'TB',
            nonce: 'n1',
            theme: 'dark',
        })

        expect(result.executionMetadata).toEqual(expected.metadata)
        expect(result.html).toContain('data-sfn-zoom')
        expect(result.html).toContain('data-sfn="search"')
    })

    it('forwards layout, theme, showIcons, and collapse to the underlying renderer', () => {
        const result = renderPreview({
            aslContent: parallelAsl,
            collapse: false,
            layout: 'LR',
            nonce: 'n1',
            showIcons: false,
            theme: 'light',
        })

        // collapse: false means nothing collapses, so no second view/toggle is emitted.
        expect(result.html).not.toContain('data-sfn-collapse-toggle')
        expect(result.html).toContain('background: #fafafa') // light chrome
    })

    it('throws on malformed JSON input', () => {
        expect(() =>
            renderPreview({ aslContent: '{not valid json', layout: 'TB', nonce: 'n1', theme: 'dark' }),
        ).toThrow()
    })
})
