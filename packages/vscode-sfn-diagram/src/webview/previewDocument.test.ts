import { describe, expect, it } from 'vitest'
import { generateExecution } from 'sfn-diagram'
import { generateHtml } from 'sfn-diagram/html'
import type { AslDefinition, ExecutionHistoryEvent } from 'sfn-diagram'
import { buildPreviewDocument } from './previewDocument'

const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', End: true } } }
const succeededHistory: ExecutionHistoryEvent[] = [
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
    { id: 4, type: 'ExecutionSucceeded', previousEventId: 3, timestamp: '2024-01-01T00:00:00.300Z' },
]
const abandonedBranchAsl: AslDefinition = {
    StartAt: 'Fan',
    States: {
        Fan: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Boom', States: { Boom: { Type: 'Fail', Error: 'Boom' } } },
                {
                    StartAt: 'Slow',
                    States: { Slow: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', End: true } },
                },
            ],
            Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Recovered' }],
            Next: 'Recovered',
        },
        Recovered: { Type: 'Pass', End: true },
    },
}
// Boom's failure abandons Slow mid-run, and Fan's Catch recovers the execution.
const abandonedBranchHistory: ExecutionHistoryEvent[] = [
    { id: 1, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
    {
        id: 2,
        type: 'ParallelStateEntered',
        previousEventId: 1,
        stateEnteredEventDetails: { name: 'Fan' },
        timestamp: '2024-01-01T00:00:00.100Z',
    },
    { id: 3, type: 'ParallelStateStarted', previousEventId: 2, timestamp: '2024-01-01T00:00:00.200Z' },
    {
        id: 4,
        type: 'FailStateEntered',
        previousEventId: 3,
        stateEnteredEventDetails: { name: 'Boom' },
        timestamp: '2024-01-01T00:00:00.300Z',
    },
    {
        id: 5,
        type: 'TaskStateEntered',
        previousEventId: 3,
        stateEnteredEventDetails: { name: 'Slow' },
        timestamp: '2024-01-01T00:00:00.400Z',
    },
    { id: 6, type: 'TaskScheduled', previousEventId: 5, timestamp: '2024-01-01T00:00:00.500Z' },
    { id: 7, type: 'ParallelStateFailed', previousEventId: 4, timestamp: '2024-01-01T00:00:00.600Z' },
    {
        id: 8,
        type: 'ParallelStateExited',
        previousEventId: 7,
        stateExitedEventDetails: { name: 'Fan' },
        timestamp: '2024-01-01T00:00:00.700Z',
    },
    {
        id: 9,
        type: 'PassStateEntered',
        previousEventId: 8,
        stateEnteredEventDetails: { name: 'Recovered' },
        timestamp: '2024-01-01T00:00:00.800Z',
    },
    {
        id: 10,
        type: 'PassStateExited',
        previousEventId: 9,
        stateExitedEventDetails: { name: 'Recovered' },
        timestamp: '2024-01-01T00:00:00.900Z',
    },
    { id: 11, type: 'ExecutionSucceeded', previousEventId: 10, timestamp: '2024-01-01T00:00:01.000Z' },
]
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
        const scriptTags = document.match(/<script\b[^>]*>/gi) ?? []
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
        const { metadata } = generateExecution({ aslDefinition: asl, history: succeededHistory })
        const document = buildDocument({ executionMetadata: metadata })
        expect(document).toContain('Clear overlay')
        expect(document).toContain('Succeeded (1)')
    })

    it('shows Aborted (0) in the legend for a succeeded execution', () => {
        const { metadata } = generateExecution({ aslDefinition: asl, history: succeededHistory })
        const document = buildDocument({ executionMetadata: metadata })
        expect(document).toContain('Aborted (0)')
    })

    it('counts a state an abandoned Parallel branch left mid-run as Aborted (1), after Caught, in the aborted stroke colour', () => {
        const { metadata } = generateExecution({
            aslDefinition: abandonedBranchAsl,
            history: abandonedBranchHistory,
        })
        expect(metadata.aborted).toEqual(['Slow'])
        const document = buildDocument({ executionMetadata: metadata })
        expect(document).toContain('<span class="sfn-host-swatch" style="background:#455a64"></span>Aborted (1)')
        const caughtIndex = document.indexOf('Caught (1)')
        const abortedIndex = document.indexOf('Aborted (1)')
        const notReachedIndex = document.indexOf('Not reached (0)')
        expect(caughtIndex).toBeGreaterThan(-1)
        expect(caughtIndex).toBeLessThan(abortedIndex)
        expect(abortedIndex).toBeLessThan(notReachedIndex)
    })
})
