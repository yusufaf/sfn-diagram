import type { NodeStyle } from '../types';

/**
 * Colours applied to diff nodes as `nodeOverrides`. They live here, beside the
 * placeholder annotation that reuses `modified`, rather than in `diff.ts`, so the
 * viewer's in-browser relayout bundle can annotate a collapsed placeholder without
 * dragging the diff engine (and the parser it imports) along.
 */
export const DIFF_COLORS: Record<'added' | 'modified' | 'removed', Partial<NodeStyle>> = {
    added: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 },
    modified: { fill: '#fff9c4', stroke: '#f57f17', strokeWidth: 2 },
    removed: { fill: '#ffcdd2', stroke: '#c62828', strokeWidth: 2 },
};

/** Parameters for {@link computeContainerChangeAnnotations}. */
export interface ComputeContainerChangeAnnotationsParams {
    /** Ids that count as one change each — a diff's `ownChanges`. */
    changedNames: Set<string>;
    /** Containers that get their own placeholder — from `computeCollapsePlan`. */
    effectiveTargets: Set<string>;
    /** The `nodeOverrides` built so far — checked so a container's own more specific
     *  added/removed status is never overwritten with the generic "modified" one. */
    existingOverrides: Record<string, Partial<NodeStyle>>;
    /** Each effective target's hidden descendant ids — from `computeCollapsePlan`. */
    hiddenIdsByTarget: Map<string, Set<string>>;
}

/**
 * For each collapsed container, count how many of its hidden descendants carry a
 * diff status, and build the amber override / `"<n> changed inside"` annotation for
 * the ones that do. Isolated from `generateDiff` so the counting/precedence logic
 * can be unit tested directly against synthetic sets, independently of how
 * `computeStateDiff` scopes the ids it hands over — and so the viewer can run it
 * again in the browser for whichever containers the reader collapses.
 */
export function computeContainerChangeAnnotations(
    params: ComputeContainerChangeAnnotationsParams,
): { nodeAnnotations: Record<string, string>; nodeOverrides: Record<string, Partial<NodeStyle>> } {
    const { changedNames, effectiveTargets, existingOverrides, hiddenIdsByTarget } = params;
    const nodeAnnotations: Record<string, string> = {};
    const nodeOverrides: Record<string, Partial<NodeStyle>> = {};

    for (const containerId of effectiveTargets) {
        const hiddenIds = hiddenIdsByTarget.get(containerId) ?? new Set<string>();
        const hiddenChangeCount = [...hiddenIds].filter((id) => changedNames.has(id)).length;
        if (hiddenChangeCount === 0) continue;
        if (!(containerId in existingOverrides)) {
            nodeOverrides[containerId] = DIFF_COLORS.modified;
        }
        nodeAnnotations[containerId] = `${hiddenChangeCount} changed inside`;
    }

    return { nodeAnnotations, nodeOverrides };
}
