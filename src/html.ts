/**
 * @module
 *
 * The interactive HTML viewer entry points: {@link generateHtml},
 * {@link generateHtmlAsync}, {@link generateViewerUpdate}, and the execution-overlay
 * wrappers {@link generateExecutionHtml} / {@link generateExecutionHtmlAsync}. All of
 * them run one parse through `pipeline.ts` and derive every view of the diagram — the
 * expanded one, the collapsed one behind the toggle, the viewer's edge data — plus any
 * `diff` / `history` overlay from that single pass.
 */
import { parseAslSource } from './AslParser';
import { mergeOptions, mergeRecordOptions } from './config';
import { computeDiffStyling, computeStateDiff, summarizeDiff } from './diff';
import { computeExecutionStyling } from './execution';
import { computeCollapsePlan } from './graph';
import { buildDiagramGraph, renderSvgGraph } from './pipeline';
import {
    buildEdgeData,
    buildViewerContent,
    collectStateData,
    minimapStartsCollapsed,
    resolveViewerTheme,
    wrapSvgInInteractiveHtml,
} from './renderers';
import { collectIconUrls, replaceIconUrls, resolveIconDataUris } from './utils/iconEmbedder';
import type { StateDiff } from './diff';
import type { ExecutionStyling } from './execution';
import type { CollapsePlan } from './graph';
import type { MergedDiagramOptions } from './pipeline';
import type { RelayoutModel, RelayoutRenderOptions } from './renderers';
import type {
    AslDefinition,
    AslState,
    EdgeStyleOverride,
    ExecutionHistoryInput,
    ExecutionHtmlOutput,
    ExecutionSummary,
    GenerateExecutionHtmlParams,
    GenerateHtmlParams,
    GenerateViewerUpdateParams,
    GraphEdge,
    HtmlOutput,
    NodeStyle,
    StateNode,
    SvgOutput,
    ViewerUpdate,
} from './types';

/** The per-node / per-edge styling an overlay contributes to one rendered view. */
interface OverlayStyling {
    edgeOverrides?: Record<string, EdgeStyleOverride>;
    nodeAnnotations?: Record<string, string>;
    nodeOverrides?: Record<string, Partial<NodeStyle>>;
}

/** The overlays a document was asked for, resolved against its graph. */
interface ResolvedOverlays {
    diff?: StateDiff;
    execution?: ExecutionStyling;
}

/**
 * Compose the diff and execution overlays for one view, then let the caller's own
 * `edgeOverrides` / `nodeAnnotations` / `nodeOverrides` win per key on top, exactly
 * as `generateDiff` and `generateExecution` each do on their own.
 *
 * When both overlays are present, the execution decides the colour of every state
 * that ran and the diff keeps the colour of every state it never reached — a removed
 * state is always one of those — while a changed state that ran carries its diff
 * status in its annotation (`modified · 1.2s`, or just `modified` for a state with
 * no duration to show), so neither signal is lost.
 */
function composeOverlayStyling(params: {
    options: MergedDiagramOptions;
    overlays: ResolvedOverlays;
    plan?: CollapsePlan;
}): OverlayStyling {
    const { options, overlays, plan } = params;
    const { execution } = overlays;
    const diff = overlays.diff ? computeDiffStyling({ diff: overlays.diff, plan }) : undefined;

    const nodeOverrides: Record<string, Partial<NodeStyle>> = { ...diff?.nodeOverrides };
    const nodeAnnotations: Record<string, string> = { ...diff?.nodeAnnotations };
    if (execution) {
        for (const [id, style] of Object.entries(execution.nodeOverrides)) {
            const diffStatus = diff?.statusByNodeId[id];
            if (diffStatus !== undefined && execution.statusByNodeId[id] === 'notReached') {
                continue;
            }
            nodeOverrides[id] = style;
            // The execution colour just replaced the diff colour, so the diff status
            // moves into the annotation — whether or not the state has a duration.
            if (diffStatus !== undefined) {
                nodeAnnotations[id] = [diffStatus, nodeAnnotations[id]]
                    .filter((part) => part !== undefined)
                    .join(' · ');
            }
        }
        for (const [id, annotation] of Object.entries(execution.nodeAnnotations)) {
            nodeAnnotations[id] =
                nodeAnnotations[id] === undefined ? annotation : `${nodeAnnotations[id]} · ${annotation}`;
        }
    }

    return {
        edgeOverrides: mergeRecordOptions(execution?.edgeOverrides, options.edgeOverrides),
        nodeAnnotations: mergeRecordOptions(nodeAnnotations, options.nodeAnnotations),
        nodeOverrides: mergeRecordOptions(nodeOverrides, options.nodeOverrides),
    };
}

