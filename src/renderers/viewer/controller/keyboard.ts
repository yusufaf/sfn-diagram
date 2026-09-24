import type { ListenerRegistry } from './dom';
import type { DetailPanel } from './panel';
import type { Playback } from './playback';
import type { Viewport } from './viewport';

/**
 * Keyboard and focus handling for the diagram itself: Escape closes the panel,
 * Enter/Space selects the focused node or edge, and tabbing to one keeps it in view.
 * Playback's own shortcuts (Space, the arrow keys, Home and End) ride along here.
 * The search box and minimap register their own shortcuts (`/` and `m`) themselves.
 */

/** Parameters for {@link attachKeyboardHandlers}. */
export interface AttachKeyboardHandlersParams {
    /** What Enter/Space on a focused element activates: a collapse control or a selection. */
    activate: (params: { moveFocus: boolean; target: EventTarget | null }) => void;
    /** The detail panel, closed on Escape. */
    panel: DetailPanel;
    /** Execution playback, driven by Space, the arrow keys, Home and End. */
    playback: Playback;
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
    const { activate, panel, playback, registry, root, stage, viewport } = params;
    const { on } = registry;

    on(root, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Escape') panel.closePanel();
    });

    // Playback's shortcuts are document-wide, but only outside a text field - Space and
    // the arrows belong to the search box while it has focus - and never over a focused
    // node, where Space already means "select this state".
    if (playback.enabled) {
        on(root, 'keydown', (event) => {
            const keyboardEvent = event as KeyboardEvent;
            const target = keyboardEvent.target;
            if (target instanceof Element) {
                if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
                if (keyboardEvent.key === ' ' && target.closest('[data-state-id], [data-edge-id]')) {
                    return;
                }
            }
            if (!playback.handleKey(keyboardEvent.key)) return;
            // Space scrolls, Home/End jump the document - neither makes sense here.
            keyboardEvent.preventDefault();
        });
    }

    on(stage, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        // Space would otherwise scroll the stage (an overflow: hidden container still
        // honours the default scroll action a native button would suppress on its own).
        keyboardEvent.preventDefault();
        activate({ moveFocus: true, target: event.target });
    });

    // `[data-sfn="stage"]` is `overflow: hidden`, which a browser still scrolls
    // programmatically to reveal a newly focused descendant - fighting the
    // translate-based pan model this viewer uses instead (and desyncing the minimap,
    // which tracks that translate). Tabbing to a node/edge therefore resets any such
    // scroll immediately and, if the element still isn't visible, re-centres it the
    // same way search already does.
    on(stage, 'focusin', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const group = target?.closest('[data-state-id], [data-edge-id], [data-sfn-collapse-target]');
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
