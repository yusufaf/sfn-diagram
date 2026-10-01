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

/** Parameters for {@link createAbortableSleep}. */
export interface CreateAbortableSleepParams {
    /** Aborting it resolves any wait in flight, and any wait started afterwards. */
    signal: AbortSignal;
}

/**
 * Build the wait {@link followExecution} uses, which gives up the moment the signal
 * aborts.
 *
 * Two mistakes are easy here and both were made before this was extracted and tested:
 *
 * - `addEventListener('abort', …)` on a signal that has **already** aborted never
 *   fires. Ctrl-C lands during the fetch or the render — which is where the time
 *   actually goes — so by the time the loop sleeps the signal is usually already
 *   aborted, and a listener-only implementation waited out the whole interval with
 *   Ctrl-C looking dead. Worse, installing a SIGINT handler suppresses Node's own
 *   terminate, so pressing it again did nothing either. Hence the eager check.
 * - `{ once: true }` only removes a listener that *fires*. On a wait that completes
 *   normally the closure stayed attached, so a long run retained one per tick. Hence
 *   the explicit `removeEventListener`.
 *
 * @param params - The signal that cancels waiting.
 *
 * @returns A sleep that resolves after `ms`, or immediately once aborted.
 *
 * @example
 * ```typescript
 * const sleep = createAbortableSleep({ signal: controller.signal });
 * await sleep({ ms: 2000 });
 * ```
 */
export function createAbortableSleep(
    params: CreateAbortableSleepParams,
): (waitParams: { ms: number }) => Promise<void> {
    const { signal } = params;
    return ({ ms }) =>
        new Promise<void>((done) => {
            if (signal.aborted) {
                done();
                return;
            }
            // Two paths, two responsibilities: `{ once: true }` retires the
            // listener when abort fires, and the timer path retires it explicitly,
            // because a wait that simply completes would otherwise keep its closure.
            const onAbort = (): void => {
                clearTimeout(timer);
                done();
            };
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                done();
            }, ms);
            signal.addEventListener('abort', onAbort, { once: true });
        });
}

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
    let rendered = false;

    while (!signal.aborted) {
        // Checked here rather than before the sleep, and the sleep below is capped to
        // what is left, so the budget bounds the *fetching* and not just the waiting.
        // Checking it only after a render let a long interval run one more fetch and
        // render well past the deadline, which is the opposite of the guarantee.
        // `rendered` keeps the first pass unconditional: a budget shorter than one
        // tick should still draw the state once rather than produce nothing.
        if (
            rendered &&
            timeoutMs !== null &&
            now() - startedAt >= timeoutMs
        ) {
            return { exitCode: 0, outcome: 'timedOut', status };
        }

        const events = await fetchHistory();
        status = parseExecutionHistory({ events }).executionStatus;

        const exitCode = await render({ events });
        rendered = true;
        if (exitCode !== 0) return { exitCode, outcome: 'completed', status };

        if (status !== 'running') {
            return { exitCode: 0, outcome: 'completed', status };
        }

        const remaining =
            timeoutMs === null
                ? intervalMs
                : Math.min(intervalMs, timeoutMs - (now() - startedAt));
        await sleep({ ms: Math.max(0, remaining) });
    }

    return { exitCode: 0, outcome: 'aborted', status };
}