/**
 * The render options as JSON can carry them: `iconResolver` is a function and has
 * already done its work (every node's `iconUrl` is resolved), so it is the one field
 * left out.
 */
function toRelayoutRenderOptions(options: MergedDiagramOptions): RelayoutRenderOptions {
    const serializable: Partial<MergedDiagramOptions> = { ...options };
    delete serializable.iconResolver;
    return serializable;
}

/**
 * Parse once, then render the expanded view, for {@link generateHtml},
 * {@link generateHtmlAsync} and {@link generateViewerUpdate}, and decide how the
 * viewer collapses containers. `collapse: false` is treated the same as `collapse:
 * []`: both mean "nothing to collapse", so neither should produce a toggle.
 *
 * Deciding via {@link computeCollapsePlan} first (a graph walk, no rendering)
 * means a no-op selection — an unmatched name, `false`, `[]`, or a containerless
 * diagram — never pays for a second layout and render just to discard it.
 *
 * With `relayout`, a diagram with something to collapse ships one view rendered with
 * per-container controls plus a {@link RelayoutModel}, and the viewer re-lays the
 * diagram out itself for whatever the reader collapses. Without it (a
 * `generateViewerUpdate` fragment, whose host swaps content in place), the fully
 * collapsed view is pre-rendered as a second view for the toggle to swap to.
 *
 * A `history` overlay ships the expanded view only, either way: its per-node styling
 * has no notion of a placeholder standing in for the states it hides, so a collapsed
 * view would show a container's own status and lose its children's.
 *
 * The raw parsed `edges` come back too, so the viewer's edge data is keyed off the
 * same parse the views were drawn from rather than a fresh one.
 */
function buildHtmlViews(params: {
    /** The definition as the caller passed it — the after side when diffing. */
    afterObj: AslDefinition;
    /** The definition to draw: `afterObj`, or the diff's merged definition. */
    aslObj: AslDefinition;
    diff?: StateDiff;
    history?: ExecutionHistoryInput;
    options: MergedDiagramOptions;
    /** Whether the document can ship the in-browser relayout instead of a second view. */
    relayout: boolean;
}): {
    collapsedSvgOutput?: SvgOutput;
    edges: GraphEdge[];
    execution?: ExecutionSummary;
    relayoutModel?: RelayoutModel;
    svgOutput: SvgOutput;
} {
    const { afterObj, aslObj, diff, history, options, relayout } = params;
    const resolvedCollapse = options.collapse ?? true;

    // Both views feed the interactive viewer, so both get clickable edges.
    const viewOptions: MergedDiagramOptions = {
        ...options,
        diagramTitle: options.diagramTitle ?? aslObj.Comment,
        edgeHitAreas: true,
    };

    const { edges, nodes, parsed } = buildDiagramGraph({ definition: aslObj, options: viewOptions });
    const overlays: ResolvedOverlays = {
        diff,
        execution:
            history === undefined
                ? undefined
                : computeExecutionStyling({
                      callerEdgeOverrides: options.edgeOverrides,
                      definition: aslObj,
                      edges,
                      history,
                      nodes,
                      // Report against the definition the caller passed: a diff's
                      // merged definition also holds removed states, which are not
                      // "unreached" states of the machine that actually ran.
                      summaryStateNames: Object.keys(afterObj.States),
                  }),
    };
    const styleView = (plan?: CollapsePlan): OverlayStyling =>
        diff === undefined && history === undefined
            ? {}
            : composeOverlayStyling({ options, overlays, plan });

    const plan = history === undefined
        ? computeCollapsePlan({ collapse: resolvedCollapse, edges, nodes })
        : undefined;
    // A target whose closure is empty (a container with no descendants) collapses to
    // itself; leaving it out is the same guard the two-view path applies by comparing
    // node counts, decided here from the plan instead of from a discarded render.
    const collapseTargets = plan
        ? [...plan.effectiveTargets].filter((id) => (plan.hiddenIdsByTarget.get(id)?.size ?? 0) > 0)
        : [];
    const useRelayout = relayout && collapseTargets.length > 0;

    const expandedOptions: MergedDiagramOptions = {
        ...viewOptions,
        ...styleView(),
        collapse: undefined,
        collapseControls: useRelayout,
    };
    const svgOutput = renderSvgGraph({ edges, nodes, options: expandedOptions });

    const relayoutModel: RelayoutModel | undefined = useRelayout
        ? {
              collapseTargets,
              ...(diff ? { diffChangedIds: diff.ownChanges } : {}),
              edges,
              nodes,
              options: toRelayoutRenderOptions(expandedOptions),
          }
        : undefined;

    const collapsedSvgOutput =
        plan && plan.effectiveTargets.size > 0 && !useRelayout
            ? renderSvgGraph({
                  edges,
                  nodes,
                  options: { ...viewOptions, ...styleView(plan), collapse: resolvedCollapse },
              })
            : undefined;

    return {
        collapsedSvgOutput,
        edges: parsed.edges,
        execution: overlays.execution?.summary,
        relayoutModel,
        svgOutput,
    };
}

