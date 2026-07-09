import type { HistoryEvent } from '@aws-sdk/client-sfn';
import type {
    EdgeStyleOverride,
    ExecutionHistoryInput,
    ExecutionMetadataSummary,
    ExecutionOutput,
    ExecutionOverlay,
    ExecutionStateResult,
    ExecutionStateStatus,
    ExecutionStatus,
    GenerateExecutionParams,
    GenerateMermaidExecutionParams,
    MermaidExecutionOutput,
    NodeStyle,
} from './types';
import { parseAsl } from './AslParser';
import { DagreLayout } from './layout';
import { SvgRenderer, MermaidRenderer } from './renderers';
import { mergeOptions } from './config';

/** Node fill/stroke applied per execution status, mirroring diff's DIFF_COLORS. */
const EXECUTION_COLORS: Record<ExecutionStateStatus, Partial<NodeStyle>> = {
    caught: { fill: '#ffe0b2', stroke: '#e65100', strokeWidth: 2 },
    failed: { fill: '#ffcdd2', stroke: '#c62828', strokeWidth: 3 },
    notReached: { fill: '#f5f5f5', stroke: '#bdbdbd', strokeWidth: 1 },
    running: { fill: '#bbdefb', stroke: '#1565c0', strokeWidth: 2 },
    succeeded: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 },
};

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
        undefined
    );
}

