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