/**
 * Render the expanded view plus (via {@link buildHtmlViews}) the collapsed one, then
 * apply the "is the collapsed view worth shipping" nodeCount guard: a requested target
 * can resolve to an `effectiveTargets` entry whose own closure is still empty (a
 * container with no descendants), which would otherwise ship a second view identical
 * to the first behind a toggle button that does nothing.
 *
 * Shared by {@link generateHtml}, {@link generateHtmlAsync} and
 * {@link generateViewerUpdate} so the three can never disagree on when a diagram gets
 * a collapse toggle.
 */
function buildHtmlViewParts(params: {
    afterObj: AslDefinition;
    aslObj: AslDefinition;
    diff?: StateDiff;
    history?: ExecutionHistoryInput;
    options: MergedDiagramOptions;
    relayout: boolean;
}): {
    collapsedSvg?: string;
    collapsedSvgOutput?: SvgOutput;
    edges: GraphEdge[];
    execution?: ExecutionSummary;
    relayoutModel?: RelayoutModel;
    svgOutput: SvgOutput;
} {
    const { collapsedSvgOutput, edges, execution, relayoutModel, svgOutput } = buildHtmlViews(params);
    const collapsedSvg =
        collapsedSvgOutput && collapsedSvgOutput.metadata.nodeCount < svgOutput.metadata.nodeCount
            ? collapsedSvgOutput.svg
            : undefined;
    return { collapsedSvg, collapsedSvgOutput, edges, execution, relayoutModel, svgOutput };
}

/**
 * Resolve the inputs {@link generateHtml} and {@link generateHtmlAsync} share: the
 * definition to draw (the merged before/after definition when diffing, so removed
 * states stay visible), the classified diff, and the merged options.
 */
function resolveHtmlInputs(params: GenerateHtmlParams): {
    afterObj: AslDefinition;
    aslObj: AslDefinition;
    diff?: StateDiff;
    history?: ExecutionHistoryInput;
    nonce?: string;
    options: MergedDiagramOptions;
} {
    const { aslDefinition, diff: diffOverlay, history, nonce, ...options } = params;
    const afterObj = parseAslSource({ source: aslDefinition });
    const diff = diffOverlay
        ? computeStateDiff(parseAslSource({ source: diffOverlay.before }), afterObj)
        : undefined;
    return {
        afterObj,
        aslObj: diff?.mergedAsl ?? afterObj,
        diff,
        history,
        nonce,
        options: mergeOptions(options),
    };
}

/**
 * The detail panel's state data for the drawn definition. A diff draws its merged
 * definition, in which each removed state is only an orphan stub, so those entries
 * are swapped for the state's real ASL from the `before` side.
 */
function collectHtmlStateData(params: {
    aslObj: AslDefinition;
    diff?: StateDiff;
}): Record<string, AslState> {
    const { aslObj, diff } = params;
    return { ...collectStateData({ definition: aslObj }), ...diff?.removedStates };
}

