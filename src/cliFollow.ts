/**
 * @module
 *
 * The `--follow` poll loop for `sfn-diagram --execution <arn> --follow`.
 *
 * Kept apart from `src/cli.ts` and given its clock, its sleep and its fetch as
 * parameters, so the loop's pacing, its stop conditions and its exit codes are
 * tested without a real timer, a real client or a real execution.
 *
 * The loop re-fetches and re-projects the **whole** history each tick rather than
 * appending new pages. That is deliberate: `parseExecutionHistory` is a single
 * forward pass that walks `previousEventId` back through `eventById` and pairs each
 * `*StateEntered` with its `*StateExited` (`src/execution.ts:475`, `:660`), so a
 * partial history silently loses edges and durations. A full re-fetch keeps the
 * projection pure and the rendering deterministic, and a Step Functions history is
 * small enough that re-reading it every couple of seconds is cheaper than the bugs
 * an incremental path would buy.
 */
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import type { ExecutionStatus } from './types';
import { parseExecutionHistory } from './execution';

/** Why the loop stopped. */
export type FollowOutcome =
    /** The caller's signal fired — Ctrl-C between ticks. */
    | 'aborted'
    /**
     * The loop reached a definite end: the execution hit a terminal status, or a
     * render failed and retrying it could not help.
     */
    | 'completed'
    /** `--follow-timeout` elapsed while the execution was still running. */
    | 'timedOut';

/** Parameters for {@link followExecution}. */
export interface FollowExecutionParams {
    /** Fetch the complete history. Called once per tick; failures are not caught. */
    fetchHistory: () => Promise<HistoryEvent[]>;
    /** Milliseconds to wait between ticks. */
    intervalMs: number;
    /** The clock, injected so a timeout is testable. Defaults to `Date.now`. */
    now?: () => number;
    /** Render one tick's history. Resolves to that render's exit code. */
    render: (params: { events: HistoryEvent[] }) => Promise<number>;
    /** Aborted to stop the loop between ticks, e.g. on SIGINT. */
    signal: AbortSignal;
    /** Wait, injected so the loop needs no real timer under test. */
    sleep: (params: { ms: number }) => Promise<void>;
    /** Wall-clock budget in milliseconds, or `null` for none. */
    timeoutMs: number | null;
}

/** What {@link followExecution} observed by the time it stopped. */
export interface FollowExecutionResult {
    /** Why the loop stopped. */
    outcome: FollowOutcome;
    /** The execution's status as of the last history fetched. */
    status: ExecutionStatus;
    /**
     * The exit code of the render that ended the loop, or `0`.
     *
     * Not an accumulator: a failed render stops the loop, so there is never more
     * than one non-zero code to keep.
     */
    exitCode: number;
}

/**
 * Poll an execution's history, re-rendering after each fetch, until it finishes.
 *
 * The stop condition comes free from the history itself: `parseExecutionHistory`
 * starts at `'running'` and only a terminal event moves it (`src/execution.ts:397`,
 * `:813`), so no `DescribeExecution` call is needed to know when to stop.
 *
 * A render that fails ends the loop rather than being retried: whatever stopped it
 * writing — a bad path, a full disk — will not fix itself on the next tick, and a
 * loop that ignores it spins until the execution ends.
 *
 * @param params - The fetch, the render, the pacing and the stop conditions.
 *
 * @returns The outcome, the last status seen, and the exit code of the render that
 *   ended the loop.
 *
 * @throws Whatever `fetchHistory` throws, unwrapped, so the caller maps one AWS
 *   failure to one exit code rather than this loop inventing a second policy.
 *
 * @example
 * ```typescript
 * const { exitCode, outcome } = await followExecution({
 *     fetchHistory: () => fetchExecutionHistoryForArn({ arn }),
 *     intervalMs: 2000,
 *     render: ({ events }) => renderTick({ events }),
 *     signal: controller.signal,
 *     sleep: ({ ms }) => new Promise((done) => setTimeout(done, ms)),
 *     timeoutMs: null,
 * });
 * ```
 */
export async function followExecution(
    params: FollowExecutionParams,
): Promise<FollowExecutionResult> {
    const {
        fetchHistory,
        intervalMs,
        now = Date.now,
        render,
        signal,
        sleep,
        timeoutMs,
    } = params;

    const startedAt = now();
    let status: ExecutionStatus = 'running';

    while (!signal.aborted) {
        const events = await fetchHistory();
        status = parseExecutionHistory({ events }).executionStatus;

        const exitCode = await render({ events });
        if (exitCode !== 0) return { exitCode, outcome: 'completed', status };

        if (status !== 'running') {
            return { exitCode: 0, outcome: 'completed', status };
        }

        // Checked after the render, so a run that is already over is drawn once and
        // never waits, and a timeout still leaves the latest state on disk.
        if (timeoutMs !== null && now() - startedAt >= timeoutMs) {
            return { exitCode: 0, outcome: 'timedOut', status };
        }

        await sleep({ ms: intervalMs });
    }

    return { exitCode: 0, outcome: 'aborted', status };
}
