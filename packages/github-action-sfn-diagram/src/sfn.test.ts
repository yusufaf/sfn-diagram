import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchExecutionForOverlay } from './sfn.js'

const { sendMock, fetchExecutionHistoryMock, listExecutionsCommandMock, sfnClientMock } =
    vi.hoisted(() => ({
        sendMock: vi.fn(),
        fetchExecutionHistoryMock: vi.fn(),
        listExecutionsCommandMock: vi.fn((input: unknown) => ({ input })),
        sfnClientMock: vi.fn(),
    }))

vi.mock('@aws-sdk/client-sfn', () => ({
    SFNClient: sfnClientMock.mockImplementation((config: unknown) => ({ config, send: sendMock })),
    ListExecutionsCommand: listExecutionsCommandMock,
}))

vi.mock('sfn-diagram/aws', () => ({
    fetchExecutionHistory: fetchExecutionHistoryMock,
}))

beforeEach(() => {
    vi.clearAllMocks()
})

describe('fetchExecutionForOverlay', () => {
    it('lists the newest execution and fetches its full history', async () => {
        sendMock.mockResolvedValue({
            executions: [{ executionArn: 'arn:exec:run-1', startDate: new Date(0), status: 'SUCCEEDED' }],
        })
        fetchExecutionHistoryMock.mockResolvedValue([{ id: 1 }, { id: 2 }])

        const result = await fetchExecutionForOverlay({
            mode: 'latest',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:sm',
        })

        expect(result).toEqual({
            events: [{ id: 1 }, { id: 2 }],
            executionArn: 'arn:exec:run-1',
            startDate: new Date(0),
            status: 'SUCCEEDED',
        })
        expect(listExecutionsCommandMock).toHaveBeenCalledWith(
            expect.objectContaining({
                maxResults: 1,
                stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:sm',
                statusFilter: undefined,
            }),
        )
        expect(fetchExecutionHistoryMock).toHaveBeenCalledWith(
            expect.objectContaining({ executionArn: 'arn:exec:run-1' }),
        )
    })

    it('filters by FAILED status for latest-failed mode', async () => {
        sendMock.mockResolvedValue({ executions: [{ executionArn: 'arn:exec:run-2' }] })
        fetchExecutionHistoryMock.mockResolvedValue([])

        await fetchExecutionForOverlay({ mode: 'latest-failed', stateMachineArn: 'arn:sm' })

        expect(listExecutionsCommandMock).toHaveBeenCalledWith(
            expect.objectContaining({ statusFilter: 'FAILED' }),
        )
    })

    it('passes the region through to the SFN client when provided', async () => {
        sendMock.mockResolvedValue({ executions: [{ executionArn: 'arn:exec:run-3' }] })
        fetchExecutionHistoryMock.mockResolvedValue([])

        await fetchExecutionForOverlay({ mode: 'latest', region: 'eu-west-1', stateMachineArn: 'arn:sm' })

        expect(sfnClientMock).toHaveBeenCalledWith({ region: 'eu-west-1' })
    })

    it('returns undefined and skips history when there are no matching executions', async () => {
        sendMock.mockResolvedValue({ executions: [] })

        const result = await fetchExecutionForOverlay({ mode: 'latest', stateMachineArn: 'arn:sm' })

        expect(result).toBeUndefined()
        expect(fetchExecutionHistoryMock).not.toHaveBeenCalled()
    })
})