/** Assemble {@link HtmlOutput.metadata}, adding an overlay's summary only when it ran. */
function buildHtmlMetadata(params: {
    diff?: StateDiff;
    execution?: ExecutionSummary;
    svgOutput: SvgOutput;
}): HtmlOutput['metadata'] {
    const { diff, execution, svgOutput } = params;
    return {
        ...svgOutput.metadata,
        ...(diff ? { diff: summarizeDiff(diff) } : {}),
        ...(execution ? { execution } : {}),
    };
}

/**
 * Generate a self-contained interactive HTML diagram from an ASL definition.
 *
 * Wraps the SVG output in an HTML document with an inline vanilla-JS controller
 * providing pan/zoom, state search (press `/` to focus, `Enter` to cycle hits),
 * and a click-a-state detail panel showing the state's raw ASL. No external
 * dependencies, so it opens from `file://`.
 *
 * Optional overlays draw on the same document: `history` colours each state by its
 * execution outcome and emphasizes the taken path (what {@link generateExecutionHtml}
 * produces), and `diff` renders the definition as a change against an earlier one
 * (what `generateDiff` draws, in the viewer). The two compose — see
 * {@link GenerateHtmlParams.diff} for how a state that both changed and ran is shown.
 *
 * @param params - ASL definition plus the same options as {@link generateSvg}, and
 *   optionally `history` and/or `diff`.
 * @returns The HTML document string plus dimensions and metadata. `metadata.execution`
 *   and `metadata.diff` carry each overlay's summary when it was requested.
 *
 * @example
 * ```typescript
 * import { generateHtml } from 'sfn-diagram';
 * import { writeFileSync } from 'node:fs';
 * const { html } = generateHtml({ aslDefinition: asl });
 * writeFileSync('diagram.html', html);
 * ```
 *
 * @example
 * ```typescript
 * // A run's outcome painted onto a diff of the definition it ran against
 * const { html, metadata } = generateHtml({
 *   aslDefinition: after,
 *   diff: { before },
 *   history: events,
 * });
 * console.log(metadata.diff?.modified, metadata.execution?.failed);
 * ```
 *
 * @remarks
 * With `showIcons: true` the embedded SVG references CDN-hosted AWS service icons,
 * so the document is not fully offline. Use {@link generateHtmlAsync} to inline
 * those icons as data URIs.
 *
 * With `history`, `collapse` is not yet applied: the document ships the expanded
 * view only, with no collapse/expand toggle. A `diff` collapses like a plain
 * diagram, with each collapsed placeholder that hides a change annotated
 * `"<n> changed inside"`.
 */
export function generateHtml(params: GenerateHtmlParams): HtmlOutput {
    const { afterObj, aslObj, diff, history, nonce, options } = resolveHtmlInputs(params);

    const { collapsedSvg, collapsedSvgOutput, edges, execution, relayoutModel, svgOutput } =
        buildHtmlViewParts({ afterObj, aslObj, diff, history, options, relayout: true });

    return {
        height: svgOutput.height,
        html: wrapSvgInInteractiveHtml({
            collapsedNodeCount: collapsedSvg ? collapsedSvgOutput?.metadata.nodeCount : undefined,
            collapsedSvg,
            edgeData: buildEdgeData({ edges }),
            nodeCount: svgOutput.metadata.nodeCount,
            nonce,
            relayoutModel,
            stateData: collectHtmlStateData({ aslObj, diff }),
            svg: svgOutput.svg,
            theme: resolveViewerTheme({ theme: options.theme }),
        }),
        metadata: buildHtmlMetadata({ diff, execution, svgOutput }),
        width: svgOutput.width,
    };
}

/**
 * Render diagram content a running interactive viewer can swap in, without rebuilding
 * the surrounding document. Counterpart to {@link generateHtml} for hosts that keep one
 * viewer alive across re-renders (e.g. the VS Code preview) and want to patch it in
 * place — via `ViewerHandle.setContent` — rather than replace the whole document on
 * every edit.
 *
 * @param params - ASL definition plus the same options as {@link generateSvg}.
 * @returns Content markup plus the data `ViewerHandle.setContent` needs to rewire it.
 *
 * @example
 * ```typescript
 * import { generateViewerUpdate } from 'sfn-diagram';
 * const update = generateViewerUpdate({ aslDefinition: asl });
 * webview.postMessage({ command: 'updateContent', ...update });
 * ```
 */
