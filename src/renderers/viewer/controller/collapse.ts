import { hook, type ListenerRegistry } from './dom';
import type { Minimap } from './minimap';
import type { DetailPanel } from './panel';
import type { Search } from './search';
import type { Viewport } from './viewport';

/**
 * The collapse/expand toggle. Present only when generateHtml() shipped two
 * pre-rendered views (expanded and fully collapsed containers) - see
 * wrapSvgInInteractiveHtml's collapsedSvg param. Swaps which view is visible; search
 * state and the minimap thumbnail are reset against the now-active view since both
 * derive from it.
 */

/** Parameters for {@link createCollapseToggle}. */
export interface CreateCollapseToggleParams {
    /** The `data-sfn="content"` node holding the rendered view(s). */
    content: HTMLElement;
    /** The minimap, rebuilt against the newly-visible view. */
    minimap: Minimap;
    /** The detail panel, closed when the view it points at is hidden. */
    panel: DetailPanel;
    /** Listener registry for the toggle's click handler. */
    registry: ListenerRegistry;
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

/** The toggle's view bookkeeping, for `setContent`. */
export interface CollapseToggle {
    /** The view currently on screen, or null when the content has no view wrappers. */
    activeView(): HTMLElement | null;
    /** Whether the collapsed view is present and currently visible. */
    isCollapsedActive(): boolean;
    /**
     * Re-resolve the views after a content swap, keeping the previously-visible one on
     * screen and showing or hiding the toggle to match whether both views exist.
     */
    restoreViews(params: RestoreViewsParams): void;
}

/** Wire up the collapse/expand toggle inside `root`, if the toolbar has one. */
export function createCollapseToggle(params: CreateCollapseToggleParams): CollapseToggle {
    const { content, minimap, panel, registry, root, search, viewport } = params;
    const { on } = registry;

    const collapseToggle = hook(root, 'collapse-toggle');
    // Re-resolved by setContent after a content swap - a `let` rather than a `const` so
    // the click handler below (attached once, here) keeps seeing whichever views are
    // currently in the DOM instead of the ones present at attach time.
    let expandedView = content.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
    let collapsedView = content.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;

    if (collapseToggle) {
        on(collapseToggle, 'click', () => {
            if (!expandedView || !collapsedView) return;
            expandedView.hidden = !expandedView.hidden;
            collapsedView.hidden = !collapsedView.hidden;
            collapseToggle.textContent = collapsedView.hidden ? 'Collapse' : 'Expand';
            // "Expanded" is a state (the expanded view is what's showing), not the
            // button's own action label - the two disagree once the view is collapsed.
            collapseToggle.setAttribute('aria-expanded', collapsedView.hidden ? 'true' : 'false');
            search.clearQuery();
            // The highlighted paths belong to the view being hidden; the panel would
            // otherwise keep pointing at elements no longer on screen.
            panel.closePanel();
            search.refreshSearchables();
            minimap.rebuildThumbnail();
            const activeView = collapsedView.hidden ? expandedView : collapsedView;
            minimap.applyAutoVisibility(activeView.dataset.sfnMinimapAuto === '1');
            viewport.fit();
        });
    }

    return {
        activeView(): HTMLElement | null {
            return expandedView && !expandedView.hidden ? expandedView : collapsedView;
        },
        isCollapsedActive(): boolean {
            return collapsedView !== null && !collapsedView.hidden;
        },
        restoreViews(restoreParams: RestoreViewsParams): void {
            const { collapsedWasActive } = restoreParams;
            expandedView = content.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
            collapsedView = content.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;

            if (expandedView && collapsedView) {
                expandedView.hidden = collapsedWasActive;
                collapsedView.hidden = !collapsedWasActive;
                if (collapseToggle) {
                    collapseToggle.hidden = false;
                    collapseToggle.textContent = collapsedView.hidden ? 'Collapse' : 'Expand';
                }
            } else if (collapseToggle) {
                collapseToggle.hidden = true;
            }
        },
    };
}
