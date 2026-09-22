import { hook, type ListenerRegistry } from './dom';
import type { Minimap } from './minimap';
import type { DetailPanel } from './panel';
import type { Search } from './search';
import type { Viewport } from './viewport';
import { minimapStartsCollapsed } from '../minimapThreshold';
import type { RelayoutModel, RenderCollapsedViewParams, RenderCollapsedViewResult } from '../relayout';

/**
 * Container collapsing, in one of two modes:
 *
 * - **Relayout** — generateHtml() embedded a {@link RelayoutModel} and the relayout
 *   bundle. Every open container carries a `[data-sfn-collapse-target]` control in its
 *   header, and every collapsed placeholder one to expand it again; activating one
 *   re-renders the single view with that container toggled. The toolbar toggle
 *   collapses the document's `collapse` selection (every container by default), or
 *   expands everything.
 * - **Two views** — the content holds two pre-rendered views (expanded and fully
 *   collapsed, see wrapSvgInInteractiveHtml's collapsedSvg param) and the toolbar
 *   toggle swaps which one is visible. This is what `generateViewerUpdate` still
 *   produces, so a `setContent` update switches the viewer to this mode.
 *
 * Either way, search state and the minimap thumbnail are reset against the view now
 * on screen, since both derive from it.
 */

/** The relayout hook-up: the embedded model plus the bundle's render function. */
export interface ViewerRelayout {
    /** The embedded {@link RelayoutModel}. */
    model: RelayoutModel;
    /** `renderCollapsedView` from the relayout bundle. */
    render: (params: RenderCollapsedViewParams) => RenderCollapsedViewResult;
}

/** Parameters for {@link createCollapseToggle}. */
export interface CreateCollapseToggleParams {
    /** The `data-sfn="content"` node holding the rendered view(s). */
    content: HTMLElement;
    /** The minimap, rebuilt against the newly-visible view. */
    minimap: Minimap;
    /** The document focus is moved within after a relayout; null when `root` is detached. */
    ownerDoc: Document | null;
    /** The detail panel, closed when the view it points at is hidden. */
    panel: DetailPanel;
    /** Listener registry for the toggle's click handler. */
    registry: ListenerRegistry;
    /** The in-browser relayout, when the document shipped one. */
    relayout?: ViewerRelayout;
    /** Scope for hook lookups. */
    root: ParentNode;
    /** The search box, cleared and re-scoped to the newly-visible view. */
    search: Search;
    /** Transform state, re-fitted after a swap. */
    viewport: Viewport;
}

/** Parameters for {@link CollapseToggle.restoreViews}. */
export interface RestoreViewsParams {
    /** Whether the collapsed view was the visible one before the content swap. */
    collapsedWasActive: boolean;
}

/** The toggle's view bookkeeping, for `setContent` and the click/keyboard dispatchers. */
export interface CollapseToggle {
    /** The view currently on screen, or null when the content has no view wrappers. */
    activeView(): HTMLElement | null;
    /**
     * Handle an activation (click, Enter, Space) that may have landed on a
     * per-container collapse control. Returns true when it did and was handled, so
     * the caller leaves the detail panel alone.
     */
    handleActivation(target: EventTarget | null): boolean;
    /**
     * Whether the diagram is showing collapsed: the two-view collapsed view is on
     * screen, or every relayout target is collapsed. `setContent` carries this over
     * to the two-view content it swaps in.
     */
    isCollapsedActive(): boolean;
    /**
     * Re-resolve the views after a content swap, keeping the previously-visible one on
     * screen and showing or hiding the toggle to match whether both views exist. The
     * relayout model, if any, no longer describes the new content and is dropped.
     */
    restoreViews(params: RestoreViewsParams): void;
}

