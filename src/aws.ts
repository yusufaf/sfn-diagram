/**
 * @module
 *
 * Node-only AWS convenience helpers for `sfn-diagram` (the `sfn-diagram/aws` subpath).
 *
 * This subpath (`sfn-diagram/aws`) is isolated from the core entry so that
 * importing `sfn-diagram` never pulls in `@aws-sdk/client-sfn`, keeping the core
 * dependency-free and browser-safe. `@aws-sdk/client-sfn` is an optional peer
 * dependency — install it yourself to use these helpers.
 */
import { GetExecutionHistoryCommand } from '@aws-sdk/client-sfn';
import type { HistoryEvent, SFNClient } from '@aws-sdk/client-sfn';

export interface FetchExecutionHistoryParams {
    /** A caller-constructed SFN client (with the caller's credentials/region). */
    client: SFNClient;
    /** ARN of the execution whose history should be fetched. */
    executionArn: string;
    /** Page size passed to `GetExecutionHistory`. Defaults to 1000 (the AWS max). */
    maxResults?: number;
}

/**
 * Fetches the complete history of a Step Functions execution, paginating through
 * every `GetExecutionHistory` page so callers don't have to hand-roll the
 * `nextToken` loop.
 *
 * The returned `HistoryEvent[]` can be passed straight to `parseExecutionHistory`,
 * `generateExecution`, or `generateMermaidExecution` from `sfn-diagram`.
 *
 * @param params - The SFN client, execution ARN, and optional page size.
 * @returns All history events for the execution, in chronological order.
 *
 * @example
 * ```ts
 * import { SFNClient } from '@aws-sdk/client-sfn';
 * import { fetchExecutionHistory } from 'sfn-diagram/aws';
 * import { generateExecution } from 'sfn-diagram';
 *
 * const client = new SFNClient({ region: 'us-east-1' });
 * const events = await fetchExecutionHistory({ client, executionArn });
 * const { svg } = generateExecution({ aslDefinition: asl, history: events });
 * ```
 */
export async function fetchExecutionHistory(
    params: FetchExecutionHistoryParams
): Promise<HistoryEvent[]> {
    const { client, executionArn, maxResults = 1000 } = params;

    const events: HistoryEvent[] = [];
    let nextToken: string | undefined;

    do {
        const page = await client.send(
            new GetExecutionHistoryCommand({ executionArn, maxResults, nextToken })
        );
        events.push(...(page.events ?? []));
        nextToken = page.nextToken;
    } while (nextToken);

    return events;
}
