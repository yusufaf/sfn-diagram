import type { HistoryEvent } from '@aws-sdk/client-sfn';
import type { AslDefinition, AslState } from '../../src';

/**
 * Synthetic ASL fixture generators for performance testing.
 *
 * These build large, valid ASL definitions on demand so we can measure how the
 * parser, layout, and renderers scale with state count, fan-out, and nesting
 * depth without committing huge JSON files to the repo.
 */

interface BuildLinearChainParams {
    /** Number of Task states in the chain (excluding the terminal Succeed) */
    length: number;
}

/**
 * Build a long linear chain: Start -> n Task states -> Succeed.
 * Stresses node/edge extraction and Dagre layout on deep graphs.
 */
export function buildLinearChain(params: BuildLinearChainParams): AslDefinition {
    const { length } = params;
    const states: Record<string, AslState> = {};

    for (let index = 0; index < length; index++) {
        const isLast = index === length - 1;
        states[`Step${index}`] = {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Worker',
            Next: isLast ? 'Done' : `Step${index + 1}`,
        };
    }

    states.Done = { Type: 'Succeed' };

    return { StartAt: 'Step0', States: states };
}

interface BuildSharedCatchChainParams {
    /** Number of Task states in the chain */
    length: number;
}

/**
 * Build a linear chain of Task states that each `Catch` into one shared `Failed`
 * handler - the common "notify and fail" pattern. Stresses layout with a long
 * error edge per state all converging on a single sink.
 */
export function buildSharedCatchChain(params: BuildSharedCatchChainParams): AslDefinition {
    const { length } = params;
    const states: Record<string, AslState> = {};

    for (let index = 0; index < length; index++) {
        const isLast = index === length - 1;
        states[`Step${index}`] = {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Worker',
            Next: isLast ? 'Done' : `Step${index + 1}`,
            Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Failed' }],
        };
    }

    states.Done = { Type: 'Succeed' };
    states.Failed = { Type: 'Fail' };

    return { StartAt: 'Step0', States: states };
}

interface BuildChoiceFanInChainParams {
    /** Number of Choice states in the chain */
    length: number;
}

/**
 * Build a chain of Choice states whose `Default` branches all go to one shared
 * `Cleanup` state - the #434 shape. Unlike {@link buildSharedCatchChain}, every
 * edge into the sink is an ordinary transition, not a `Catch`, so the catch
 * lanes don't apply and each Default edge spans the ranks down to `Cleanup`.
 */
export function buildChoiceFanInChain(params: BuildChoiceFanInChainParams): AslDefinition {
    const { length } = params;
    const states: Record<string, AslState> = {};

    for (let index = 0; index < length; index++) {
        const isLast = index === length - 1;
        states[`Check${index}`] = {
            Type: 'Choice',
            Choices: [{ Variable: '$.ok', BooleanEquals: true, Next: isLast ? 'Done' : `Check${index + 1}` }],
            Default: 'Cleanup',
        };
    }

    states.Done = { Type: 'Succeed' };
    states.Cleanup = { Type: 'Fail' };

    return { StartAt: 'Check0', States: states };
}

interface BuildNestedContainerChainParams {
    /** Number of Parallel states in the chain */
    length: number;
}

/**
 * Build a chain of Parallel states, each with two branches that hold a Map, so
 * open containers are nested two deep (Parallel, then Map) and container bounds
 * and container-edge routing run once per container. Each `length` adds 15 parsed
 * nodes (12 laid out by dagre), plus one `Done`.
 *
 * Each branch starts and ends with a Pass on purpose: a container as a branch's
 * first or last state is not ranked against its neighbours, so the Parallels
 * would lay out side by side instead of stacking, and a ratio test would time a
 * wide, mostly disconnected graph.
 */
