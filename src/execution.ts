import type { HistoryEvent, HistoryEventType } from '@aws-sdk/client-sfn';
import type {
    AslDefinition,
    EdgeStyleOverride,
    ExecutionHistoryInput,
    ExecutionMetadataSummary,
    ExecutionOutput,
    ExecutionOverlay,
    ExecutionStateResult,
    ExecutionStateStatus,
    ExecutionStatus,
    ExecutionSummary,
    ExecutionTimeline,
    GenerateExecutionParams,
    GenerateMermaidExecutionParams,
    GraphEdge,
    MermaidExecutionOutput,
    NodeStyle,
    StateNode,
    TimelineEntry,
    TimelineEntryStatus,
} from './types';
import { parseAsl, parseAslSource } from './AslParser';
import {
    buildIdResolver,
    computeCollapsePlan,
    EXECUTION_COLORS,
    getMapProcessor,
    styleCollapsedView,
} from './graph';
import type { IdResolver, ScopePath } from './graph';
import { buildDiagramGraph, renderSvgGraph } from './pipeline';
import { MermaidRenderer } from './renderers';
import { mergeOptions, mergeRecordOptions } from './config';


/** Emphasis applied to edges the execution followed. */
const TAKEN_EDGE_STYLE: EdgeStyleOverride = { stroke: '#2e7d32', strokeWidth: 3 };
/** Dimming applied to edges the execution did not follow. */
const UNTAKEN_EDGE_STYLE: EdgeStyleOverride = { strokeOpacity: 0.2 };

/** Task-level events that count as a failed attempt of the active state. */
const FAILURE_EVENT_TYPES = new Set<string>([
    'ActivityFailed',
    'ActivityScheduleFailed',
    'ActivityTimedOut',
    'EvaluationFailed',
    'LambdaFunctionFailed',
    'LambdaFunctionScheduleFailed',
    'LambdaFunctionStartFailed',
    'LambdaFunctionTimedOut',
    'TaskFailed',
    'TaskStartFailed',
    'TaskSubmitFailed',
    'TaskTimedOut',
]);

/** What a container-level failure event says about the frame it belongs to. */
interface ContainerFailureEvent {
    /** The `*StateEntered` type of the frame this event's failure belongs to. */
    enteredType: HistoryEventType;
    /**
     * Whether this event ends the container's attempt. `MapRunFailed` does not — the
     * `MapStateFailed` that follows it does — so the two are not counted twice and a
     * nested container's failure is not mistaken for its parent's.
     */
    terminal: boolean;
}

/**
 * Container-level failure events, mapped to the frame each one belongs to. A Parallel
 * branch or Map iteration that fails emits its own leaf failure and then one of these,
 * but the leaf never emits a `StateExited` — so the container failure is the only event
 * that can close those leaves.
 *
 * Keyed by {@link HistoryEventType} rather than by bare strings so a name AWS does not
 * emit (there is no `ParallelFailed`; it is `ParallelStateFailed`) fails to compile
 * instead of silently never matching.
 *
 * `MapIterationFailed` is deliberately absent: a Map with `MaxConcurrency > 1` runs
 * iterations in parallel, so one iteration's failure says nothing about the leaves of
 * the iterations still in flight.
 */
const CONTAINER_FAILURE_EVENT_TYPES: ReadonlyMap<string, ContainerFailureEvent> = new Map<
    HistoryEventType,
    ContainerFailureEvent
>([
    ['MapRunFailed', { enteredType: 'MapStateEntered', terminal: false }],
    ['MapStateFailed', { enteredType: 'MapStateEntered', terminal: true }],
    ['ParallelStateFailed', { enteredType: 'ParallelStateEntered', terminal: true }],
]);

/**
 * Events that (re)start a container's attempt, mapped to the frame they belong to.
 * They clear the failure bookkeeping {@link CONTAINER_FAILURE_EVENT_TYPES} sets, so a
 * container with a `Retry` records each failed attempt rather than only the first.
 */
const CONTAINER_START_EVENT_TYPES: ReadonlyMap<string, HistoryEventType> = new Map<
    HistoryEventType,
    HistoryEventType
>([
    ['MapRunStarted', 'MapStateEntered'],
    ['MapStateStarted', 'MapStateEntered'],
    ['ParallelStateStarted', 'ParallelStateEntered'],
]);

/**
 * Task-level events that begin an attempt. A `Retry` re-schedules the same state
 * without re-entering it, so after the previous attempt failed one of these is where
 * the next one starts. Enumerated rather than matched on a `Scheduled` / `Started`
 * suffix, which would also catch the container and iteration lifecycle events.
 */
const ATTEMPT_START_EVENT_TYPES = new Set<string>([
    'ActivityScheduled',
    'ActivityStarted',
    'LambdaFunctionScheduled',
    'LambdaFunctionStarted',
    'TaskScheduled',
    'TaskStarted',
    'TaskSubmitted',
]);

/** Task-level events that mark the active state's latest attempt as successful. */
const SUCCESS_EVENT_TYPES = new Set<string>([
    'ActivitySucceeded',
    'LambdaFunctionSucceeded',
    'TaskSucceeded',
]);

/** Boundary events that stop taken-edge back-walking (crossing a nesting boundary). */
const EDGE_WALK_BOUNDARY_TYPES = new Set<string>([
    'ExecutionStarted',
    'MapIterationStarted',
    'MapStateStarted',
    'ParallelStateStarted',
]);

