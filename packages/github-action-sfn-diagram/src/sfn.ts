import { ListExecutionsCommand, SFNClient } from '@aws-sdk/client-sfn'
import type { HistoryEvent } from '@aws-sdk/client-sfn'
import { fetchExecutionHistory } from 'sfn-diagram/aws'

/** How the action selects which execution to overlay. `off` disables the feature. */
export type ExecutionMode = 'off' | 'latest' | 'latest-failed'

export interface FetchExecutionForOverlayParams {
    /** `latest` takes the most recent execution; `latest-failed` the most recent FAILED one. */
    mode: Exclude<ExecutionMode, 'off'>
    /** AWS region for the SFN client. Falls back to the SDK's default resolution when omitted. */
    region?: string
    stateMachineArn: string
}

export interface OverlayExecution {
    events: HistoryEvent[]
    executionArn: string
    startDate?: Date
    status?: string
}

/**
 * Resolves the execution to overlay for a state machine: lists the newest
 * execution (optionally filtered to FAILED) and paginates its full history via
 * the `sfn-diagram/aws` helper. Returns `undefined` when no matching execution
 * exists. `ListExecutions` returns results newest-first, so `maxResults: 1` is
 * the most recent.
 */
export async function fetchExecutionForOverlay(
    params: FetchExecutionForOverlayParams,
): Promise<OverlayExecution | undefined> {
    const { mode, region, stateMachineArn } = params

    const client = new SFNClient(region ? { region } : {})
    const list = await client.send(
        new ListExecutionsCommand({
            maxResults: 1,
            stateMachineArn,
            statusFilter: mode === 'latest-failed' ? 'FAILED' : undefined,
        }),
    )

    const newest = list.executions?.[0]
    if (!newest?.executionArn) {
        return undefined
    }

    const events = await fetchExecutionHistory({ client, executionArn: newest.executionArn })
    return {
        events,
        executionArn: newest.executionArn,
        startDate: newest.startDate,
        status: newest.status,
    }
}