/** Per-open-entry bookkeeping, pushed on enter and folded into the result on exit. */
interface OpenFrame {
    enteredMs?: number;
    error?: string;
    failures: number;
    lastOutcome?: 'failure' | 'success';
    name: string;
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

/**
 * Reduce a Step Functions execution's event history into a render-agnostic
 * {@link ExecutionOverlay}: per-state status, attempts, duration, and the set of
 * transitions the run actually followed.
 *
 * Pure and deterministic — any surface (SVG, Mermaid, React, Action) can consume it
 * without rendering. States entered multiple times (Map iterations) are aggregated:
 * status escalates to the worst outcome, durations sum, and attempts total.
 *
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
export function parseExecutionHistory(params: {
    events: HistoryEvent[];
}): ExecutionOverlay {
    const { events } = params;
    const eventById = new Map<number, HistoryEvent>();
    for (const event of events) {
        if (event.id !== undefined) eventById.set(event.id, event);
    }

    const results: Record<string, ExecutionStateResult> = {};
    const openStack: OpenFrame[] = [];
    const takenSet = new Set<string>();
    const takenEdges: ExecutionOverlay['takenEdges'] = [];
    let executionStatus: ExecutionStatus = 'running';
    let startState: string | undefined;

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

    for (const event of events) {
        const type = event.type ?? '';

        // --- State entered ---
        if (type.endsWith('StateEntered')) {
            const name = enteredName(event);
            if (!name) continue;
            if (!startState) startState = name;
            ensure(name);
            openStack.push({ failures: 0, name, enteredMs: toMillis(event.timestamp) });

            const from = findFromState(event);
            if (from && from !== name) {
                const key = `${from}->${name}`;
                if (!takenSet.has(key)) {
                    takenSet.add(key);
                    takenEdges.push({ from, to: name });
                }
            }

            // Fail states are terminal and never emit a StateExited.
            if (type === 'FailStateEntered') {
                const result = ensure(name);
                result.status = 'failed';
                result.attempts = Math.max(result.attempts, 1);
            }
            continue;
        }

        // --- State exited ---
        if (type.endsWith('StateExited')) {
            const name = exitedName(event);
            if (!name) continue;
            // Pop the most recent matching open frame.
            let frameIndex = -1;
            for (let i = openStack.length - 1; i >= 0; i--) {
                if (openStack[i].name === name) {
                    frameIndex = i;
                    break;
                }
            }
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
            continue;
        }

        // --- Task-level failure / success attributed to the active leaf state ---
        const activeFrame = openStack[openStack.length - 1];
        if (FAILURE_EVENT_TYPES.has(type)) {
            if (activeFrame) {
                activeFrame.failures += 1;
                activeFrame.lastOutcome = 'failure';
                activeFrame.error = extractError(event) ?? activeFrame.error;
            }
            continue;
        }
        if (SUCCESS_EVENT_TYPES.has(type)) {
            if (activeFrame) activeFrame.lastOutcome = 'success';
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
                const result = ensure(frame.name);
                result.status = mergeStatus(result.status, 'failed');
                result.attempts += Math.max(frame.failures, 1);
                if (execError && !result.error) result.error = execError;
            }
            openStack.length = 0;
        }
    }

    // States entered but never exited on a still-running execution are in progress.
    for (const frame of openStack) {
        const result = ensure(frame.name);
        result.status = mergeStatus(result.status, 'running');
        result.attempts += Math.max(frame.failures, 1);
    }

    return { executionStatus, startState, states: results, takenEdges };
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

/** Resolve execution input into the overlay model once for both renderers. */
function computeOverlay(history: ExecutionHistoryInput): ExecutionOverlay {
    return parseExecutionHistory({ events: normalizeEvents(history) });
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
 * @example
 * ```typescript
 * import { generateExecution } from 'sfn-diagram';
 * const { svg } = generateExecution({ aslDefinition: asl, history: events });
 * ```
 */
export function generateExecution(params: GenerateExecutionParams): ExecutionOutput {
    const { aslDefinition, history, ...options } = params;
    const aslObj = typeof aslDefinition === 'string' ? JSON.parse(aslDefinition) : aslDefinition;
    const overlay = computeOverlay(history);
    const mergedOptions = mergeOptions(options);

    const { nodes, edges } = parseAsl({ definition: aslObj, options: mergedOptions });

    // Node colours: known states by status; everything else "not reached".
    const nodeOverrides: Record<string, Partial<NodeStyle>> = {};
    const nodeAnnotations: Record<string, string> = {};
    for (const node of nodes) {
        const result = overlay.states[node.id];
        const status = result?.status ?? 'notReached';
        nodeOverrides[node.id] = EXECUTION_COLORS[status];
        if (result) {
            const annotation = buildAnnotation(result);
            if (annotation) nodeAnnotations[node.id] = annotation;
        }
    }

    // Edge emphasis: taken transitions highlighted, the rest dimmed.
    const takenKeys = new Set(overlay.takenEdges.map((edge) => `${edge.from}->${edge.to}`));
    const edgeOverrides: Record<string, EdgeStyleOverride> = {};
    for (const edge of edges) {
        const key = `${edge.from}->${edge.to}`;
        edgeOverrides[key] = takenKeys.has(key) ? TAKEN_EDGE_STYLE : UNTAKEN_EDGE_STYLE;
    }

    const renderOptions = { ...mergedOptions, edgeOverrides, nodeAnnotations, nodeOverrides };
    const layout = new DagreLayout(renderOptions);
    const positioned = layout.calculate(nodes, edges);
    const svgOutput = new SvgRenderer(renderOptions).render(positioned);

    return {
        height: svgOutput.height,
        metadata: {
            ...summarize(overlay, Object.keys(aslObj.States)),
            edgeCount: svgOutput.metadata.edgeCount,
            executionStatus: overlay.executionStatus,
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
    const { aslDefinition, history } = params;
    const aslObj = typeof aslDefinition === 'string' ? JSON.parse(aslDefinition) : aslDefinition;
    const overlay = computeOverlay(history);

    const { nodes, edges } = parseAsl({ definition: aslObj });

    const executionClasses: Record<string, ExecutionStateStatus> = {};
    const nodeAnnotations: Record<string, string> = {};
    for (const node of nodes) {
        const result = overlay.states[node.id];
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
        nodeAnnotations,
        nodes,
    });

    return {
        code,
        metadata: {
            ...summarize(overlay, Object.keys(aslObj.States)),
            edgeCount: metadata.edgeCount,
            executionStatus: overlay.executionStatus,
            stateCount: metadata.stateCount,
        },
    };
}