/** Convert an AWS timestamp (Date | ISO string | epoch number) to epoch milliseconds. */
function toMillis(timestamp: unknown): number | undefined {
    if (timestamp instanceof Date) return timestamp.getTime();
    if (typeof timestamp === 'number') return timestamp;
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

/** Normalize the accepted input forms into an ordered HistoryEvent[]. */
function normalizeEvents(input: ExecutionHistoryInput): HistoryEvent[] {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    const events: HistoryEvent[] = Array.isArray(value)
        ? value
        : (value?.events ?? []);
    // AWS returns events ordered, but sort by id defensively so causal walks are safe.
    return [...events].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** The state name carried by an entered/exited event, if any. */
function enteredName(event: HistoryEvent): string | undefined {
    return event.stateEnteredEventDetails?.name;
}
function exitedName(event: HistoryEvent): string | undefined {
    return event.stateExitedEventDetails?.name;
}

/** Extract an error name from any of the failure detail shapes on an event. */
function extractError(event: HistoryEvent): string | undefined {
    return (
        event.taskFailedEventDetails?.error ??
        event.lambdaFunctionFailedEventDetails?.error ??
        event.activityFailedEventDetails?.error ??
        event.executionFailedEventDetails?.error ??
        event.taskTimedOutEventDetails?.error ??
        event.lambdaFunctionTimedOutEventDetails?.error ??
        event.evaluationFailedEventDetails?.error ??
        event.mapRunFailedEventDetails?.error ??
        undefined
    );
}

/** Per-open-entry bookkeeping, pushed on enter and folded into the result on exit. */
interface OpenFrame {
    /** Runs started directly inside this container that began a branch or an iteration. */
    childStarts: number;
    enteredMs?: number;
    /** Id of the `*StateEntered` event that opened this frame, for correlating its events. */
    enteredEventId?: number;
    /** The `*StateEntered` event type that opened this frame, e.g. `ParallelStateEntered`. */
    enteredType: string;
    error?: string;
    /**
     * Set once a container frame has absorbed the failure that ends its attempt, so a
     * further container failure resolves to the frame *outside* it rather than matching
     * this one again — a nested container that failed uncaught never exits, and its
     * frame would otherwise shadow its parent's.
     */
    failureClosed?: boolean;
    /** Set once this attempt's failure has been counted, so two events cannot count it twice. */
    failureCounted?: boolean;
    failures: number;
    /** Index in `entries` of this frame's most recent run, open or closed. */
    lastEntryIndex: number;
    lastOutcome?: 'failure' | 'success';
    name: string;
    /** Graph node id this frame's state renders as. */
    nodeId: string;
    /** Index in `entries` of this frame's open run, or undefined between attempts. */
    openEntryIndex?: number;
}

/** The entered-event types that open a container frame (a Parallel or a Map). */
const CONTAINER_ENTERED_TYPES = new Set<string>(['MapStateEntered', 'ParallelStateEntered']);

/**
 * For each container node id, the scope its children live in, keyed by child state name.
 *
 * An execution history names the state that was entered but not the branch or iterator
 * it belongs to, so a name that repeats across scopes cannot be resolved from the event
 * alone. Walking the definition once gives the missing half: the innermost container
 * still open at that moment says which scope a child name was entered in, and the
 * resolver turns that pair into the node id the renderer stamps as `data-state-id`.
 *
 * A name declared in more than one branch of the same container keeps the first
 * branch's scope — the history genuinely cannot say which one ran, the same limitation
 * {@link byNodeId} documents for the overlay.
 */
function buildChildScopes(params: {
    definition: AslDefinition;
    resolver: IdResolver;
}): Map<string, Map<string, ScopePath>> {
    const { definition, resolver } = params;
    const childScopes = new Map<string, Map<string, ScopePath>>();

    const visit = (current: AslDefinition, scope: ScopePath): void => {
        for (const [stateName, state] of Object.entries(current.States)) {
            const containerId = resolver.resolve(scope, stateName);
            const record = (child: AslDefinition, childScope: ScopePath): void => {
                const scopesByName = childScopes.get(containerId) ?? new Map<string, ScopePath>();
                for (const childName of Object.keys(child.States)) {
                    if (!scopesByName.has(childName)) scopesByName.set(childName, childScope);
                }
                childScopes.set(containerId, scopesByName);
                visit(child, childScope);
            };

            if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
                state.Branches.forEach((branch, index) =>
                    record(branch, resolver.branchScope(scope, stateName, index))
                );
            }
            if (state.Type === 'Map') {
                const processor = getMapProcessor(state);
                if (processor) record(processor, resolver.processorScope(scope, stateName));
            }
        }
    };
    visit(definition, '');

    return childScopes;
}

/** Merge a per-entry outcome into the aggregated status (failed > caught > succeeded). */
function mergeStatus(
    current: ExecutionStateStatus | undefined,
    incoming: ExecutionStateStatus,
): ExecutionStateStatus {
    const rank: Record<ExecutionStateStatus, number> = {
        failed: 4,
        caught: 3,
        running: 2,
        succeeded: 1,
        notReached: 0,
    };
    if (!current) return incoming;
    return rank[incoming] > rank[current] ? incoming : current;
}

/** What one pass over a history yields: both derived models, from the one frame walk. */
interface ExecutionWalk {
    /** The aggregated per-state model. */
    overlay: ExecutionOverlay;
    /**
     * The resolver the walk built, so a caller re-keying by node id need not build a
     * second one. Absent only when no definition was supplied to resolve against.
     */
    resolver?: IdResolver;
    /** The same run as an ordered list of individual state runs. */
    timeline: ExecutionTimeline;
}

/**
 * Walk a history once, building both the aggregated {@link ExecutionOverlay} and the
 * ordered {@link ExecutionTimeline} from the same frame stack.
 *
 * One walk rather than two: the two models differ only in how they fold the same
 * events — the overlay sums a state's runs into one result, the timeline keeps each
 * run — so deriving them separately would mean two copies of the frame bookkeeping
 * that has to agree on what a retry, a caught failure and an abandoned leaf mean.
 */
function walkExecutionHistory(params: {
    definition?: AslDefinition;
    events: HistoryEvent[];
}): ExecutionWalk {
    const { definition, events } = params;
    const eventById = new Map<number, HistoryEvent>();
    for (const event of events) {
        if (event.id !== undefined) eventById.set(event.id, event);
    }

    const results: Record<string, ExecutionStateResult> = {};
    const openStack: OpenFrame[] = [];
    const takenSet = new Set<string>();
    const takenEdges: ExecutionOverlay['takenEdges'] = [];
    const entries: TimelineEntry[] = [];
    let executionStatus: ExecutionStatus = 'running';
    let startState: string | undefined;

    // Node ids need the definition: a history names a state but not the branch or
    // iterator it ran in. Without one the state name stands in as the id, which is
    // exactly what it is for any definition whose names do not repeat across scopes.
    const resolver = definition ? buildIdResolver({ definition }) : undefined;
    const childScopes =
        definition && resolver ? buildChildScopes({ definition, resolver }) : undefined;

    // Timestamps are optional on a HistoryEvent, so an entry with no timestamp of its
    // own inherits the last one seen. The timeline then stays monotonic and a scrubber
    // never has to handle a gap.
    let lastKnownMs = 0;
    let startMs: number | undefined;
    const eventMs = (event: HistoryEvent): number => {
        const millis = toMillis(event.timestamp);
        if (millis !== undefined) {
            lastKnownMs = millis;
            // The first *known* timestamp, not the first event: an `ExecutionStarted`
            // with no timestamp would otherwise anchor the run at the epoch and stretch
            // a scrubber's span over fifty years.
            if (startMs === undefined) startMs = millis;
        }
        return lastKnownMs;
    };

    /** Walk previousEventId back to the nearest completed predecessor state. */
    const findFromState = (event: HistoryEvent): string | undefined => {
        let cursorId = event.previousEventId;
        const seen = new Set<number>();
        while (cursorId !== undefined && !seen.has(cursorId)) {
            seen.add(cursorId);
            const prev = eventById.get(cursorId);
            if (!prev || !prev.type) return undefined;
            if (prev.type.endsWith('StateExited')) return exitedName(prev);
            // Stop before crossing a nesting boundary or an unfinished predecessor.
            if (prev.type.endsWith('StateEntered')) return undefined;
            if (EDGE_WALK_BOUNDARY_TYPES.has(prev.type)) return undefined;
            cursorId = prev.previousEventId;
        }
        return undefined;
    };

    const ensure = (name: string): ExecutionStateResult => {
        if (!results[name]) results[name] = { attempts: 0, status: 'succeeded' };
        return results[name];
    };

    /** Index of the innermost open frame matching `predicate`, or -1. */
    const findFrameIndex = (predicate: (frame: OpenFrame) => boolean): number => {
        for (let i = openStack.length - 1; i >= 0; i--) {
            if (predicate(openStack[i])) return i;
        }
        return -1;
    };

    /**
     * The open frame an event belongs to, by walking `previousEventId` back to the
     * `*StateEntered` that opened it.
     *
     * The innermost open frame is not it. Under a Parallel or a concurrent Map every
     * branch or iteration in flight has a frame on the stack at once, and their events
     * interleave — so a sibling's `TaskSucceeded` would otherwise be credited to
     * whichever state happened to be entered last. The history's own causal chain says
     * which state an event belongs to; the stack top is only a fallback for a history
     * that does not carry one.
     */
    const frameForEvent = (event: HistoryEvent): OpenFrame | undefined => {
        let cursorId = event.previousEventId;
        const seen = new Set<number>();
        while (cursorId !== undefined && !seen.has(cursorId)) {
            seen.add(cursorId);
            const owner = openStack.find((frame) => frame.enteredEventId === cursorId);
            if (owner) return owner;
            const prev = eventById.get(cursorId);
            if (!prev?.type) return undefined;
            // Reaching another state's boundary means the chain left this run entirely.
            if (prev.type.endsWith('StateEntered') || prev.type.endsWith('StateExited')) {
                return undefined;
            }
            if (EDGE_WALK_BOUNDARY_TYPES.has(prev.type)) return undefined;
            cursorId = prev.previousEventId;
        }
        return undefined;
    };

    /** The innermost open container frame — the scope anything entered now belongs to. */
    const openContainer = (): OpenFrame | undefined => {
        const index = findFrameIndex((frame) => CONTAINER_ENTERED_TYPES.has(frame.enteredType));
        return index >= 0 ? openStack[index] : undefined;
    };

    /** Stamp a container entry with the branches or iterations its run started. */
    const stampChildCount = (frame: OpenFrame, entry: TimelineEntry): void => {
        if (frame.enteredType === 'ParallelStateEntered') entry.branchCount = frame.childStarts;
        if (frame.enteredType === 'MapStateEntered') entry.iterationCount = frame.childStarts;
    };

    /** Begin a run of this frame's state, at `attempt`, and record it as the open entry. */
    const openEntry = (
        frame: OpenFrame,
        ms: number,
        attempt: number,
        fromNodeId?: string
    ): void => {
        frame.childStarts = 0;
        frame.lastEntryIndex = entries.length;
        frame.openEntryIndex = entries.length;
        entries.push({
            attempt,
            enteredMs: ms,
            ...(fromNodeId !== undefined ? { fromNodeId } : {}),
            nodeId: frame.nodeId,
            stateName: frame.name,
            status: 'running',
        });
    };

    /** End this frame's open run, if it has one. */
    const closeEntry = (
        frame: OpenFrame,
        ms: number,
        status: TimelineEntryStatus,
        error?: string
    ): void => {
        if (frame.openEntryIndex === undefined) return;
        const entry = entries[frame.openEntryIndex];
        entry.exitedMs = ms;
        entry.status = status;
        if (error !== undefined && entry.error === undefined) entry.error = error;
        stampChildCount(frame, entry);
        frame.openEntryIndex = undefined;
    };

    /** Fold a frame that never exited into its result as a failed run. */
    const closeAsFailed = (frame: OpenFrame, ms: number, fallbackError?: string): void => {
        const result = ensure(frame.name);
        result.status = mergeStatus(result.status, 'failed');
        result.attempts += Math.max(frame.failures, 1);
        const error = frame.error ?? fallbackError;
        if (error && !result.error) result.error = error;
        closeEntry(frame, ms, 'failed', error);
    };

    for (const event of events) {
        const type = event.type ?? '';
        const nowMs = eventMs(event);

        // --- State entered ---
        if (type.endsWith('StateEntered')) {
            const name = enteredName(event);
            if (!name) continue;
            if (!startState) startState = name;
            ensure(name);

            // Resolved against the container still open around it, so a name that
            // repeats across branches maps to the node that actually ran.
            const parent = openContainer();
            const scope = parent ? (childScopes?.get(parent.nodeId)?.get(name) ?? '') : '';
            const frame: OpenFrame = {
                childStarts: 0,
                enteredEventId: event.id,
                enteredMs: toMillis(event.timestamp),
                enteredType: type,
                failures: 0,
                lastEntryIndex: -1,
                name,
                nodeId: resolver ? resolver.resolve(scope, name) : name,
            };
            openStack.push(frame);

            // `from === name` is a genuine self-transition (e.g. a Choice polling
            // itself), not a Task retry re-entry: findFromState only resolves a name
            // after walking back to a StateExited event, and a retry attempt never
            // re-emits StateEntered for the same state. So it belongs in takenEdges
            // just like any other transition.
            const from = findFromState(event);
            if (from) {
                const key = `${from}->${name}`;
                if (!takenSet.has(key)) {
                    takenSet.add(key);
                    takenEdges.push({ from, to: name });
                }
            }
            openEntry(
                frame,
                nowMs,
                1,
                from !== undefined && resolver ? resolver.resolve(scope, from) : from
            );
            // No predecessor inside the container means this run began a branch or an
            // iteration — the only count of them the history offers, since neither
            // `ParallelStateStarted` nor `MapRunStarted` carries one.
            if (parent && from === undefined) parent.childStarts += 1;

            // Fail states are terminal and never emit a StateExited.
            if (type === 'FailStateEntered') {
                const result = ensure(name);
                result.status = 'failed';
                result.attempts = Math.max(result.attempts, 1);
                closeEntry(frame, nowMs, 'failed');
            }
            continue;
        }

        // --- State exited ---
        if (type.endsWith('StateExited')) {
            const name = exitedName(event);
            if (!name) continue;
            // Pop the frame this exit belongs to. Two concurrent runs of one state - a
            // Map with `MaxConcurrency > 1`, or a name live in two branches - both sit
            // on the stack under the same name, so matching by name alone would close
            // whichever was entered last and stamp its window on the wrong run.
            const owner = frameForEvent(event);
            const frameIndex =
                owner?.name === name
                    ? openStack.indexOf(owner)
                    : findFrameIndex((candidate) => candidate.name === name);
            const frame = frameIndex >= 0 ? openStack.splice(frameIndex, 1)[0] : undefined;
            const result = ensure(name);

            const exitMs = toMillis(event.timestamp);
            if (frame?.enteredMs !== undefined && exitMs !== undefined) {
                result.durationMs = (result.durationMs ?? 0) + (exitMs - frame.enteredMs);
            }
            // A state that exits after a failure was caught (routed via a Catch);
            // otherwise it succeeded. Attempts = failed tries + the final successful
            // try (a caught exit has no successful try, so no +1).
            const wasCaught = frame?.lastOutcome === 'failure';
            const failures = frame?.failures ?? 0;
            result.attempts += Math.max(failures + (wasCaught ? 0 : 1), 1);
            result.status = mergeStatus(result.status, wasCaught ? 'caught' : 'succeeded');
            if (frame?.error && !result.error) result.error = frame.error;
            if (frame) {
                if (frame.openEntryIndex !== undefined) {
                    closeEntry(frame, exitMs ?? nowMs, 'succeeded');
                } else if (frame.lastEntryIndex >= 0 && wasCaught) {
                    // The attempt was already closed as `failed` when it errored; the
                    // exit is what reveals a Catch handled it. Its `exitedMs` stays at
                    // the failure, which is when that run of the state actually ended.
                    entries[frame.lastEntryIndex].status = 'caught';
                }
            }
            continue;
        }

        // --- Container failure: close the leaves it took down with it ---
        // A Parallel branch or Map iteration that fails is abandoned mid-flight: the
        // leaf emits its own failure but never a `StateExited`, so without this its
        // frame would stay open and the state would be reported `running` long after
        // the container was caught and the execution moved on.
        const containerFailure = CONTAINER_FAILURE_EVENT_TYPES.get(type);
        if (containerFailure) {
            const containerIndex = findFrameIndex(
                (frame) => frame.enteredType === containerFailure.enteredType && !frame.failureClosed
            );
            if (containerIndex >= 0) {
                const eventError = extractError(event);
                // Every leaf still open under the container is closed, not just the one
                // that errored: a failing Parallel branch aborts its siblings mid-run,
                // and they emit nothing further. An aborted sibling reports `failed`
                // with no error of its own - the model has no `aborted` status to tell
                // an abandoned run from a failed one (#309), and leaving it open would
                // report it `running` long after the execution finished.
                const leaves = openStack.splice(containerIndex + 1);
                for (const leaf of leaves) {
                    closeAsFailed(leaf, nowMs, eventError);
                }
                // `ParallelStateFailed` carries no error details of its own, so fall back
                // to the error of the leaf that actually failed - that is the failure
                // that took the container down.
                const leafError = leaves.find((leaf) => leaf.lastOutcome === 'failure')?.error;
                // The container itself stays open: it exits normally when a Catch
                // handles the error, and that exit reads `lastOutcome` as `caught`.
                const container = openStack[containerIndex];
                if (!container.failureCounted) {
                    container.failures += 1;
                    container.failureCounted = true;
                }
                container.lastOutcome = 'failure';
                container.error = container.error ?? eventError ?? leafError;
                if (containerFailure.terminal) container.failureClosed = true;
                closeEntry(container, nowMs, 'failed', eventError ?? leafError);
            }
            continue;
        }

        // --- Container (re)start: a Retry attempt begins with a clean failure record ---
        const startedEnteredType = CONTAINER_START_EVENT_TYPES.get(type);
        if (startedEnteredType) {
            const containerIndex = findFrameIndex(
                (frame) => frame.enteredType === startedEnteredType
            );
            if (containerIndex >= 0) {
                const container = openStack[containerIndex];
                container.failureClosed = false;
                container.failureCounted = false;
                // A retry of the container is a new run of it, with its own branches.
                if (container.openEntryIndex === undefined) {
                    openEntry(container, nowMs, container.failures + 1);
                }
            }
            continue;
        }

        // --- Task-level failure / success attributed to the state the event belongs to ---
        const activeFrame = frameForEvent(event) ?? openStack[openStack.length - 1];

        // Without this an attempt would appear to start at the moment it ended, and the
        // backoff before it would belong to no attempt at all.
        if (
            activeFrame !== undefined &&
            activeFrame.openEntryIndex === undefined &&
            ATTEMPT_START_EVENT_TYPES.has(type)
        ) {
            openEntry(activeFrame, nowMs, activeFrame.failures + 1);
        }

        if (FAILURE_EVENT_TYPES.has(type)) {
            if (activeFrame) {
                // Each attempt is its own entry: a Retry emits no further StateEntered,
                // so an attempt's own failure is the only marker of where it ended, and
                // the previous one's is the only marker of where it began.
                if (activeFrame.openEntryIndex === undefined) {
                    openEntry(activeFrame, nowMs, activeFrame.failures + 1);
                }
                activeFrame.failures += 1;
                activeFrame.lastOutcome = 'failure';
                activeFrame.error = extractError(event) ?? activeFrame.error;
                closeEntry(activeFrame, nowMs, 'failed', extractError(event));
            }
            continue;
        }
        if (SUCCESS_EVENT_TYPES.has(type)) {
            if (activeFrame) {
                activeFrame.lastOutcome = 'success';
                if (activeFrame.openEntryIndex === undefined) {
                    openEntry(activeFrame, nowMs, activeFrame.failures + 1);
                }
            }
            continue;
        }

        // --- Terminal execution events ---
        if (type === 'ExecutionSucceeded') {
            executionStatus = 'succeeded';
        } else if (type === 'ExecutionFailed' || type === 'ExecutionAborted' || type === 'ExecutionTimedOut') {
            executionStatus =
                type === 'ExecutionFailed'
                    ? 'failed'
                    : type === 'ExecutionAborted'
                      ? 'aborted'
                      : 'timedOut';
            const execError = extractError(event);
            // Any state still open when the execution ends failed to complete.
            // Add this entry's attempts (failed tries, at least one) to any prior
            // completed iterations of the same state.
            for (const frame of openStack) {
                closeAsFailed(frame, nowMs, execError);
            }
            openStack.length = 0;
        }
    }

    // States entered but never exited on a still-running execution are in progress.
    for (const frame of openStack) {
        const result = ensure(frame.name);
        result.status = mergeStatus(result.status, 'running');
        result.attempts += Math.max(frame.failures, 1);
        // Their entries stay open - no `exitedMs`, still `running` - but a container
        // has already started whatever branches or iterations it is waiting on.
        if (frame.openEntryIndex !== undefined) {
            stampChildCount(frame, entries[frame.openEntryIndex]);
        }
    }

    return {
        overlay: { executionStatus, startState, states: results, takenEdges },
        resolver,
        timeline: {
            endMs: lastKnownMs,
            entries,
            startMs: startMs ?? 0,
            status: executionStatus,
        },
    };
}

/**
 * Reduce a Step Functions execution's event history into a render-agnostic
 * {@link ExecutionOverlay}: per-state status, attempts, duration, and the set of
 * transitions the run actually followed.
 *
 * Pure and deterministic — any surface (SVG, Mermaid, React, Action) can consume it
 * without rendering. States entered multiple times (Map iterations) are aggregated:
 * status escalates to the worst outcome, durations sum, and attempts total. For the
 * un-aggregated, ordered form use {@link buildExecutionTimeline}.
 *
 * @param params - Object parameters
 * @param params.events - Ordered execution history events (from GetExecutionHistory)
 * @returns The computed execution overlay model
 *
 * @example
 * ```typescript
 * import { parseExecutionHistory } from 'sfn-diagram';
 * const overlay = parseExecutionHistory({ events });
 * console.log(overlay.states['ProcessOrder'].status); // 'succeeded'
 * ```
 */
export function parseExecutionHistory(params: { events: HistoryEvent[] }): ExecutionOverlay {
    return walkExecutionHistory({ events: params.events }).overlay;
}

/** Parameters for {@link buildExecutionTimeline}. */
export interface BuildExecutionTimelineParams {
    /**
     * The ASL the execution ran, used to resolve each entry's `nodeId` to the id the
     * renderer stamps as `data-state-id`. Omit it and the state's own name is used,
     * which is the same id for every definition whose state names are unique.
     */
    definition?: AslDefinition;
    /** Ordered execution history events (from GetExecutionHistory). */
    events: HistoryEvent[];
}

/**
 * Replay an execution history as an ordered list of state runs: what ran, in what
 * order, for how long, and how each run ended.
 *
 * Where {@link parseExecutionHistory} folds a state's runs into one result, this keeps
 * them apart — every `Retry` attempt, every Map iteration and every pass through a
 * Parallel branch is its own {@link TimelineEntry}, in the order the execution entered
 * them. That is what a scrubber, a Gantt view or a "what ran when" report needs.
 *
 * Pure and deterministic; it reads the history and nothing else.
 *
 * @param params - Object parameters
 * @param params.definition - The ASL the execution ran, for scoped node ids
 * @param params.events - Ordered execution history events
 * @returns The ordered timeline, with the run's overall window and status
 *
 * @example
 * ```typescript
 * import { buildExecutionTimeline } from 'sfn-diagram';
 * const timeline = buildExecutionTimeline({ definition: asl, events });
 * for (const entry of timeline.entries) {
 *     console.log(entry.stateName, entry.attempt, entry.status);
 * }
 * ```
 *
 * @remarks
 * A container entry's `branchCount` / `iterationCount` counts what the history shows
 * starting inside it. A Distributed Map runs its iterations as child executions, whose
 * events are not in this history at all, so its count is 0 — the parent history has
 * nothing finer than the run's own outcome to offer.
 *
 * An entry is `running` only if it never closed: on a finished execution that means
 * the state the run was still inside when it ended.
 */
export function buildExecutionTimeline(
    params: BuildExecutionTimelineParams
): ExecutionTimeline {
    const { definition, events } = params;
    return walkExecutionHistory({ definition, events }).timeline;
}

/** Format a duration for a node annotation, e.g. 45 -> "45ms", 1200 -> "1.2s". */
function formatDuration(durationMs: number): string {
    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
    return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
}

/** Build the "1.2s ×3" style annotation for a state, or undefined if nothing to show. */
function buildAnnotation(result: ExecutionStateResult): string | undefined {
    const parts: string[] = [];
    if (result.durationMs !== undefined) parts.push(formatDuration(result.durationMs));
    if (result.attempts > 1) parts.push(`×${result.attempts}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Bucket state names by status for output metadata. `allStateNames` (the ASL's
 * top-level states) lets us report which states the execution never reached.
 */
function summarize(
    overlay: ExecutionOverlay,
    allStateNames: string[],
): ExecutionMetadataSummary {
    const summary: ExecutionMetadataSummary = {
        caught: [],
        failed: [],
        notReached: [],
        running: [],
        succeeded: [],
        takenEdgeCount: overlay.takenEdges.length,
    };
    for (const [name, result] of Object.entries(overlay.states)) {
        summary[result.status].push(name);
    }
    for (const name of allStateNames) {
        if (!overlay.states[name]) summary.notReached.push(name);
    }
    return summary;
}

/**
 * Resolve execution input into both derived models once, for every renderer. One walk
 * covers the overlay the styling is built from and the timeline the output reports.
 */
function computeExecutionWalk(
    definition: AslDefinition,
    history: ExecutionHistoryInput
): ExecutionWalk {
    return walkExecutionHistory({ definition, events: normalizeEvents(history) });
}

/**
 * Generate an SVG execution overlay: the ASL diagram with each state coloured by
 * its outcome, the taken path emphasized, untaken transitions dimmed, and per-state
 * duration / retry annotations.
 *
 * States not present in the execution history are rendered as "not reached" (greyed).
 *
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.history - Execution history: events array, GetExecutionHistory response, or JSON string
 * @param params - Any additional {@link DiagramOptions}
 * @returns {@link ExecutionOutput} with SVG markup and a per-status summary
 *
 * @remarks
 * A caller-supplied `edgeOverrides` / `nodeAnnotations` / `nodeOverrides` entry wins
 * over the overlay's computed value for that same key; every key the caller does not
 * name keeps the overlay's styling. A legacy bare `${from}->${to}` edge key claims
 * every edge between that pair, suppressing the overlay's own styling for all of them.
 *
 * Execution history records transitions as `{ from, to }` only, so two Choice rules
 * sharing a `Next` are both highlighted when either fires. `Retry` self-loops are
 * never highlighted — retries emit no transition event.
 *
 * With `collapse`, each collapsed container's placeholder is coloured by the status
 * rolled up from the states it hides — any failure makes it `failed`, otherwise any
 * `running` makes it `running`, otherwise the container's own outcome — and
 * annotated with a `3/4 succeeded`-style summary beside its own duration.
 *
 * @example
 * ```typescript
 * import { generateExecution } from 'sfn-diagram';
 * const { svg } = generateExecution({ aslDefinition: asl, history: events });
 * ```
 */
/**
 * Re-key an overlay's per-state results from ASL state names onto graph node ids.
 *
 * An execution history records only `stateEnteredEventDetails.name`, a bare state
 * name with no indication of which Parallel branch or Map iteration it came from.
 * Node ids are scoped by nesting, so a name that repeats across branches maps to
 * several nodes and the history cannot say which one ran.
 *
 * Every node carrying that name therefore takes the result. That matches what the
 * diagram did before ids were scoped — those states shared a single node, so the one
 * highlight covered all of them — and it is the only reading the history supports.
 * The alternative, matching nothing, would leave a branch that demonstrably ran
 * rendered as "not reached".
 */
function byNodeId<Value>(
    byStateName: Record<string, Value>,
    idsForName: (name: string) => string[]
): Record<string, Value> {
    const result: Record<string, Value> = {};
    for (const [name, value] of Object.entries(byStateName)) {
        for (const id of idsForName(name)) {
            result[id] = value;
        }
    }
    return result;
}

/** Parameters for {@link computeExecutionStyling}. */
export interface ComputeExecutionStylingParams {
    /**
     * The caller's own `edgeOverrides`, if any. A legacy bare `${from}->${to}` key in
     * it claims every edge between that pair, so no styling is emitted for those.
     */
    callerEdgeOverrides?: Record<string, EdgeStyleOverride>;
    /** The definition the graph was parsed from; its top-level state names feed the summary. */
    definition: AslDefinition;
    /** The graph's edges, after catch handling. */
    edges: GraphEdge[];
    /** Execution history: events array, GetExecutionHistory response, or JSON string. */
    history: ExecutionHistoryInput;
    /** The graph's nodes, after catch handling. */
    nodes: StateNode[];
    /**
     * Top-level state names the summary reports — every one the history never
     * mentions is listed as `notReached`. Defaults to `definition.States`' keys;
     * a caller rendering a merged diff definition passes the after-side's names so
     * removed states, which the after definition no longer has, stay out of it.
     */
    summaryStateNames?: string[];
}

/** What {@link computeExecutionStyling} contributes to a render, keyed by node / edge id. */
export interface ExecutionStyling {
    /** Taken transitions emphasized, the rest dimmed; absent for pairs the caller claimed. */
    edgeOverrides: Record<string, EdgeStyleOverride>;
    /** `1.2s ×3`-style duration and retry annotations for states that ran. */
    nodeAnnotations: Record<string, string>;
    /** Fill and stroke per node for its status; every node gets one. */
    nodeOverrides: Record<string, Partial<NodeStyle>>;
    /** The status each node was styled with. */
    statusByNodeId: Record<string, ExecutionStateStatus>;
    /** The per-status summary reported in output metadata. */
    summary: ExecutionSummary;
}

/**
 * Turn an execution history into per-node and per-edge styling for a parsed graph:
 * the pure core of {@link generateExecution}, shared with `generateHtml`'s `history`
 * overlay. It never touches layout or rendering, so the same styling can be applied
 * to any view of the graph.
 *
 * @param params - The graph, the definition it came from, and the history to overlay
 * @returns Node / edge styling keyed by id, plus the status summary
 *
 * @example
 * ```typescript
 * const graph = buildDiagramGraph({ definition, options });
 * const styling = computeExecutionStyling({ definition, history, ...graph });
 * const { svg } = renderSvgGraph({ ...graph, options: { ...options, ...styling } });
 * ```
 */
export function computeExecutionStyling(params: ComputeExecutionStylingParams): ExecutionStyling {
    const {
        callerEdgeOverrides,
        definition,
        edges,
        history,
        nodes,
        summaryStateNames = Object.keys(definition.States),
    } = params;
    const walk = computeExecutionWalk(definition, history);
    const { overlay, timeline } = walk;

    // The overlay is keyed by ASL state name; node ids are scoped by nesting. Re-key
    // once rather than looking up `overlay.states[node.id]`, which silently misses
    // every nested state whose name repeats - see byNodeId. The walk already indexed
    // the definition to scope its own ids, so reuse that rather than indexing twice.
    const resolver = walk.resolver ?? buildIdResolver({ definition });
    const statesByNodeId = byNodeId(overlay.states, resolver.idsForName);

    // Node colours: known states by status; everything else "not reached".
    const nodeOverrides: Record<string, Partial<NodeStyle>> = {};
    const nodeAnnotations: Record<string, string> = {};
    const statusByNodeId: Record<string, ExecutionStateStatus> = {};
    for (const node of nodes) {
        const result = statesByNodeId[node.id];
        const status = result?.status ?? 'notReached';
        nodeOverrides[node.id] = EXECUTION_COLORS[status];
        statusByNodeId[node.id] = status;
        if (result) {
            const annotation = buildAnnotation(result);
            if (annotation) nodeAnnotations[node.id] = annotation;
        }
    }

    // Edge emphasis: taken transitions highlighted, the rest dimmed. Keyed by
    // `edge.id` so two edges sharing a from/to pair can be styled apart.
    //
    // Taken-ness is matched on the pair, because execution history records only
    // `{ from, to }` — it never says which Choice rule fired. `retry` edges are
    // excluded outright: a Retry attempt emits no transition event, so a highlighted
    // retry loop could only ever be a genuine self-transition bleeding across.
    // Retry activity is surfaced through the per-state attempt count instead.
    //
    // A caller who supplied a legacy bare `${from}->${to}` key owns that whole pair:
    // the renderer merges a qualified key on top of a bare one, so emitting our own
    // qualified entry for those edges would silently outrank the caller. A key is
    // "bare" here by membership in the graph's actual pair keys, not by the mere
    // absence of `#` - a state name containing `#` would otherwise defeat a
    // structural `!key.includes('#')` check, silently reintroducing #79 for callers
    // whose state names happen to contain that character.
    const pairKeys = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
    const callerBarePairs = new Set(
        Object.keys(callerEdgeOverrides ?? {}).filter((key) => pairKeys.has(key)),
    );
    // Same re-keying for taken transitions: history records both endpoints by name.
    // A name repeated across scopes (the reason `resolver` exists at all) makes
    // `idsForName` return more than one id per side, so the naive cross-product
    // would also produce pairs that were never real edges - e.g. crossing from one
    // Parallel branch's `A` to a different branch's `B`. Filtering through
    // `pairKeys`, the graph's actual edges, drops those phantom pairs; a taken key
    // is only ever kept when some real edge could have produced it.
    const takenKeys = new Set(
        overlay.takenEdges
            .flatMap((edge) =>
                resolver
                    .idsForName(edge.from)
                    .flatMap((from) => resolver.idsForName(edge.to).map((to) => `${from}->${to}`))
            )
            .filter((key) => pairKeys.has(key))
    );
    const edgeOverrides: Record<string, EdgeStyleOverride> = {};
    for (const edge of edges) {
        const pairKey = `${edge.from}->${edge.to}`;
        if (callerBarePairs.has(pairKey)) {
            continue;
        }
        const isTaken = edge.type !== 'retry' && takenKeys.has(pairKey);
        edgeOverrides[edge.id] = isTaken ? TAKEN_EDGE_STYLE : UNTAKEN_EDGE_STYLE;
    }

    return {
        edgeOverrides,
        nodeAnnotations,
        nodeOverrides,
        statusByNodeId,
        summary: {
            ...summarize(overlay, summaryStateNames),
            executionStatus: overlay.executionStatus,
            timeline,
        },
    };
}

export function generateExecution(params: GenerateExecutionParams): ExecutionOutput {
    const {
        aslDefinition,
        edgeOverrides: callerEdgeOverrides,
        history,
        nodeAnnotations: callerNodeAnnotations,
        nodeOverrides: callerNodeOverrides,
        ...options
    } = params;
    const aslObj = parseAslSource({ source: aslDefinition });
    // Same merge generateSvg does, so the overlay renders on the plain diagram's terms.
    const mergedOptions = mergeOptions({
        ...options,
        diagramTitle: options.diagramTitle ?? aslObj.Comment,
    });

    const { edges, nodes } = buildDiagramGraph({ definition: aslObj, options: mergedOptions });
    const styling = computeExecutionStyling({
        callerEdgeOverrides,
        definition: aslObj,
        edges,
        history,
        nodes,
    });

    // Caller-supplied entries win per key, matching generateDiff. Merging rather than
    // replacing keeps the overlay's styling for every key the caller did not name.
    const expanded = {
        nodeAnnotations: mergeRecordOptions(styling.nodeAnnotations, callerNodeAnnotations),
        nodeOverrides: mergeRecordOptions(styling.nodeOverrides, callerNodeOverrides),
    };
    // A collapsed container's placeholder takes the status rolled up from the states
    // it hides, and a `3/4 succeeded` summary beside its own annotation. Edges need no
    // remapping: every edge into or out of a container is already anchored at the
    // container's own id, so its taken/untaken styling carries over as is.
    const collapsed = mergedOptions.collapse
        ? styleCollapsedView({
              callerOverrides: { nodeAnnotations: callerNodeAnnotations, nodeOverrides: callerNodeOverrides },
              executionStatusByNodeId: styling.statusByNodeId,
              expanded,
              nodes,
              plan: computeCollapsePlan({ collapse: mergedOptions.collapse, edges, nodes }),
          })
        : expanded;
    const svgOutput = renderSvgGraph({
        edges,
        nodes,
        options: {
            ...mergedOptions,
            ...collapsed,
            edgeOverrides: mergeRecordOptions(styling.edgeOverrides, callerEdgeOverrides),
        },
    });

    return {
        height: svgOutput.height,
        metadata: {
            ...styling.summary,
            edgeCount: svgOutput.metadata.edgeCount,
            nodeCount: svgOutput.metadata.nodeCount,
        },
        svg: svgOutput.svg,
        width: svgOutput.width,
    };
}

/**
 * Generate a Mermaid execution overlay. Colours each state by its outcome and appends
 * duration / retry annotations to state labels.
 *
 * Note: Mermaid `stateDiagram-v2` cannot style individual transitions, so taken-path
 * highlighting is expressed through node colours and label annotations only (the SVG
 * overlay from {@link generateExecution} dims untaken edges).
 *
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.history - Execution history: events array, GetExecutionHistory response, or JSON string
 * @returns {@link MermaidExecutionOutput} with Mermaid code and a per-status summary
 */
export function generateMermaidExecution(
    params: GenerateMermaidExecutionParams,
): MermaidExecutionOutput {
    const { aslDefinition, history, layout, theme } = params;
    const aslObj = parseAslSource({ source: aslDefinition });
    const walk = computeExecutionWalk(aslObj, history);
    const { overlay, timeline } = walk;

    const { nodes, edges } = parseAsl({ definition: aslObj });
    const resolver = walk.resolver ?? buildIdResolver({ definition: aslObj });
    const statesByNodeId = byNodeId(overlay.states, resolver.idsForName);

    const executionClasses: Record<string, ExecutionStateStatus> = {};
    const nodeAnnotations: Record<string, string> = {};
    for (const node of nodes) {
        const result = statesByNodeId[node.id];
        executionClasses[node.id] = result?.status ?? 'notReached';
        if (result) {
            const annotation = buildAnnotation(result);
            if (annotation) nodeAnnotations[node.id] = annotation;
        }
    }

    const { code, metadata } = new MermaidRenderer().render({
        asl: aslObj,
        edges,
        executionClasses,
        layout,
        nodeAnnotations,
        nodes,
        theme,
    });

    return {
        code,
        metadata: {
            ...summarize(overlay, Object.keys(aslObj.States)),
            edgeCount: metadata.edgeCount,
            executionStatus: overlay.executionStatus,
            stateCount: metadata.stateCount,
            timeline,
        },
    };
}
