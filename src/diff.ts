import type {
    AslDefinition,
    AslState,
    DiffOutput,
    DiffStatus,
    GenerateDiffParams,
    GenerateMermaidDiffParams,
    MermaidDiffOutput,
    NodeStyle,
} from './types';
import { generateSvg } from './index';
import { parseAsl } from './AslParser';
import { mergeRecordOptions } from './config';
import { applyCatchHandling, computeCollapsePlan } from './graph';
import { MermaidRenderer } from './renderers';

/** Colors applied to diff nodes as nodeOverrides */
const DIFF_COLORS: Record<'added' | 'modified' | 'removed', Partial<NodeStyle>> = {
    added: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 },
    modified: { fill: '#fff9c4', stroke: '#f57f17', strokeWidth: 2 },
    removed: { fill: '#ffcdd2', stroke: '#c62828', strokeWidth: 2 },
};

function parseAslArg(value: AslDefinition | string): AslDefinition {
    return typeof value === 'string' ? (JSON.parse(value) as AslDefinition) : value;
}

/**
 * Serialize a value with object keys sorted recursively so that two semantically
 * equivalent state definitions compare equal regardless of property ordering.
 * Array order is preserved (it is significant in ASL, e.g. Choices priority).
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
            (key) =>
                `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
        );
    return `{${entries.join(',')}}`;
}

/** Strip transition fields so a removed state renders as an orphan End node. */
function toOrphanState(state: AslState): AslState {
    const base: AslState = { End: true, Type: state.Type };
    if (state.Type === 'Fail') {
        if (state.Cause !== undefined) base.Cause = state.Cause;
        if (state.Error !== undefined) base.Error = state.Error;
    }
    return base;
}

/** Result of comparing the state sets of two ASL definitions. */
interface StateDiff {
    added: string[];
    /** `after` states plus removed states re-added as orphan end-nodes */
    mergedAsl: AslDefinition;
    modified: string[];
    removed: string[];
    unchanged: string[];
}

/**
 * Compare two ASL definitions at the state level, classifying every state as
 * added / modified / removed / unchanged and producing a merged definition that
 * keeps removed states visible as orphan end-nodes. Shared by the SVG and Mermaid
 * diff renderers.
 */
function computeStateDiff(beforeAsl: AslDefinition, afterAsl: AslDefinition): StateDiff {
    const beforeNames = new Set(Object.keys(beforeAsl.States));
    const afterNames = new Set(Object.keys(afterAsl.States));

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    for (const name of afterNames) {
        if (!beforeNames.has(name)) {
            added.push(name);
        } else if (stableStringify(beforeAsl.States[name]) !== stableStringify(afterAsl.States[name])) {
            modified.push(name);
        } else {
            unchanged.push(name);
        }
    }

    for (const name of beforeNames) {
        if (!afterNames.has(name)) {
            removed.push(name);
        }
    }

    // Build merged ASL: after states + removed states as orphan End nodes
    const mergedStates: Record<string, AslState> = { ...afterAsl.States };
    for (const name of removed) {
        mergedStates[name] = toOrphanState(beforeAsl.States[name]);
    }

    return { added, mergedAsl: { ...afterAsl, States: mergedStates }, modified, removed, unchanged };
}

/** Map each changed state to its diff status for per-node highlighting. */
function buildStatusMap(diff: StateDiff): Record<string, DiffStatus> {
    const statusByState: Record<string, DiffStatus> = {};
    for (const name of diff.added) statusByState[name] = 'added';
    for (const name of diff.modified) statusByState[name] = 'modified';
    for (const name of diff.removed) statusByState[name] = 'removed';
    return statusByState;
}

/** Parameters for {@link computeContainerChangeAnnotations}. */
export interface ComputeContainerChangeAnnotationsParams {
    /** Names classified added/modified/removed by {@link computeStateDiff}. */
    changedNames: Set<string>;
    /** Containers that get their own placeholder — from {@link computeCollapsePlan}. */
    effectiveTargets: Set<string>;
    /** The `nodeOverrides` built so far — checked so a container's own more specific
     *  added/removed status is never overwritten with the generic "modified" one. */
    existingOverrides: Record<string, Partial<NodeStyle>>;
    /** Each effective target's hidden descendant ids — from {@link computeCollapsePlan}. */
    hiddenIdsByTarget: Map<string, Set<string>>;
}

/**
 * For each collapsed container, count how many of its hidden descendants carry a
 * diff status, and build the amber override / `"<n> changed inside"` annotation for
 * the ones that do. Isolated from {@link generateDiff} so the counting/precedence
 * logic can be unit tested directly against synthetic sets — the current diff
 * granularity (top-level ASL state names only, see {@link computeStateDiff}) makes a
 * live ASL definition that actually triggers a nonzero count hard to construct, but
 * the logic itself needs to be right for whenever one does (e.g. a future nested-diff
 * granularity, or a state name reused at two different nesting levels).
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

/**
 * Generate an SVG diff diagram comparing two AWS Step Functions ASL definitions.
 *
 * Added states are highlighted green, modified states yellow, and removed states red.
 * Removed states are included as orphan end-nodes so they remain visible in the diagram.
 *
 * @param params.before - The original (base) ASL definition
 * @param params.after  - The new (head) ASL definition
 * @param params        - Any additional {@link DiagramOptions} passed through to generateSvg
 *
 * @remarks
 * With `collapse` set, a changed state that ends up inside a collapsed container's
 * placeholder would otherwise vanish from the diagram along with its diff color. The
 * placeholder is flagged instead: an amber (modified) outline, plus a `"<n> changed
 * inside"` annotation (unless the container itself already carries a more specific
 * added/removed status, which wins).
 *
 * @returns {@link DiffOutput} with SVG markup and a per-category state summary
 */
