/**
 * In-browser re-layout for per-container collapse.
 *
 * The interactive viewer cannot pre-render every combination of collapsed containers,
 * so `generateHtml` embeds the parsed graph and the render options as a
 * {@link RelayoutModel}, and this module — bundled by `scripts/build-viewer-script.mjs`
 * into `viewerRelayout.generated.ts` and inlined into the document — re-runs the
 * collapse → layout → render pipeline on the reader's machine for whichever
 * containers they collapse. It is the same graph, layout and renderer code the server
 * used, so a view rendered here is byte-for-byte what `generateSvg` would have
 * produced for the same `collapse` selection.
 *
 * Kept free of the parser and of anything Node-only: everything it imports must run
 * in a browser from an inline `<script>`.
 */
import { mergeRecordOptions } from '../../config';
import { applyCollapse, computeCollapsePlan, computeContainerChangeAnnotations } from '../../graph';
import { DagreLayout } from '../../layout';
import { SvgRenderer } from '../SvgRenderer';
import type { DiagramOptions, GraphEdge, StateNode } from '../../types';

/**
 * The render options a relayout runs with: the merged options the expanded view was
 * drawn with (overlay styling and `collapseControls` included), minus the one field
 * that cannot cross into JSON.
 */
export type RelayoutRenderOptions = Omit<DiagramOptions, 'iconResolver'>;

/** Everything the viewer needs to re-render the diagram for any collapse selection. */
export interface RelayoutModel {
    /**
     * Container ids the toolbar's "Collapse" button collapses — the effective targets
     * of the document's `collapse` option, so the button means what it always has.
     */
    collapseTargets: string[];
    /**
     * For a diff overlay, the ids that count as one change each, so a collapsed
     * placeholder hiding a change gets its `"<n> changed inside"` annotation.
     */
    diffChangedIds?: string[];
    /** The graph's edges after catch handling, before any collapse. */
    edges: GraphEdge[];
    /** The graph's nodes after catch handling, before any collapse. */
    nodes: StateNode[];
    /** The options the expanded view was rendered with. */
    options: RelayoutRenderOptions;
}

/** Parameters for {@link renderCollapsedView}. */
export interface RenderCollapsedViewParams {
    /** Ids of the containers to draw collapsed; every other container stays open. */
    collapsedIds: string[];
    /** The embedded model. */
    model: RelayoutModel;
}

/** What {@link renderCollapsedView} hands back. */
export interface RenderCollapsedViewResult {
    /** Node count of the rendered view, for the minimap's auto-visibility rule. */
    nodeCount: number;
    /** The rendered SVG markup. */
    svg: string;
}

/**
 * Render the diagram with exactly the given containers collapsed.
 *
 * @param params - The collapse selection and the embedded model
 * @returns The rendered SVG and its node count
 *
 * @example
 * ```typescript
 * const { svg } = renderCollapsedView({ collapsedIds: ['FanOut'], model });
 * content.innerHTML = svg;
 * ```
 */
export function renderCollapsedView(params: RenderCollapsedViewParams): RenderCollapsedViewResult {
    const { collapsedIds, model } = params;
    const { diffChangedIds, edges, nodes, options } = model;

    let renderOptions: DiagramOptions = { ...options, collapse: collapsedIds };
    if (diffChangedIds !== undefined && collapsedIds.length > 0) {
        const { effectiveTargets, hiddenIdsByTarget } = computeCollapsePlan({
            collapse: collapsedIds,
            edges,
            nodes,
        });
        const changed = computeContainerChangeAnnotations({
            changedNames: new Set(diffChangedIds),
            effectiveTargets,
            existingOverrides: options.nodeOverrides ?? {},
            hiddenIdsByTarget,
        });
        renderOptions = {
            ...renderOptions,
            nodeAnnotations: mergeRecordOptions(changed.nodeAnnotations, options.nodeAnnotations),
            nodeOverrides: mergeRecordOptions(changed.nodeOverrides, options.nodeOverrides),
        };
    }

    const collapsed = applyCollapse({ collapse: collapsedIds, edges, nodes });
    const positioned = new DagreLayout(renderOptions).calculate(collapsed.nodes, collapsed.edges);
    const output = new SvgRenderer(renderOptions).render(positioned);
    return { nodeCount: output.metadata.nodeCount, svg: output.svg };
}
