import type {
    AslDefinition,
    AslState,
    DiffOutput,
    DiffStatus,
    GenerateDiffParams,
    GenerateMermaidDiffParams,
    MermaidDiffOutput,
    NodeStyle,
    QueryLanguage,
} from './types';
import { parseAsl, parseAslSource } from './AslParser';
import { buildDiagramGraph, renderSvgGraph } from './pipeline';
import { resolveQueryLanguage } from './utils/jsonata';
import { mergeOptions, mergeRecordOptions } from './config';
import {
    buildIdResolver,
    computeCollapsePlan,
    getMapProcessor,
} from './graph';
import type { ScopePath } from './graph';
import { MermaidRenderer } from './renderers';

/** Colors applied to diff nodes as nodeOverrides */
const DIFF_COLORS: Record<'added' | 'modified' | 'removed', Partial<NodeStyle>> = {
    added: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 },
    modified: { fill: '#fff9c4', stroke: '#f57f17', strokeWidth: 2 },
    removed: { fill: '#ffcdd2', stroke: '#c62828', strokeWidth: 2 },
};

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

interface ToOrphanStateParams {
    /** The top-level `QueryLanguage` of the definition the state was removed from. */
    machineQueryLanguage: QueryLanguage | undefined;
    /** The removed state. */
    state: AslState;
}

/**
 * Strip transition fields so a removed state renders as an orphan End node.
 *
 * The orphan is parsed as part of the *after* definition, whose top-level
 * `QueryLanguage` may differ from the one it was written under, so it carries its
 * own resolved mode: a JSONata Fail `Error` removed while the machine went back to
 * JSONPath would otherwise render with its `{% %}` delimiters intact.
 */
function toOrphanState(params: ToOrphanStateParams): AslState {
    const { machineQueryLanguage, state } = params;
    const base: AslState = {
        End: true,
        QueryLanguage: resolveQueryLanguage({ machineQueryLanguage, state }),
        Type: state.Type,
    };
    if (state.Type === 'Fail') {
        if (state.Cause !== undefined) base.Cause = state.Cause;
        if (state.Error !== undefined) base.Error = state.Error;
        if (state.CausePath !== undefined) base.CausePath = state.CausePath;
        if (state.ErrorPath !== undefined) base.ErrorPath = state.ErrorPath;
    }
    return base;
}

/** Result of comparing the state sets of two ASL definitions. */
interface StateDiff {
    added: string[];
    /** `after` states plus removed states re-added as orphan end-nodes */
    mergedAsl: AslDefinition;
    modified: string[];
    /**
     * Every added/removed id plus the modified ids whose *own* definition changed —
     * a container that is modified only because a state inside it changed is left
     * out, so counting these inside a collapsed placeholder yields one per edit.
     */
    ownChanges: string[];
    removed: string[];
    unchanged: string[];
}

/**
 * One step from a `States` block down into a nested one: which container was
 * entered and, for a Parallel, which of its branches.
 */
type ScopeStep =
    | { containerName: string; index: number; kind: 'branch' }
    | { containerName: string; kind: 'processor' };

/**
 * A state's classification together with where it sits, so its node id can be
 * resolved once the merged definition exists.
 */
interface ClassifiedState {
    name: string;
    /** False for a container whose only change is inside its nested `States`. */
    ownChange: boolean;
    status: DiffStatus | 'unchanged';
    steps: ScopeStep[];
}

/** A container with each nested `States` block blanked, for comparing its own fields. */
function withoutNestedStates(state: AslState): AslState {
    if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
        return { ...state, Branches: state.Branches.map((branch) => ({ ...branch, States: {} })) };
    }
    if (state.Type === 'Map') {
        if (state.ItemProcessor) {
            return { ...state, ItemProcessor: { ...state.ItemProcessor, States: {} } };
        }
        if (state.Iterator) {
            return { ...state, Iterator: { ...state.Iterator, States: {} } };
        }
    }
    return state;
}

/**
 * Pair each `after` branch with the `before` branch it evolved from: by `StartAt`
 * first, so inserting or reordering a branch does not shift every later branch onto
 * the wrong partner, then by position for the branches that changed their start
 * state. An unmatched `after` branch is new; an unmatched `before` branch is gone.
 */