export function generateViewerUpdate(params: GenerateViewerUpdateParams): ViewerUpdate {
    const { aslDefinition, ...options } = params;
    const aslObj = parseAslSource({ source: aslDefinition });
    const mergedOptions = mergeOptions(options);

    const { collapsedSvg, collapsedSvgOutput, edges, svgOutput } = buildHtmlViewParts({
        afterObj: aslObj,
        aslObj,
        options: mergedOptions,
        relayout: false,
    });

    return {
        contentHtml: buildViewerContent({
            collapsedMinimapCollapsed: collapsedSvg
                ? minimapStartsCollapsed({ nodeCount: collapsedSvgOutput?.metadata.nodeCount })
                : undefined,
            collapsedSvg,
            minimapCollapsed: minimapStartsCollapsed({ nodeCount: svgOutput.metadata.nodeCount }),
            svg: svgOutput.svg,
        }),
        edgeData: buildEdgeData({ edges }),
        hasCollapsedView: collapsedSvg !== undefined,
        metadata: svgOutput.metadata,
        stateData: collectStateData({ definition: aslObj }),
    };
}

/**
 * Generate a fully offline interactive HTML diagram from an ASL definition.
 *
 * Identical to {@link generateHtml} — overlays included — except AWS service icons
 * are fetched once and inlined as base64 data URIs, so the document has no external
 * references even with `showIcons: true`. An icon shared by the expanded and collapsed
 * views is fetched once for both, and the embedded relayout model carries the same
 * data URIs, so a container collapsed in the browser re-renders offline too. When the
 * diagram has no remote icons this costs nothing — no icon is fetched and no network
 * request is made.
 *
 * @param params - ASL definition plus the same options as {@link generateSvg}, and
 *   optionally `history` and/or `diff`.
 * @returns Promise resolving to the HTML document string plus dimensions and metadata.
 *
 * @example
 * ```typescript
 * import { generateHtmlAsync } from 'sfn-diagram';
 * import { writeFileSync } from 'node:fs';
 * const { html } = await generateHtmlAsync({ aslDefinition: asl, showIcons: true });
 * writeFileSync('diagram.html', html); // opens offline, icons included
 * ```
 */
export async function generateHtmlAsync(params: GenerateHtmlParams): Promise<HtmlOutput> {
    const { afterObj, aslObj, diff, history, nonce, options } = resolveHtmlInputs(params);

    const { collapsedSvg, collapsedSvgOutput, edges, execution, relayoutModel, svgOutput } =
        buildHtmlViewParts({ afterObj, aslObj, diff, history, options, relayout: true });

    // The nodeCount guard has already run, so a discarded collapsed view never pays
    // for icon embedding; the views that survive share one fetch per icon. The
    // expanded view draws every icon the relayout model can ever need, so its URLs
    // cover the model's nodes as well.
    const svgs = collapsedSvg === undefined ? [svgOutput.svg] : [svgOutput.svg, collapsedSvg];
    const urls = collectIconUrls({ svgs });
    const urlToDataUri = urls.length === 0 ? new Map<string, string>() : await resolveIconDataUris({ urls });
    const [embeddedSvg, embeddedCollapsedSvg] = svgs.map((svg) => replaceIconUrls({ svg, urlToDataUri }));
    const embeddedModel =
        relayoutModel && urlToDataUri.size > 0
            ? { ...relayoutModel, nodes: relayoutModel.nodes.map((node) => withEmbeddedIcon(node, urlToDataUri)) }
            : relayoutModel;

    return {
        height: svgOutput.height,
        html: wrapSvgInInteractiveHtml({
            collapsedNodeCount: collapsedSvg ? collapsedSvgOutput?.metadata.nodeCount : undefined,
            collapsedSvg: embeddedCollapsedSvg,
            edgeData: buildEdgeData({ edges }),
            nodeCount: svgOutput.metadata.nodeCount,
            nonce,
            relayoutModel: embeddedModel,
            stateData: collectHtmlStateData({ aslObj, diff }),
            svg: embeddedSvg,
            theme: resolveViewerTheme({ theme: options.theme }),
        }),
        metadata: buildHtmlMetadata({ diff, execution, svgOutput }),
        width: svgOutput.width,
    };
}

