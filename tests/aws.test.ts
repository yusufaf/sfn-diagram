import { describe, expect, it, vi } from 'vitest';
import type {
    GetExecutionHistoryCommandOutput,
    HistoryEvent,
    SFNClient,
} from '@aws-sdk/client-sfn';
import { fetchExecutionHistory } from '../src/aws';

/**
 * Builds a fake SFNClient whose `send` returns the supplied pages in order,
 * echoing back the `nextToken`/`maxResults` it was called with so the test can
 * assert the pagination loop behaves.
 */
function makeClient(pages: Array<{ events: HistoryEvent[]; nextToken?: string }>) {
    const sentInputs: Array<{ maxResults?: number; nextToken?: string }> = [];
    let call = 0;
    const send = vi.fn(async (command: { input: { maxResults?: number; nextToken?: string } }) => {
        sentInputs.push({ ...command.input });
        const page = pages[call++];
        return {
            events: page.events,
            nextToken: page.nextToken,
        } as GetExecutionHistoryCommandOutput;
    });
    return { client: { send } as unknown as SFNClient, sentInputs, send };
}

const event = (id: number): HistoryEvent =>
    ({ id, type: 'PassStateEntered' }) as unknown as HistoryEvent;

describe('fetchExecutionHistory', () => {
    it('returns events from a single page when there is no nextToken', async () => {
        const { client, send } = makeClient([{ events: [event(1), event(2)] }]);

        const events = await fetchExecutionHistory({
            client,
            executionArn: 'arn:aws:states:us-east-1:123:execution:sm:run',
        });

        expect(events).toEqual([event(1), event(2)]);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('paginates through every page and concatenates events in order', async () => {
        const { client, sentInputs, send } = makeClient([
            { events: [event(1)], nextToken: 'token-1' },
            { events: [event(2)], nextToken: 'token-2' },
            { events: [event(3)] },
        ]);

        const events = await fetchExecutionHistory({
            client,
            executionArn: 'arn:aws:states:us-east-1:123:execution:sm:run',
        });

        expect(events).toEqual([event(1), event(2), event(3)]);
        expect(send).toHaveBeenCalledTimes(3);
        expect(sentInputs.map((input) => input.nextToken)).toEqual([
            undefined,
            'token-1',
            'token-2',
        ]);
    });

    it('defaults maxResults to 1000 and forwards a custom value', async () => {
        const defaultCase = makeClient([{ events: [] }]);
        await fetchExecutionHistory({
            client: defaultCase.client,
            executionArn: 'arn:aws:states:us-east-1:123:execution:sm:run',
        });
        expect(defaultCase.sentInputs[0].maxResults).toBe(1000);

        const customCase = makeClient([{ events: [] }]);
        await fetchExecutionHistory({
            client: customCase.client,
            executionArn: 'arn:aws:states:us-east-1:123:execution:sm:run',
            maxResults: 50,
        });
        expect(customCase.sentInputs[0].maxResults).toBe(50);
    });

    it('tolerates a page with no events array', async () => {
        const { client } = makeClient([{ events: undefined as unknown as HistoryEvent[] }]);

        const events = await fetchExecutionHistory({
            client,
            executionArn: 'arn:aws:states:us-east-1:123:execution:sm:run',
        });

        expect(events).toEqual([]);
    });
});