function pairBranches(
    afterBranches: AslDefinition[],
    beforeBranches: AslDefinition[] | undefined,
): Array<AslDefinition | undefined> {
    const unclaimed = new Set((beforeBranches ?? []).map((_, index) => index));
    const claim = (index: number | undefined): AslDefinition | undefined => {
        if (index === undefined || !unclaimed.has(index)) return undefined;
        unclaimed.delete(index);
        return beforeBranches![index];
    };

    const byStart = afterBranches.map((branch) => {
        const match = (beforeBranches ?? []).findIndex(
            (candidate, index) => unclaimed.has(index) && candidate.StartAt === branch.StartAt,
        );
        return claim(match === -1 ? undefined : match);
    });
    return byStart.map((paired, index) => paired ?? claim(index));
}

/** Parameters for {@link diffStates}. */
interface DiffStatesParams {
    /** The `after` side of the block being compared. */
    afterStates: Record<string, AslState>;
    /** Top-level `QueryLanguage` of the *before* definition, stamped onto orphans. */
    beforeQueryLanguage: QueryLanguage | undefined;
    /**
     * The `before` side of the block, or `undefined` when the whole block is new —
     * inside an added container, or a container whose type changed under it.
     */
    beforeStates: Record<string, AslState> | undefined;
    /** Accumulator every visited state is appended to. */
    classified: ClassifiedState[];
    /** Path from the root `States` block to this one. */
    steps: ScopeStep[];
}

/**
 * Compare one `States` block and every block nested inside it, returning the merged
 * copy of the `after` block with removed states re-inserted as orphans in the scope
 * they were removed from.
 *
 * A container is compared as a whole, so a change anywhere inside it still marks the
 * container itself modified — the collapsed-placeholder colour relies on that — and
 * its descendants are then classified individually on top. The descendants of a
 * removed container (or of a Parallel branch that no longer exists) are not listed:
 * the orphan stub is the only trace of that subtree in the diagram, and a bare name
 * with no node behind it could alias a surviving state with the same name.
 */
function diffStates(params: DiffStatesParams): Record<string, AslState> {
    const { afterStates, beforeQueryLanguage, beforeStates, classified, steps } = params;
    const merged: Record<string, AslState> = {};

    // Own-property lookups only: a state named `constructor` or `toString` must not
    // be compared against, or hidden behind, `Object.prototype`.
    const beforeState = (name: string): AslState | undefined =>
        beforeStates !== undefined && Object.hasOwn(beforeStates, name) ? beforeStates[name] : undefined;

    for (const [name, afterState] of Object.entries(afterStates)) {
        const before = beforeState(name);
        const status: ClassifiedState['status'] =
            before === undefined
                ? 'added'
                : stableStringify(before) !== stableStringify(afterState)
                  ? 'modified'
                  : 'unchanged';
        const ownChange =
            status !== 'unchanged' &&
            (before === undefined ||
                stableStringify(withoutNestedStates(before)) !==
                    stableStringify(withoutNestedStates(afterState)));
        classified.push({ name, ownChange, status, steps });

        // Only a container of the same type on both sides has scopes to pair up; a
        // Task that became a Parallel has no "before" block for its branches to diff
        // against, so every state in them is new.
        const beforeContainer = before?.Type === afterState.Type ? before : undefined;
        const recurse = (
            block: AslDefinition,
            beforeBlock: AslDefinition | undefined,
            step: ScopeStep,
        ): AslDefinition => ({
            ...block,
            States: diffStates({
                afterStates: block.States,
                beforeQueryLanguage,
                beforeStates: beforeBlock?.States,
                classified,
                steps: [...steps, step],
            }),
        });

        let mergedState = afterState;
        if (afterState.Type === 'Parallel' && Array.isArray(afterState.Branches)) {
            const paired = pairBranches(afterState.Branches, beforeContainer?.Branches);
            mergedState = {
                ...afterState,
                Branches: afterState.Branches.map((branch, index) =>
                    recurse(branch, paired[index], {
                        containerName: name,
                        index,
                        kind: 'branch',
                    })
                ),
            };
        } else if (afterState.Type === 'Map') {
            const processor = getMapProcessor(afterState);
            if (processor) {
                const beforeProcessor = beforeContainer ? getMapProcessor(beforeContainer) : undefined;
                const mergedProcessor = recurse(processor, beforeProcessor, {
                    containerName: name,
                    kind: 'processor',
                });
                mergedState =
                    afterState.ItemProcessor !== undefined
                        ? { ...afterState, ItemProcessor: mergedProcessor }
                        : { ...afterState, Iterator: mergedProcessor };
            }
        }
        merged[name] = mergedState;
    }

    for (const [name, state] of Object.entries(beforeStates ?? {})) {
        if (Object.hasOwn(afterStates, name)) continue;
        classified.push({ name, ownChange: true, status: 'removed', steps });
        merged[name] = toOrphanState({ machineQueryLanguage: beforeQueryLanguage, state });
    }

    return merged;
}