/** A copy of `node` whose `iconUrl`, if it was fetched, now points at its data URI. */
function withEmbeddedIcon(node: StateNode, urlToDataUri: Map<string, string>): StateNode {
    const dataUri = node.iconUrl === undefined ? undefined : urlToDataUri.get(node.iconUrl);
    return dataUri === undefined ? node : { ...node, iconUrl: dataUri };
}

/**
 * Reshape {@link generateHtml}'s output into the {@link ExecutionHtmlOutput} the
 * execution wrappers have always returned: the execution summary flattened into
 * `metadata` beside the node and edge counts.
 */
function toExecutionHtmlOutput(output: HtmlOutput): ExecutionHtmlOutput {
    const { height, html, metadata, width } = output;
    // `history` was supplied, so the execution summary is always present.
    const execution = metadata.execution as ExecutionSummary;
    return {
        height,
        html,
        metadata: { ...execution, edgeCount: metadata.edgeCount, nodeCount: metadata.nodeCount },
        width,
    };
}

/**
 * Generate a self-contained interactive HTML execution overlay: the same viewer
 * {@link generateHtml} produces (pan/zoom, search, minimap, click-a-state/edge detail
 * panel), wrapped around {@link generateExecution}'s coloured, taken-path-emphasized
 * SVG rather than a plain diagram.
 *
 * A thin wrapper over `generateHtml({ history })`, kept for its
 * {@link ExecutionHtmlOutput} shape; new code can call {@link generateHtml} directly
 * and read `metadata.execution`.
 *
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.history - Execution history: events array, GetExecutionHistory response, or JSON string
 * @param params.nonce - Content-Security-Policy nonce for the embedded `<style>`/`<script>` tags
 * @param params - Any additional {@link DiagramOptions}
 * @returns {@link ExecutionHtmlOutput} with the HTML document and a per-status summary
 *
 * @example
 * ```typescript
 * import { generateExecutionHtml } from 'sfn-diagram';
 * const { html } = generateExecutionHtml({ aslDefinition: asl, history: events });
 * ```
 *
 * @remarks
 * With `showIcons: true` the embedded SVG references CDN-hosted AWS service icons, so
 * the document is not fully offline. Use {@link generateExecutionHtmlAsync} to inline
 * those icons as data URIs.
 *
 * `collapse` is not yet applied on this path: the document ships one view only, with
 * no collapse/expand toggle — unlike a plain {@link generateHtml} document, which
 * renders both an expanded and a collapsed view for the toggle to switch between.
 */
export function generateExecutionHtml(params: GenerateExecutionHtmlParams): ExecutionHtmlOutput {
    return toExecutionHtmlOutput(generateHtml(params));
}

/**
 * Generate a fully offline interactive HTML execution overlay from an ASL definition
 * and execution history.
 *
 * Identical to {@link generateExecutionHtml}, except AWS service icons are fetched
 * once and inlined as base64 data URIs, so the document has no external references
 * even with `showIcons: true`. A thin wrapper over `generateHtmlAsync({ history })`.
 *
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.history - Execution history: events array, GetExecutionHistory response, or JSON string
 * @param params.nonce - Content-Security-Policy nonce for the embedded `<style>`/`<script>` tags
 * @param params - Any additional {@link DiagramOptions}
 * @returns Promise resolving to {@link ExecutionHtmlOutput} with the HTML document and a per-status summary
 *
 * @example
 * ```typescript
 * import { generateExecutionHtmlAsync } from 'sfn-diagram';
 * const { html } = await generateExecutionHtmlAsync({
 *     aslDefinition: asl,
 *     history: events,
 *     showIcons: true,
 * });
 * ```
 */
export async function generateExecutionHtmlAsync(
    params: GenerateExecutionHtmlParams,
): Promise<ExecutionHtmlOutput> {
    return toExecutionHtmlOutput(await generateHtmlAsync(params));
}