export function generateDiff(params: GenerateDiffParams): DiffOutput {
    const {
        after: afterArg,
        before: beforeArg,
        nodeAnnotations: callerAnnotations,
        nodeOverrides: callerOverrides,
        ...options
    } = params;

    const diff = computeStateDiff(parseAslArg(beforeArg), parseAslArg(afterArg));
    const { added, mergedAsl, modified, removed, unchanged } = diff;

    // Build nodeOverrides for diff coloring
    const nodeOverrides: Record<string, Partial<NodeStyle>> = {};
    for (const name of added) nodeOverrides[name] = DIFF_COLORS.added;
    for (const name of modified) nodeOverrides[name] = DIFF_COLORS.modified;
    for (const name of removed) nodeOverrides[name] = DIFF_COLORS.removed;

    // A changed state hidden inside a collapsed container's placeholder would
    // otherwise carry no visible trace of the change. Flag the placeholder itself.
    let containerAnnotations: Record<string, string> = {};
    if (options.collapse) {
        const parsed = parseAsl({ definition: mergedAsl, options });
        // Mirror generateSvg's own pipeline (catch handling before collapse) so the
        // hidden-descendant closure here matches what the rendered diagram actually
        // hides — otherwise a catch-hidden node could be double-counted as "hidden
        // inside" a placeholder when it was really stripped from the diagram entirely.
        const { edges, nodes } = applyCatchHandling({
            edges: parsed.edges,
            mode: options.catchHandling ?? 'show',
            nodes: parsed.nodes,
            startStateId: mergedAsl.StartAt,
        });
        const { effectiveTargets, hiddenIdsByTarget } = computeCollapsePlan({
            collapse: options.collapse,
            edges,
            nodes,
        });
        const changed = computeContainerChangeAnnotations({
            changedNames: new Set([...added, ...modified, ...removed]),
            effectiveTargets,
            existingOverrides: nodeOverrides,
            hiddenIdsByTarget,
        });
        containerAnnotations = changed.nodeAnnotations;
        Object.assign(nodeOverrides, changed.nodeOverrides);
    }

    // A caller-supplied nodeAnnotations entry for the same container wins over ours,
    // same as an explicit diff status on the container wins over the placeholder color.
    const nodeAnnotations = mergeRecordOptions(containerAnnotations, callerAnnotations);
    // Same precedence for nodeOverrides: a caller override for one node must not
    // discard the diff coloring computed for every other node (issue #76).
    const mergedNodeOverrides = mergeRecordOptions(nodeOverrides, callerOverrides);

    const svgOutput = generateSvg({
        aslDefinition: mergedAsl,
        nodeAnnotations,
        nodeOverrides: mergedNodeOverrides,
        ...options,
    });

    return {
        height: svgOutput.height,
        metadata: {
            added,
            edgeCount: svgOutput.metadata.edgeCount,
            modified,
            nodeCount: svgOutput.metadata.nodeCount,
            removed,
            unchanged,
        },
        svg: svgOutput.svg,
        width: svgOutput.width,
    };
}

/**
 * Generate Mermaid diff code comparing two AWS Step Functions ASL definitions.
 *
 * Produces `stateDiagram-v2` syntax where added states are green, modified states
 * yellow, and removed states red (via Mermaid `classDef`s) — rendered natively by
 * GitHub, GitLab, and docs tooling with no image hosting required. Removed states
 * are kept as orphan nodes so they stay visible.
 *
 * @param params.before - The original (base) ASL definition
 * @param params.after  - The new (head) ASL definition
 *
 * @returns {@link MermaidDiffOutput} with Mermaid code and a per-category state summary
 */
export function generateMermaidDiff(params: GenerateMermaidDiffParams): MermaidDiffOutput {
    const { after: afterArg, before: beforeArg } = params;

    const diff = computeStateDiff(parseAslArg(beforeArg), parseAslArg(afterArg));
    const { added, mergedAsl, modified, removed, unchanged } = diff;

    const { edges, nodes } = parseAsl({ definition: mergedAsl });
    const renderer = new MermaidRenderer();
    const { code, metadata } = renderer.render({
        asl: mergedAsl,
        edges,
        nodes,
        stateClasses: buildStatusMap(diff),
    });

    return {
        code,
        metadata: {
            added,
            edgeCount: metadata.edgeCount,
            modified,
            removed,
            stateCount: metadata.stateCount,
            unchanged,
        },
    };
}