/**
 * Compare two ASL definitions at the state level, classifying every state — nested
 * ones included — as added / modified / removed / unchanged and producing a merged
 * definition that keeps removed states visible as orphan end-nodes in the scope they
 * were removed from. Shared by the SVG and Mermaid diff renderers.
 *
 * The returned names are node ids as assigned by the parser's id resolver for the
 * merged definition, so they line up with `data-state-id` / `nodeOverrides`: a nested
 * state keeps its bare name unless it repeats elsewhere, in which case it is scoped
 * exactly as the rendered diagram scopes it.
 */
function computeStateDiff(beforeAsl: AslDefinition, afterAsl: AslDefinition): StateDiff {
    const classified: ClassifiedState[] = [];
    const mergedStates = diffStates({
        afterStates: afterAsl.States,
        beforeQueryLanguage: beforeAsl.QueryLanguage,
        beforeStates: beforeAsl.States,
        classified,
        steps: [],
    });
    const mergedAsl: AslDefinition = { ...afterAsl, States: mergedStates };

    const resolver = buildIdResolver({ definition: mergedAsl });
    const scopeFor = (steps: ScopeStep[]): ScopePath =>
        steps.reduce<ScopePath>(
            (scope, step) =>
                step.kind === 'branch'
                    ? resolver.branchScope(scope, step.containerName, step.index)
                    : resolver.processorScope(scope, step.containerName),
            ''
        );

    const added: string[] = [];
    const modified: string[] = [];
    const ownChanges: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];
    const buckets = { added, modified, removed, unchanged };
    for (const { name, ownChange, status, steps } of classified) {
        const id = resolver.resolve(scopeFor(steps), name);
        buckets[status].push(id);
        if (ownChange) ownChanges.push(id);
    }

    return { added, mergedAsl, modified, ownChanges, removed, unchanged };
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
    /** Ids that count as one change each — {@link StateDiff.ownChanges}. */
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
 * logic can be unit tested directly against synthetic sets, independently of how
 * {@link computeStateDiff} scopes the ids it hands over.
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

    const diff = computeStateDiff(parseAslSource({ source: beforeArg }), parseAslSource({ source: afterArg }));
    const { added, mergedAsl, modified, ownChanges, removed, unchanged } = diff;

    // Build nodeOverrides for diff coloring
    const nodeOverrides: Record<string, Partial<NodeStyle>> = {};
    for (const name of added) nodeOverrides[name] = DIFF_COLORS.added;
    for (const name of modified) nodeOverrides[name] = DIFF_COLORS.modified;
    for (const name of removed) nodeOverrides[name] = DIFF_COLORS.removed;

    // Same merge generateSvg does, so the diff renders exactly as the plain diagram would.
    const mergedOptions = mergeOptions({
        ...options,
        diagramTitle: options.diagramTitle ?? mergedAsl.Comment,
    });
    // One parse serves both the collapse plan below and the render.
    const { edges, nodes } = buildDiagramGraph({ definition: mergedAsl, options: mergedOptions });

    // A changed state hidden inside a collapsed container's placeholder would
    // otherwise carry no visible trace of the change. Flag the placeholder itself.
    let containerAnnotations: Record<string, string> = {};
    if (options.collapse) {
        // The graph has already had catch handling applied, so the hidden-descendant
        // closure here matches what the rendered diagram actually hides — otherwise a
        // catch-hidden node could be double-counted as "hidden inside" a placeholder
        // when it was really stripped from the diagram entirely.
        const { effectiveTargets, hiddenIdsByTarget } = computeCollapsePlan({
            collapse: options.collapse,
            edges,
            nodes,
        });
        // Own changes only: a nested container that is modified purely because one
        // of its own children changed would otherwise be counted on top of that child.
        const changed = computeContainerChangeAnnotations({
            changedNames: new Set(ownChanges),
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

    const svgOutput = renderSvgGraph({
        edges,
        nodes,
        options: { ...mergedOptions, nodeAnnotations, nodeOverrides: mergedNodeOverrides },
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
    const { after: afterArg, before: beforeArg, layout, theme } = params;

    const diff = computeStateDiff(parseAslSource({ source: beforeArg }), parseAslSource({ source: afterArg }));
    const { added, mergedAsl, modified, removed, unchanged } = diff;

    const { edges, nodes } = parseAsl({ definition: mergedAsl });
    const renderer = new MermaidRenderer();
    const { code, metadata } = renderer.render({
        asl: mergedAsl,
        edges,
        layout,
        nodes,
        stateClasses: buildStatusMap(diff),
        theme,
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
