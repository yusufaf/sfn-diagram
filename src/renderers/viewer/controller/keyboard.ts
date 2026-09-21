import type { ListenerRegistry } from './dom';
import type { DetailPanel } from './panel';
import type { Viewport } from './viewport';

/**
 * Keyboard and focus handling for the diagram itself: Escape closes the panel,
 * Enter/Space selects the focused node or edge, and tabbing to one keeps it in view.
 * The search box and minimap register their own shortcuts (`/` and `m`) themselves.
 */

/** Parameters for {@link attachKeyboardHandlers}. */
export interface AttachKeyboardHandlersParams {
    /** The detail panel to open and close. */
    panel: DetailPanel;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Root the Escape shortcut listens on. */
    root: EventTarget;
    /** The `data-sfn="stage"` node holding the focusable nodes and edges. */
    stage: HTMLElement;
    /** Transform state, for re-centring a focused element that scrolled out of view. */
    viewport: Viewport;
}

/** Wire up the diagram's keyboard and focus handlers. */
export function attachKeyboardHandlers(params: AttachKeyboardHandlersParams): void {
    const { panel, registry, root, stage, viewport } = params;
    const { on } = registry;

    on(root, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Escape') panel.closePanel();
    });

    on(stage, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        // Space would otherwise scroll the stage (an overflow: hidden container still
        // honours the default scroll action a native button would suppress on its own).
        keyboardEvent.preventDefault();
        panel.selectFromTarget({ moveFocus: true, target: event.target });
    });

    // `[data-sfn="stage"]` is `overflow: hidden`, which a browser still scrolls
    // programmatically to reveal a newly focused descendant - fighting the
    // translate-based pan model this viewer uses instead (and desyncing the minimap,
    // which tracks that translate). Tabbing to a node/edge therefore resets any such
    // scroll immediately and, if the element still isn't visible, re-centres it the
    // same way search already does.
    on(stage, 'focusin', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const group = target?.closest('[data-state-id], [data-edge-id]');
        if (!group) return;

        stage.scrollLeft = 0;
        stage.scrollTop = 0;

        const stageRect = stage.getBoundingClientRect();
        const area = viewport.visibleStageArea();
        const groupRect = group.getBoundingClientRect();
        const isVisible =
            groupRect.left >= stageRect.left + area.left &&
            groupRect.right <= stageRect.left + area.right &&
            groupRect.top >= stageRect.top + area.top &&
            groupRect.bottom <= stageRect.top + area.bottom;
        if (!isVisible) viewport.centerOn(group);
    });
}
