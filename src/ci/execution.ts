/**
 * Fetches the execution to overlay onto a CI-generated diagram. Node-only —
 * lives under the `sfn-diagram/ci` subpath, never the core entry, so
 * `@aws-sdk/client-sfn` stays out of `sfn-diagram`'s dependency graph.
 *
 * `@aws-sdk/client-sfn` is loaded lazily (dynamic `import()`, mirroring
 * PngExporter's optional-peer pattern) rather than as a static top-level
 * import: `sfn-diagram/ci`'s barrel is imported unconditionally by the CLI
 * for `comment gitlab`, and a static import would make every `sfn-diagram`
 * command — including plain SVG/Mermaid generation, with no AWS or GitLab
 * involved — fail at startup for anyone who hasn't installed the optional
 * peer.
 */
import type { HistoryEvent, ListExecutionsCommand as ListExecutionsCommandType, SFNClient as SFNClientType } from '@aws-sdk/client-sfn';
import type { FetchExecutionHistoryParams } from '../aws';

/** How a CI integration selects which execution to overlay. `off` disables the feature. */
export type ExecutionMode = 'off' | 'latest' | 'latest-failed';

export interface FetchExecutionForOverlayParams {
    /** `latest` takes the most recent execution; `latest-failed` the most recent FAILED one. */
    mode: Exclude<ExecutionMode, 'off'>;
    /** AWS region for the SFN client. Falls back to the SDK's default resolution when omitted. */
    region?: string;
    stateMachineArn: string;
}

export interface OverlayExecution {
    events: HistoryEvent[];
    executionArn: string;
    startDate?: Date;
    status?: string;
}

async function loadAwsSfn(): Promise<{
    ListExecutionsCommand: typeof ListExecutionsCommandType;
    SFNClient: typeof SFNClientType;
    fetchExecutionHistory: (params: FetchExecutionHistoryParams) => Promise<HistoryEvent[]>;
}> {
    try {
        const [clientSfn, aws] = await Promise.all([import('@aws-sdk/client-sfn'), import('../aws')]);
        return {
            ListExecutionsCommand: clientSfn.ListExecutionsCommand,
            SFNClient: clientSfn.SFNClient,
            fetchExecutionHistory: aws.fetchExecutionHistory,
        };
    } catch {
        throw new Error(
            "Execution overlays require the optional peer dependency '@aws-sdk/client-sfn'. " +
                'Install it with: npm install @aws-sdk/client-sfn'
        );
    }
}

/**
 * Resolves the execution to overlay for a state machine: lists the newest
 * execution (optionally filtered to FAILED) and paginates its full history via
 * `fetchExecutionHistory`. Returns `undefined` when no matching execution
 * exists. `ListExecutions` returns results newest-first, so `maxResults: 1` is
 * the most recent.
 */
export async function fetchExecutionForOverlay(
    params: FetchExecutionForOverlayParams
): Promise<OverlayExecution | undefined> {
    const { mode, region, stateMachineArn } = params;

    const { ListExecutionsCommand, SFNClient, fetchExecutionHistory } = await loadAwsSfn();

    const client = new SFNClient(region ? { region } : {});
    const list = await client.send(
        new ListExecutionsCommand({
            maxResults: 1,
            stateMachineArn,
            statusFilter: mode === 'latest-failed' ? 'FAILED' : undefined,
        })
    );

    const newest = list.executions?.[0];
    if (!newest?.executionArn) {
        return undefined;
    }

    const events = await fetchExecutionHistory({
        client,
        executionArn: newest.executionArn,
    });
    return {
        events,
        executionArn: newest.executionArn,
        startDate: newest.startDate,
        status: newest.status,
    };
}
