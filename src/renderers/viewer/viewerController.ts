import type { AslState } from '../../types';
import { createCollapseToggle, type CollapseToggle, type ViewerRelayout } from './controller/collapse';
import { createListenerRegistry, hook, type ViewerData } from './controller/dom';
import { attachKeyboardHandlers } from './controller/keyboard';
import { createMinimap } from './controller/minimap';
import { createDetailPanel } from './controller/panel';
import { attachPanZoom } from './controller/panZoom';
import { createSearch } from './controller/search';
import { createViewport } from './controller/viewport';
import type { ViewerEdge } from './edgeData';

/**
 * Runtime controller for the interactive viewer: pan/zoom, state search, minimap,
 * and (when state or edge data is supplied) the click-for-detail panel.
 *
 * This is the single source of truth for viewer behaviour. It is consumed two ways:
 *  - directly, as an ES module, by the `sfn-diagram/element` custom element;
 *  - bundled, with the `./controller/*` modules it composes, into a dependency-free
 *    script by `scripts/build-viewer-script.mjs` and inlined into the self-contained
 *    HTML document produced by `generateHtml()`.
 *
 * Every lookup is scoped to `root` rather than `document`, so more than one viewer
 * (multiple `<sfn-diagram>` elements on one page) can coexist without colliding —
 * hook elements are found by `data-sfn="..."` attribute, never by `id`.
 */

/** Parameters for {@link attachViewer}. */
export interface AttachViewerParams {
    /**
     * Viewer-facing detail for each edge, keyed by the `data-edge-id` the renderer
     * stamps on every edge path. Enables the click-an-edge detail panel; omit it to
     * leave edges inert.
     */
    edgeData?: Record<string, ViewerEdge>;
    /**
     * The in-browser relayout for per-container collapse: the embedded model plus
     * the bundle's `renderCollapsedView`. Omit it to leave the collapse controls (if
     * the SVG carries any) inert and fall back to the two-view toggle.
     */
    relayout?: ViewerRelayout;
    /**
     * Root to scope every lookup and event listener to. Pass `document` for the
     * standalone HTML viewer (one instance per page); pass the custom element
     * itself when more than one viewer may share a page.
     */
    root: ParentNode & EventTarget;
    /**
     * Raw ASL for each state, keyed by state name. Enables the click-a-state detail
     * panel; omit it to run the viewer without one (pan/zoom/search/minimap still work).
     */
    stateData?: Record<string, AslState>;
}

/** Parameters for {@link ViewerHandle.setContent}. */
export interface SetViewerContentParams {
    /** Freshly-rendered markup for the `data-sfn="content"` node, from `buildViewerContent`. */
    contentHtml: string;
    /** Viewer-facing detail for each edge in the new content, keyed by `data-edge-id`. */
    edgeData?: Record<string, ViewerEdge>;
    /** Raw ASL for each state in the new content, keyed by state name. */
    stateData?: Record<string, AslState>;
}

/** Handle returned by {@link attachViewer} for cleanup and imperative control. */
export interface ViewerHandle {
    /** Remove every event listener this viewer attached. Idempotent. */
    destroy(): void;
    /** Recentre and rescale the diagram to fit the stage. */
    fit(): void;
    /**
     * Swap in a freshly-rendered diagram in place, preserving pan/zoom, search query,
     * minimap visibility, which view (expanded/collapsed) is active, and an open detail
     * panel whose subject still exists.
     */
    setContent(params: SetViewerContentParams): void;
}

/**
 * Wire up the interactive viewer inside `root`.
 *
 * `root` must already contain the toolbar, stage, and (if `stateData` is passed) panel
 * markup produced by {@link wrapSvgInInteractiveHtml} or the custom element — this
 * function only attaches behaviour, it does not build markup.
 *
 * @param params - Attachment parameters
 * @param params.edgeData - Detail per edge id; enables the click-an-edge panel
 * @param params.root - Scope for every lookup and listener
 * @param params.stateData - Raw ASL per state; enables the click-a-state panel
 * @returns A handle to re-fit the diagram or tear down every listener
 *
 * @example
 * ```typescript
 * const handle = attachViewer({ edgeData, root: document, stateData });
 * // later
 * handle.destroy();
 * ```
 */