/** Wire up container collapsing inside `root`. */
export function createCollapseToggle(params: CreateCollapseToggleParams): CollapseToggle {
    const { content, minimap, ownerDoc, panel, registry, root, search, viewport } = params;
    const { on } = registry;

    const collapseToggle = hook(root, 'collapse-toggle');
    // Re-resolved by setContent after a content swap - a `let` rather than a `const` so
    // the click handler below (attached once, here) keeps seeing whichever views are
    // currently in the DOM instead of the ones present at attach time.
    let expandedView = content.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
    let collapsedView = content.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;

    // Relayout mode holds until a setContent swap replaces the content the model
    // describes; the two-view markup takes precedence whenever it is present.
    let relayout = params.relayout;
    const collapsedIds = new Set<string>();
    const inRelayoutMode = (): boolean => relayout !== undefined && !expandedView && !collapsedView;

    const allTargetsCollapsed = (): boolean =>
        relayout !== undefined &&
        relayout.model.collapseTargets.length > 0 &&
        relayout.model.collapseTargets.every((id) => collapsedIds.has(id));

    const syncToggleLabel = (): void => {
        if (!collapseToggle) return;
        const collapsed = inRelayoutMode()
            ? allTargetsCollapsed()
            : collapsedView !== null && !collapsedView.hidden;
        collapseToggle.textContent = collapsed ? 'Expand' : 'Collapse';
        // "Expanded" is a state (the expanded view is what's showing), not the
        // button's own action label - the two disagree once the view is collapsed.
        collapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    /** Common tail of every view change: re-derive everything that follows the view. */
    const afterViewChange = (autoHidden: boolean): void => {
        search.refreshSearchables();
        minimap.rebuildThumbnail();
        minimap.applyAutoVisibility(autoHidden);
        syncToggleLabel();
    };

    /**
     * Re-render the single view for the current `collapsedIds`. Returns the new
     * node count, or null when the relayout is unavailable.
     */
    const rerender = (): number | null => {
        if (!relayout) return null;
        const { nodeCount, svg } = relayout.render({
            collapsedIds: [...collapsedIds],
            model: relayout.model,
        });
        search.cancelPending();
        panel.clearEdgeSelection();
        content.innerHTML = svg;
        panel.refreshSemantics();
        afterViewChange(minimapStartsCollapsed({ nodeCount }));
        search.run();
        // The selected state may now be hidden inside a placeholder; restoreSelection
        // closes the panel in that case rather than leaving it pointing at nothing.
        panel.restoreSelection();
        return nodeCount;
    };

    const toggleContainer = (containerId: string): void => {
        // Focus only moves when the control being activated had it (keyboard); the
        // old control leaves with the old view, so this is read before the swap.
        const hadFocus =
            ownerDoc !== null &&
            ownerDoc.activeElement !== null &&
            ownerDoc.activeElement.hasAttribute('data-sfn-collapse-target');

        if (collapsedIds.has(containerId)) collapsedIds.delete(containerId);
        else collapsedIds.add(containerId);
        if (rerender() === null) return;

        // Keep the reader where they were: same scale, the toggled container centred,
        // and keyboard focus on its control again so Enter toggles it straight back.
        const group = content.querySelector(`[data-state-id="${cssEscape(containerId)}"]`);
        if (group) viewport.centerOn(group);
        else viewport.fit();
        const control = content.querySelector(
            `[data-sfn-collapse-target="${cssEscape(containerId)}"]`,
        ) as HTMLElement | SVGElement | null;
        if (hadFocus && control) control.focus({ preventScroll: true });
    };

    if (collapseToggle) {
        on(collapseToggle, 'click', () => {
            if (inRelayoutMode() && relayout) {
                if (allTargetsCollapsed()) collapsedIds.clear();
                else {
                    collapsedIds.clear();
                    for (const id of relayout.model.collapseTargets) collapsedIds.add(id);
                }
                search.clearQuery();
                panel.closePanel();
                if (rerender() !== null) viewport.fit();
                return;
            }
            if (!expandedView || !collapsedView) return;
            expandedView.hidden = !expandedView.hidden;
            collapsedView.hidden = !collapsedView.hidden;
            search.clearQuery();
            // The highlighted paths belong to the view being hidden; the panel would
            // otherwise keep pointing at elements no longer on screen.
            panel.closePanel();
            const activeView = collapsedView.hidden ? expandedView : collapsedView;
            afterViewChange(activeView.dataset.sfnMinimapAuto === '1');
            viewport.fit();
        });
    }

    return {
        activeView(): HTMLElement | null {
            return expandedView && !expandedView.hidden ? expandedView : collapsedView;
        },
        handleActivation(target: EventTarget | null): boolean {
            if (!inRelayoutMode()) return false;
            const element = target instanceof Element ? target : null;
            const control = element ? element.closest('[data-sfn-collapse-target]') : null;
            if (!control) return false;
            toggleContainer(control.getAttribute('data-sfn-collapse-target')!);
            return true;
        },
        isCollapsedActive(): boolean {
            if (inRelayoutMode()) return allTargetsCollapsed();
            return collapsedView !== null && !collapsedView.hidden;
        },
        restoreViews(restoreParams: RestoreViewsParams): void {
            const { collapsedWasActive } = restoreParams;
            expandedView = content.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
            collapsedView = content.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;
            relayout = undefined;
            collapsedIds.clear();

            if (expandedView && collapsedView) {
                expandedView.hidden = collapsedWasActive;
                collapsedView.hidden = !collapsedWasActive;
                if (collapseToggle) {
                    collapseToggle.hidden = false;
                    syncToggleLabel();
                }
            } else if (collapseToggle) {
                collapseToggle.hidden = true;
            }
        },
    };
}

/**
 * Escape a state id for use inside a double-quoted attribute selector. `CSS.escape`
 * is the standard way, but the bundle also runs where `CSS` is absent, so this quotes
 * the two characters that can break out of the quoted value.
 */
function cssEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