export function buildNestedContainerChain(params: BuildNestedContainerChainParams): AslDefinition {
    const { length } = params;
    const states: Record<string, AslState> = {};

    for (let index = 0; index < length; index++) {
        const isLast = index === length - 1;
        const branches = [0, 1].map((branchIndex): AslDefinition => {
            const prefix = `F${index}B${branchIndex}`;
            return {
                StartAt: `${prefix}Lead`,
                States: {
                    [`${prefix}Lead`]: { Type: 'Pass', Next: `${prefix}Map` },
                    [`${prefix}Map`]: {
                        Type: 'Map',
                        ItemProcessor: {
                            StartAt: `${prefix}Task`,
                            States: {
                                [`${prefix}Task`]: {
                                    Type: 'Task',
                                    Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Worker',
                                    Next: `${prefix}Pass`,
                                },
                                [`${prefix}Pass`]: { Type: 'Pass', End: true },
                            },
                        },
                        Next: `${prefix}After`,
                    },
                    [`${prefix}After`]: { Type: 'Pass', End: true },
                },
            };
        });
        states[`Fork${index}`] = {
            Type: 'Parallel',
            Branches: branches,
            Next: isLast ? 'Done' : `Fork${index + 1}`,
        };
    }

    states.Done = { Type: 'Succeed' };

    return { StartAt: 'Fork0', States: states };
}

interface BuildWideChoiceParams {
    /** Number of choice branches (fan-out width) */
    width: number;
}

/**
 * Build a single Choice state fanning out to `width` terminal Task states.
 * Stresses edge extraction and label rendering on wide graphs.
 */
export function buildWideChoice(params: BuildWideChoiceParams): AslDefinition {
    const { width } = params;
    const states: Record<string, AslState> = {};

    const choices = [];
    for (let index = 0; index < width; index++) {
        const targetName = `Branch${index}`;
        choices.push({
            Variable: '$.route',
            NumericEquals: index,
            Next: targetName,
        });
        states[targetName] = {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Branch',
            End: true,
        };
    }

    states.Router = {
        Type: 'Choice',
        Choices: choices,
        Default: 'Branch0',
    };

    return { StartAt: 'Router', States: states };
}

interface BuildParallelParams {
    /** Number of parallel branches */
    branches: number;
    /** Number of Task states inside each branch */
    statesPerBranch: number;
}

/**
 * Build a Parallel state with many branches, each containing a linear sub-chain.
 * Stresses recursive nested-state extraction and container bounding-box math.
 */
export function buildParallel(params: BuildParallelParams): AslDefinition {
    const { branches, statesPerBranch } = params;

    const parallelBranches: AslDefinition[] = [];
    for (let branchIndex = 0; branchIndex < branches; branchIndex++) {
        const branchStates: Record<string, AslState> = {};
        for (let stepIndex = 0; stepIndex < statesPerBranch; stepIndex++) {
            const isLast = stepIndex === statesPerBranch - 1;
            const stateName = `B${branchIndex}S${stepIndex}`;
            branchStates[stateName] = {
                Type: 'Task',
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Branch',
                ...(isLast ? { End: true } : { Next: `B${branchIndex}S${stepIndex + 1}` }),
            };
        }
        parallelBranches.push({ StartAt: `B${branchIndex}S0`, States: branchStates });
    }

    return {
        StartAt: 'Fork',
        States: {
            Fork: {
                Type: 'Parallel',
                Branches: parallelBranches,
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };
}

interface BuildLinearChainHistoryParams {
    /** Number of `Step` states that have entered and exited; the next one is running */
    completed: number;
}

/**
 * Build the execution history of a run partway down {@link buildLinearChain}: the
 * first `completed` steps entered and exited 50 ms apart, and the next one entered
 * but still running. Each completed step carries a duration annotation, so two
 * histories with different `completed` counts lay out under different cache keys.
 */
export function buildLinearChainHistory(params: BuildLinearChainHistoryParams): { events: HistoryEvent[] } {
    const { completed } = params;
    const start = Date.parse('2024-01-01T00:00:00.000Z');
    const events: HistoryEvent[] = [];
    const push = (event: Omit<HistoryEvent, 'id' | 'previousEventId' | 'timestamp'>): void => {
        const id = events.length + 1;
        events.push({ ...event, id, previousEventId: id - 1, timestamp: new Date(start + id * 50) });
    };

    push({ executionStartedEventDetails: { input: '{}' }, type: 'ExecutionStarted' });
    for (let index = 0; index <= completed; index++) {
        push({ stateEnteredEventDetails: { name: `Step${index}` }, type: 'TaskStateEntered' });
        if (index < completed) {
            push({ stateExitedEventDetails: { name: `Step${index}` }, type: 'TaskStateExited' });
        }
    }

    return { events };
}