export function attachViewer(params: AttachViewerParams): ViewerHandle {
    const { root } = params;
    const data: ViewerData = { edgeData: params.edgeData, stateData: params.stateData };

    // `Document.ownerDocument` is always null, so normalize both cases to "the
    // document this viewer's focus checks should read from".
    const ownerDoc: Document | null = root instanceof Document ? root : root.ownerDocument;

    const stage = hook(root, 'stage');
    const content = hook(root, 'content');
    const zoomLabel = hook(root, 'zoom-label');
    if (!stage || !content || !zoomLabel) {
        // Markup wasn't built (or hasn't upgraded yet) - nothing to attach to.
        return { destroy: () => {}, fit: () => {}, setContent: () => {} };
    }

    const registry = createListenerRegistry();
    const { cleanups } = registry;

    // Marks an element root as carrying a live viewer, for stylesheet rules that must
    // only ever apply to interactive instances - a non-interactive `<sfn-diagram>`
    // shares the `data-sfn-viewer` attribute but is just an inline SVG whose layout
    // those rules (container sizing, see viewerStyles.ts) would otherwise disturb.
    if (root instanceof Element) {
        root.setAttribute('data-sfn-interactive', '');
        cleanups.push(() => root.removeAttribute('data-sfn-interactive'));
    }

    const viewport = createViewport({ content, registry, root, stage, zoomLabel });
    const panel = createDetailPanel({ content, data, ownerDoc, registry, root, stage, viewport });

    // A click or Enter on a per-container collapse control toggles that container;
    // anything else selects for the detail panel. The collapse module is created
    // last (it needs the minimap), so the dispatcher reaches it through this binding.
    let collapse: CollapseToggle | null = null;
    const activate = (activateParams: { moveFocus: boolean; target: EventTarget | null }): void => {
        if (collapse && collapse.handleActivation(activateParams.target)) return;
        panel.selectFromTarget(activateParams);
    };

    attachKeyboardHandlers({ activate, registry, root, stage, viewport, panel });
    const panZoom = attachPanZoom({ activate, ownerDoc, registry, root, stage, viewport });
    const search = createSearch({ content, ownerDoc, registry, root, viewport });
    const minimap = createMinimap({
        ownerDoc,
        panZoom,
        registry,
        root,
        searchInput: search.input,
        stage,
        viewport,
    });
    collapse = createCollapseToggle({
        content,
        minimap,
        ownerDoc,
        panel,
        registry,
        relayout: params.relayout,
        root,
        search,
        viewport,
    });

    /**
     * Swap in a freshly-rendered diagram in place. See {@link ViewerHandle.setContent}.
     */
    const setContent = (setContentParams: SetViewerContentParams): void => {
        const { contentHtml, edgeData: nextEdgeData, stateData: nextStateData } = setContentParams;
        const collapsedWasActive = collapse!.isCollapsedActive();

        // An update landing inside the typing debounce window would otherwise let the
        // queued pass run afterwards and re-centre on its first hit, undoing the
        // viewport this call is about to preserve. The search.run below covers the
        // pending query anyway - it reads the input's current value.
        search.cancelPending();

        data.stateData = nextStateData;
        data.edgeData = nextEdgeData;

        panel.clearEdgeSelection();
        content.innerHTML = contentHtml;
        // The tab stops and accessible names sat on the elements just replaced.
        panel.refreshSemantics();

        collapse!.restoreViews({ collapsedWasActive });

        // Same rule the collapse-toggle click handler applies: a freshly swapped-in
        // view can cross the auto-hide node-count threshold in either direction, so
        // the minimap's visibility must be re-derived from the view now actually on
        // screen rather than left at whatever it was for the old content.
        const activeView = collapse!.activeView();
        if (activeView) {
            minimap.applyAutoVisibility(activeView.dataset.sfnMinimapAuto === '1');
        }

        search.refreshSearchables();
        // Rebuilt from a clean clone before search/selection reapply their own classes
        // to the live SVG - search.run's `.sfn-dim`/`.sfn-hit` and restoreSelection's
        // `.sfn-edge-selected` would otherwise get baked into the thumbnail clone too.
        minimap.rebuildThumbnail();
        search.run();
        panel.restoreSelection();
        if (viewport.adjusted) viewport.apply();
        else viewport.fit();
    };

    viewport.fit();

    return {
        destroy(): void {
            for (const cleanup of cleanups) cleanup();
            cleanups.length = 0;
        },
        fit: viewport.fit,
        setContent,
    };
}
