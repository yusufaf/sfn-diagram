import { hook, type ListenerRegistry } from './dom';
import { MAX_SCALE, MIN_SCALE, type Viewport } from './viewport';

/**
 * Pointer and wheel handling on the stage: drag to pan, wheel to zoom, the toolbar
 * zoom buttons, and the "engaged" rule that decides when an embedded viewer may take
 * over the host page's scroll gestures.
 */

/** Parameters for {@link attachPanZoom}. */
export interface AttachPanZoomParams {
    /** What a click that did not turn into a drag activates: a collapse control or a selection. */
    activate: (params: { moveFocus: boolean; target: EventTarget | null }) => void;
    /** The document focus checks read from; null when `root` is detached. */
    ownerDoc: Document | null;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups and the engagement focus checks. */
    root: ParentNode & EventTarget;
    /** The `data-sfn="stage"` node the gestures are bound to. */
    stage: HTMLElement;
    /** Transform state this module drives. */
    viewport: Viewport;
}

/** Controls other modules need from the pan/zoom layer. */
export interface PanZoom {
    /**
     * Mark the viewer as engaged: the user has deliberately pressed on it, so wheel
     * zoom and touch panning are claimed from the host page until they press elsewhere.
     */
    engage(): void;
}

/** Wire up drag-to-pan, wheel zoom, the zoom buttons, and engagement tracking. */
export function attachPanZoom(params: AttachPanZoomParams): PanZoom {
    const { activate, ownerDoc, registry, root, stage, viewport } = params;
    const { on } = registry;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let travel = 0;
    let downTarget: EventTarget | null = null;
    const CLICK_SLOP = 4;

    // Whether the viewer may take over the browser's own scroll gestures - wheel zoom
    // and, via the `sfn-engaged` class (touch-action: none), touch panning. Both
    // would otherwise trap a host page's scroll the moment it reached an embedded
    // `<sfn-diagram>`. So an embedded viewer only claims them once the user has
    // pressed on its stage (until they press somewhere else on the page) or moved
    // focus into it; a ctrl+wheel (a trackpad pinch) is always a deliberate zoom.
    // The standalone document is the whole page - nothing else there to scroll.
    let pointerEngaged = root instanceof Document;

    function focusWithin(candidate: EventTarget | Element | null | undefined): boolean {
        return candidate instanceof Node && root.contains(candidate);
    }

    function isEngaged(): boolean {
        return pointerEngaged || focusWithin(ownerDoc?.activeElement);
    }

    function syncEngagedClass(engaged: boolean): void {
        stage.classList.toggle('sfn-engaged', engaged);
    }
    syncEngagedClass(isEngaged());

    function engage(): void {
        pointerEngaged = true;
        syncEngagedClass(true);
    }

    // The pointer whose press engaged a previously un-engaged viewer, until it lifts.
    // Flipping touch-action from inside pointerdown does not affect the gesture
    // already in progress: a swipe meant to scroll the page still scrolls it and ends
    // in pointercancel - but the viewer would now be engaged, and the *next* swipe
    // would pan the diagram instead. A diagram filling most of the screen leaves
    // nowhere outside to press to undo that, so a cancelled press is unwound instead.
    // A mouse never fires pointercancel, so its behaviour is untouched.
    let engagingPointerId: number | null = null;

    if (ownerDoc && !(root instanceof Document)) {
        // Capture phase: a host page's own handlers (menus, drag-and-drop, carousels)
        // routinely stopPropagation() on pointerdown, which in the bubble phase would
        // never let this run and leave the viewer engaged - and the wheel claimed -
        // for good.
        on(
            ownerDoc,
            'pointerdown',
            (event) => {
                if (focusWithin(event.target)) return;
                pointerEngaged = false;
                syncEngagedClass(isEngaged());
            },
            { capture: true },
        );
        on(root, 'focusin', () => syncEngagedClass(true));
        // `activeElement` is not yet settled during focusout, so where focus is
        // heading is read off the event instead.
        on(root, 'focusout', (event) => {
            syncEngagedClass(pointerEngaged || focusWithin((event as FocusEvent).relatedTarget));
        });
    }

    function wheelZoomIntended(wheelEvent: WheelEvent): boolean {
        return wheelEvent.ctrlKey || isEngaged();
    }

    on(
        stage,
        'wheel',
        (event) => {
            const wheelEvent = event as WheelEvent;
            if (!wheelZoomIntended(wheelEvent)) return;
            wheelEvent.preventDefault();
            const rect = stage.getBoundingClientRect();
            const mx = wheelEvent.clientX - rect.left;
            const my = wheelEvent.clientY - rect.top;
            const factor = wheelEvent.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
            viewport.translateX = mx - (mx - viewport.translateX) * (next / viewport.scale);
            viewport.translateY = my - (my - viewport.translateY) * (next / viewport.scale);
            viewport.scale = next;
            viewport.adjusted = true;
            viewport.apply();
        },
        { passive: false },
    );

    // Single-pointer pan only: with touch-action: none on the stage a second finger
    // now reaches these handlers too, and following it would jitter the pan between
    // the two. Whichever pointer went down first owns the drag until it lifts.
    let dragPointerId: number | null = null;

    on(stage, 'pointerdown', (event) => {
        const pointerEvent = event as PointerEvent;
        if (!isEngaged()) engagingPointerId = pointerEvent.pointerId;
        engage();
        // A drag whose pointer still holds capture owns the stage. One that lost it
        // without a pointerup/pointercancel (a synthetic pointer id that capture
        // refused, for instance) is stale, and the new pointer takes over instead of
        // panning being wedged for good.
        if (dragging && dragPointerId !== null && stage.hasPointerCapture(dragPointerId)) {
            return;
        }
        dragging = true;
        dragPointerId = pointerEvent.pointerId;
        travel = 0;
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
        // Remember what was pressed: setPointerCapture retargets every later pointer
        // event to the stage, so by pointerup e.target is no longer the node.
        downTarget = pointerEvent.target;
        try {
            stage.setPointerCapture(pointerEvent.pointerId);
        } catch {
            // Not an active pointer (a synthetic event): the drag still runs on the
            // plain pointermove/pointerup events that bubble up to the stage.
        }
    });
    on(stage, 'pointermove', (event) => {
        const pointerEvent = event as PointerEvent;
        if (!dragging || pointerEvent.pointerId !== dragPointerId) return;
        const dx = pointerEvent.clientX - lastX;
        const dy = pointerEvent.clientY - lastY;
        travel += Math.abs(dx) + Math.abs(dy);
        // Only start panning once the pointer has clearly moved, so a click that
        // jitters by a pixel still opens the detail panel.
        if (travel > CLICK_SLOP) {
            stage.classList.add('sfn-dragging');
            viewport.translateX += dx;
            viewport.translateY += dy;
            viewport.adjusted = true;
            viewport.apply();
        }
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
    });
    function endDrag(pointerEvent: PointerEvent): void {
        dragging = false;
        dragPointerId = null;
        stage.classList.remove('sfn-dragging');
        if (stage.hasPointerCapture(pointerEvent.pointerId)) {
            stage.releasePointerCapture(pointerEvent.pointerId);
        }
    }
    on(stage, 'pointerup', (event) => {
        const pointerEvent = event as PointerEvent;
        if (pointerEvent.pointerId === engagingPointerId) engagingPointerId = null;
        if (!dragging || pointerEvent.pointerId !== dragPointerId) return;
        endDrag(pointerEvent);
        if (travel <= CLICK_SLOP) activate({ moveFocus: false, target: downTarget });
        downTarget = null;
    });
    // A cancelled pointer never sends pointerup; without this the drag would stay
    // claimed and every later press on the stage would be ignored.
    on(stage, 'pointercancel', (event) => {
        const pointerEvent = event as PointerEvent;
        if (pointerEvent.pointerId === engagingPointerId) {
            engagingPointerId = null;
            pointerEngaged = false;
            syncEngagedClass(isEngaged());
        }
        if (!dragging || pointerEvent.pointerId !== dragPointerId) return;
        endDrag(pointerEvent);
        downTarget = null;
    });

    const zoomIn = hook(root, 'zoom-in');
    const zoomOut = hook(root, 'zoom-out');
    const zoomFit = hook(root, 'zoom-fit');
    const zoomReset = hook(root, 'zoom-reset');
    if (zoomIn) on(zoomIn, 'click', () => { viewport.scale = Math.min(MAX_SCALE, viewport.scale * 1.2); viewport.adjusted = true; viewport.apply(); });
    if (zoomOut) on(zoomOut, 'click', () => { viewport.scale = Math.max(MIN_SCALE, viewport.scale / 1.2); viewport.adjusted = true; viewport.apply(); });
    if (zoomFit) on(zoomFit, 'click', () => { viewport.adjusted = true; viewport.fit(); });
    if (zoomReset) on(zoomReset, 'click', () => { viewport.scale = 1; viewport.translateX = 0; viewport.translateY = 0; viewport.adjusted = true; viewport.apply(); });

    return { engage };
}
