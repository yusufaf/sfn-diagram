import { isMarkerNode } from './containers';
import type { CollapsePlan } from './collapseContainers';
import type { ExecutionStateStatus, NodeStyle, StateNode } from '../types';

/**
 * Node fill/stroke applied per execution status, mirroring the diff's `DIFF_COLORS`.
 * Beside the roll-up rather than in `execution.ts` so the viewer's in-browser
 * relayout can colour a placeholder without dragging the history parser along.
 */
export const EXECUTION_COLORS: Record<ExecutionStateStatus, Partial<NodeStyle>> = {
    caught: { fill: '#ffe0b2', stroke: '#e65100', strokeWidth: 2 },
    failed: { fill: '#ffcdd2', stroke: '#c62828', strokeWidth: 3 },
    notReached: { fill: '#f5f5f5', stroke: '#bdbdbd', strokeWidth: 1 },
    running: { fill: '#bbdefb', stroke: '#1565c0', strokeWidth: 2 },
    succeeded: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 },
};

/** Parameters for {@link rollUpExecutionStatuses}. */
export interface RollUpExecutionStatusesParams {
    /** The graph's nodes, to tell real states from branch/iterator markers. */
    nodes: StateNode[];
    /** Which containers collapse and what each one hides — from `computeCollapsePlan`. */
    plan: CollapsePlan;
    /** Each node's execution status, from `computeExecutionStyling`. */
    statusByNodeId: Record<string, ExecutionStateStatus>;
}

/** How many of a collapsed container's hidden states ended in each status. */
export interface ExecutionRollUpCounts {
    caught: number;
    failed: number;
    notReached: number;
    running: number;
    succeeded: number;
    /** Hidden states in total (markers excluded). */
    total: number;
}

/** What a collapsed container's placeholder shows for the states it hides. */
export interface ExecutionRollUp {
    /** `3/4 succeeded`-style summary for the placeholder's annotation. */
    annotation: string;
    /** The per-status breakdown the annotation was built from. */
    counts: ExecutionRollUpCounts;
    /** The status the placeholder is coloured with. */
    status: ExecutionStateStatus;
}

/**
 * Roll each collapsed container's hidden statuses up onto its placeholder.
 *
 * The placeholder's status is the worst thing that happened inside or to the
 * container: any `failed` (a hidden state's or the container's own) makes it
 * `failed`; otherwise any `running` makes it `running`; otherwise the container's
 * own outcome (`succeeded`, or `caught` when it recovered from a branch failure)
 * stands; a container nothing ran inside is `notReached`. The annotation counts the
 * hidden states in the rolled-up status — `1/4 failed`, `2/4 running`,
 * `4/4 succeeded` — so a reader can tell a clean run from a partial one at a glance.
 *
 * Pure over the plan and the status map, so the viewer runs it again in the browser
 * for whatever the reader collapses, and execution playback can re-run it as
 * statuses change.
 *
 * @param params - The plan, the graph's nodes, and the statuses to roll up
 * @returns One roll-up per effective collapse target, keyed by container id
 *
 * @example
 * ```typescript
 * const plan = computeCollapsePlan({ collapse: ['FanOut'], edges, nodes });
 * const { FanOut } = rollUpExecutionStatuses({ nodes, plan, statusByNodeId });
 * // FanOut.status === 'failed', FanOut.annotation === '1/2 failed'
 * ```
 */
export function rollUpExecutionStatuses(
    params: RollUpExecutionStatusesParams,
): Record<string, ExecutionRollUp> {
    const { nodes, plan, statusByNodeId } = params;
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const rollUps: Record<string, ExecutionRollUp> = {};

    for (const containerId of plan.effectiveTargets) {
        const counts: ExecutionRollUpCounts = {
            caught: 0,
            failed: 0,
            notReached: 0,
            running: 0,
            succeeded: 0,
            total: 0,
        };
        for (const hiddenId of plan.hiddenIdsByTarget.get(containerId) ?? []) {
            const hidden = nodesById.get(hiddenId);
            if (!hidden || isMarkerNode(hidden)) continue;
            counts.total += 1;
            counts[statusByNodeId[hiddenId] ?? 'notReached'] += 1;
        }

        const own = statusByNodeId[containerId] ?? 'notReached';
        const status: ExecutionStateStatus =
            own === 'failed' || counts.failed > 0
                ? 'failed'
                : own === 'running' || counts.running > 0
                  ? 'running'
                  : own !== 'notReached'
                    ? own
                    : counts.total - counts.notReached > 0
                      ? 'succeeded'
                      : 'notReached';

        const shown = status === 'caught' ? 'succeeded' : status;
        const annotation =
            status === 'notReached' ? `0/${counts.total} ran` : `${counts[shown]}/${counts.total} ${shown}`;

        rollUps[containerId] = { annotation, counts, status };
    }

    return rollUps;
}
