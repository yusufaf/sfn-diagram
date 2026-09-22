import { mergeRecordOptions } from '../config/defaults';
import { computeContainerChangeAnnotations } from './containerChanges';
import { EXECUTION_COLORS, rollUpExecutionStatuses } from './executionRollup';
import type { CollapsePlan } from './collapseContainers';
import type { ExecutionStateStatus, NodeStyle, StateNode } from '../types';

/** The per-node styling of a rendered view that a collapse builds on. */
export interface ViewNodeStyling {
    /** Annotation text per node id. */
    nodeAnnotations?: Record<string, string>;
    /** Fill/stroke overrides per node id. */
    nodeOverrides?: Record<string, Partial<NodeStyle>>;
}

/** Parameters for {@link styleCollapsedView}. */
export interface StyleCollapsedViewParams {
    /**
     * The caller's own `nodeAnnotations` / `nodeOverrides`, re-applied last so an
     * explicit entry for a container still wins over what its placeholder computes.
     */
    callerOverrides?: ViewNodeStyling;
    /**
     * For a diff overlay, the ids that count as one change each, so a placeholder
     * hiding a change gets its `"<n> changed inside"` annotation.
     */
    diffChangedIds?: string[];
    /**
     * For an execution overlay, each node's status, so a placeholder takes the
     * status rolled up from the states it hides and a `3/4 succeeded` summary.
     */
    executionStatusByNodeId?: Record<string, ExecutionStateStatus>;
    /** The styling the expanded view was rendered with, overlays and caller included. */
    expanded: ViewNodeStyling;
    /** The graph's nodes, before collapse. */
    nodes: StateNode[];
    /** Which containers collapse and what each one hides. */
    plan: CollapsePlan;
}

/**
 * Derive a collapsed view's per-node styling from the expanded view's: everything the
 * expanded view had, plus what each placeholder must say about the states it hides.
 *
 * A diff placeholder hiding changes turns amber (unless already coloured) and reads
 * `"<n> changed inside"`. An execution placeholder takes the status rolled up from
 * inside it — see `rollUpExecutionStatuses` — and its summary; a placeholder nothing
 * ran inside keeps its expanded colour (the diff's, if it had one) but still says so.
 * A placeholder's own expanded annotation (its duration, its diff status) comes
 * first, then the diff count, then the execution summary, joined with ` · `.
 *
 * Pure over its inputs and free of the parser, so the server's pre-rendered collapsed
 * view and the viewer's in-browser relayout produce the same styling from the same
 * expanded view.
 *
 * @param params - The expanded styling, the plan, and the overlay data to roll up
 * @returns The collapsed view's `nodeAnnotations` and `nodeOverrides`
 *
 * @example
 * ```typescript
 * const plan = computeCollapsePlan({ collapse: true, edges, nodes });
 * const styling = styleCollapsedView({ expanded, nodes, plan, executionStatusByNodeId });
 * renderSvgGraph({ edges, nodes, options: { ...options, ...styling, collapse: true } });
 * ```
 */
export function styleCollapsedView(params: StyleCollapsedViewParams): Required<ViewNodeStyling> {
    const { callerOverrides, diffChangedIds, executionStatusByNodeId, expanded, nodes, plan } = params;

    const nodeOverrides: Record<string, Partial<NodeStyle>> = { ...expanded.nodeOverrides };
    const nodeAnnotations: Record<string, string> = { ...expanded.nodeAnnotations };
    const insideByTarget: Record<string, string> = {};
    const summaryByTarget: Record<string, string> = {};

    if (diffChangedIds !== undefined) {
        // An execution overlay greys every unreached node, which must not stop a
        // placeholder that hides changes from going amber - only a colour that means
        // something (a state that ran, or a diff status) is "already coloured".
        const existingOverrides: Record<string, Partial<NodeStyle>> = {};
        for (const [id, style] of Object.entries(nodeOverrides)) {
            if (executionStatusByNodeId?.[id] !== 'notReached') existingOverrides[id] = style;
        }
        const changed = computeContainerChangeAnnotations({
            changedNames: new Set(diffChangedIds),
            effectiveTargets: plan.effectiveTargets,
            existingOverrides,
            hiddenIdsByTarget: plan.hiddenIdsByTarget,
        });
        Object.assign(nodeOverrides, changed.nodeOverrides);
        Object.assign(insideByTarget, changed.nodeAnnotations);
    }

    if (executionStatusByNodeId !== undefined) {
        const rollUps = rollUpExecutionStatuses({ nodes, plan, statusByNodeId: executionStatusByNodeId });
        for (const [id, rollUp] of Object.entries(rollUps)) {
            if (rollUp.status !== 'notReached') nodeOverrides[id] = EXECUTION_COLORS[rollUp.status];
            summaryByTarget[id] = rollUp.annotation;
        }
    }

    for (const id of plan.effectiveTargets) {
        const parts = [nodeAnnotations[id], insideByTarget[id], summaryByTarget[id]].filter(
            (part): part is string => part !== undefined,
        );
        if (parts.length > 0) nodeAnnotations[id] = parts.join(' · ');
    }

    return {
        nodeAnnotations: mergeRecordOptions(nodeAnnotations, callerOverrides?.nodeAnnotations) ?? {},
        nodeOverrides: mergeRecordOptions(nodeOverrides, callerOverrides?.nodeOverrides) ?? {},
    };
}
