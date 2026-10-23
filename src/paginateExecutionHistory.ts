/**
 * @module
 *
 * The SDK-free core of `sfn-diagram/aws`'s `fetchExecutionHistory`, for callers
 * that load `@aws-sdk/client-sfn` lazily and pass its command class in.
 *
 * This module must never import `@aws-sdk/client-sfn` at runtime (type-only
 * imports only). `bun build --compile` hoists a static import of an external
 * package out of every module it inlines, even one reached only through
 * `import()`, so a static SDK import anywhere the CLI reaches makes the
 * standalone binary require the SDK at startup (#341).
 */
import type {
    GetExecutionHistoryCommand as GetExecutionHistoryCommandType,
    HistoryEvent,
    SFNClient,
} from '@aws-sdk/client-sfn';

/** Parameters for {@link paginateExecutionHistory}. */
export interface PaginateExecutionHistoryParams {
    /** The SDK's command class, passed in by a caller that has already loaded the SDK. */
    GetExecutionHistoryCommand: typeof GetExecutionHistoryCommandType;
    /** A caller-constructed SFN client (with the caller's credentials/region). */
    client: SFNClient;
    /** ARN of the execution whose history should be fetched. */
    executionArn: string;
    /** Page size passed to `GetExecutionHistory`. Defaults to 1000 (the AWS max). */
    maxResults?: number;
}

/**
 * Fetches the complete history of a Step Functions execution, following every
 * `nextToken` page, using a `GetExecutionHistoryCommand` class the caller supplies.
 *
 * @param params - The command class, SFN client, execution ARN, and optional page size.
 * @returns All history events for the execution, in chronological order.
 *
 * @example
 * ```ts
 * const sfn = await import('@aws-sdk/client-sfn');
 * const events = await paginateExecutionHistory({
 *     GetExecutionHistoryCommand: sfn.GetExecutionHistoryCommand,
 *     client: new sfn.SFNClient({ region: 'us-east-1' }),
 *     executionArn,
 * });
 * ```
 */
export async function paginateExecutionHistory(
    params: PaginateExecutionHistoryParams,
): Promise<HistoryEvent[]> {
    const {
        GetExecutionHistoryCommand,
        client,
        executionArn,
        maxResults = 1000,
    } = params;

    const events: HistoryEvent[] = [];
    let nextToken: string | undefined;

    do {
        const page = await client.send(
            new GetExecutionHistoryCommand({
                executionArn,
                maxResults,
                nextToken,
            }),
        );
        events.push(...(page.events ?? []));
        nextToken = page.nextToken;
    } while (nextToken);

    return events;
}
