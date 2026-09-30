import { describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import { followExecution } from '../src/cliFollow';

/** A history whose last event is terminal, so the loop should stop on it. */
const terminal: HistoryEvent[] = [
    { id: 1, timestamp: new Date(0), type: 'ExecutionStarted' },
    { id: 2, timestamp: new Date(1000), type: 'ExecutionSucceeded' },
];

/** A history with no terminal event, so the loop should keep going. */
const running: HistoryEvent[] = [
    { id: 1, timestamp: new Date(0), type: 'ExecutionStarted' },
];

/**
 * A sleep that resolves immediately but records what it was asked to wait, so the
 * loop's pacing is asserted without any real timer.
 */
function recordingSleep() {
    const waits: number[] = [];
    return {
        sleep: async ({ ms }: { ms: number }) => {
            waits.push(ms);
            await Promise.resolve();
        },
        waits,
    };
}

describe('followExecution', () => {
    it('renders once and stops when the history is already terminal', async () => {
        const { sleep, waits } = recordingSleep();
        const render = vi.fn().mockResolvedValue(0);
        const fetchHistory = vi.fn().mockResolvedValue(terminal);

        const result = await followExecution({
            fetchHistory,
            intervalMs: 2000,
            render,
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(result).toMatchObject({
            exitCode: 0,
            outcome: 'completed',
            status: 'succeeded',
        });
        expect(fetchHistory).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
        // Nothing to wait for: it never polls a second time.
        expect(waits).toEqual([]);
    });

    it('keeps polling while the execution is running, then renders the final state', async () => {
        const { sleep, waits } = recordingSleep();
        const render = vi.fn().mockResolvedValue(0);
        const fetchHistory = vi
            .fn()
            .mockResolvedValueOnce(running)
            .mockResolvedValueOnce(running)
            .mockResolvedValueOnce(terminal);

        const result = await followExecution({
            fetchHistory,
            intervalMs: 2000,
            render,
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(result.outcome).toBe('completed');
        expect(result.status).toBe('succeeded');
        expect(fetchHistory).toHaveBeenCalledTimes(3);
        expect(render).toHaveBeenCalledTimes(3);
        expect(waits).toEqual([2000, 2000]);
    });

    it('reports a failed execution as completed, not as an error', async () => {
        // The execution failed; following it did not. The exit code is the render's.
        const failed: HistoryEvent[] = [
            { id: 1, timestamp: new Date(0), type: 'ExecutionStarted' },
            { id: 2, timestamp: new Date(1), type: 'ExecutionFailed' },
        ];
        const { sleep } = recordingSleep();

        const result = await followExecution({
            fetchHistory: vi.fn().mockResolvedValue(failed),
            intervalMs: 1,
            render: vi.fn().mockResolvedValue(0),
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(result).toMatchObject({ outcome: 'completed', status: 'failed' });
    });

    it('passes each tick the events it fetched', async () => {
        const { sleep } = recordingSleep();
        const render = vi.fn().mockResolvedValue(0);

        await followExecution({
            fetchHistory: vi
                .fn()
                .mockResolvedValueOnce(running)
                .mockResolvedValueOnce(terminal),
            intervalMs: 1,
            render,
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(render.mock.calls[0][0]).toMatchObject({ events: running });
        expect(render.mock.calls[1][0]).toMatchObject({ events: terminal });
    });

    it('stops when the signal aborts, after the tick in flight finishes', async () => {
        const controller = new AbortController();
        const render = vi.fn().mockResolvedValue(0);
        // Abort during the wait, the way Ctrl-C would land between polls.
        const sleep = async () => {
            controller.abort();
            await Promise.resolve();
        };

        const result = await followExecution({
            fetchHistory: vi.fn().mockResolvedValue(running),
            intervalMs: 2000,
            render,
            signal: controller.signal,
            sleep,
            timeoutMs: null,
        });

        expect(result.outcome).toBe('aborted');
        expect(result.status).toBe('running');
        // The render that had already happened still counts: the file on disk is valid.
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('does not fetch at all when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchHistory = vi.fn().mockResolvedValue(running);

        const result = await followExecution({
            fetchHistory,
            intervalMs: 1,
            render: vi.fn().mockResolvedValue(0),
            signal: controller.signal,
            sleep: recordingSleep().sleep,
            timeoutMs: null,
        });

        expect(result.outcome).toBe('aborted');
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it('times out on a run that never finishes', async () => {
        let now = 0;
        const result = await followExecution({
            fetchHistory: vi.fn().mockResolvedValue(running),
            intervalMs: 1000,
            now: () => now,
            render: vi.fn().mockResolvedValue(0),
            signal: new AbortController().signal,
            sleep: async ({ ms }: { ms: number }) => {
                now += ms;
                await Promise.resolve();
            },
            timeoutMs: 3000,
        });

        expect(result.outcome).toBe('timedOut');
        expect(result.status).toBe('running');
    });

    it('reports the exit code of the render that ended the loop', async () => {
        const { sleep } = recordingSleep();
        const result = await followExecution({
            fetchHistory: vi
                .fn()
                .mockResolvedValueOnce(running)
                .mockResolvedValueOnce(terminal),
            intervalMs: 1,
            render: vi
                .fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0),
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(result.exitCode).toBe(1);
    });

    it('stops polling once a render has failed, rather than rewriting forever', async () => {
        // A render that cannot write (a bad path, a full disk) will not start working
        // on the next tick, and a loop that ignores it spins until the execution ends.
        const { sleep } = recordingSleep();
        const fetchHistory = vi.fn().mockResolvedValue(running);

        const result = await followExecution({
            fetchHistory,
            intervalMs: 1,
            render: vi.fn().mockResolvedValue(1),
            signal: new AbortController().signal,
            sleep,
            timeoutMs: null,
        });

        expect(result.exitCode).toBe(1);
        expect(fetchHistory).toHaveBeenCalledTimes(1);
    });

    it('lets a fetch failure escape, so the CLI maps it to one exit code', async () => {
        const { sleep } = recordingSleep();
        await expect(
            followExecution({
                fetchHistory: vi.fn().mockRejectedValue(new Error('Throttling')),
                intervalMs: 1,
                render: vi.fn().mockResolvedValue(0),
                signal: new AbortController().signal,
                sleep,
                timeoutMs: null,
            }),
        ).rejects.toThrow('Throttling');
    });
});
