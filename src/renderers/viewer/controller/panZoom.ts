import { hook, type ListenerRegistry } from './dom';
import { MAX_SCALE, MIN_SCALE, type Viewport } from './viewport';

/**
 * Pointer and wheel handling on the stage: drag to pan, pinch to zoom, wheel to zoom,
 * the toolbar zoom buttons, and the "engaged" rule that decides when an embedded
 * viewer may take over the host page's scroll gestures.
 *
 * Pointers are tracked by id rather than as one `lastX`/`lastY` pair, because the
 * number of them down is what distinguishes the gestures: one pans, two pinch. The
 * `touch-action: none` the stage takes once engaged (see `syncEngagedClass`) is what
 * delivers the second finger here at all, instead of the browser handling it as a
 * page zoom.
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

    // Whichever pointer went down first owns the one-finger drag until it lifts.
    let dragPointerId: number | null = null;

    // Every pointer currently down on the stage, in the order they arrived. One is a
    // pan; two are a pinch; a third is tracked but does not join the gesture, since
    // re-anchoring mid-pinch on a stray palm makes the diagram jump.
    const activePointers = new Map<number, { x: number; y: number }>();

    /**
     * The live pinch, if two pointers are down: the pair driving it, and the span and
     * midpoint they had on the previous move, which the next one is measured against.
     */
    let pinch: { centroidX: number; centroidY: number; distance: number; ids: [number, number] } | null =
        null;

    /** Midpoint and separation of the pinch pair, in stage coordinates. */
    function pinchGeometry(ids: [number, number]): { centroidX: number; centroidY: number; distance: number } | null {
        const first = activePointers.get(ids[0]);
        const second = activePointers.get(ids[1]);
        if (!first || !second) return null;
        const rect = stage.getBoundingClientRect();
        return {
            centroidX: (first.x + second.x) / 2 - rect.left,
            centroidY: (first.y + second.y) / 2 - rect.top,
            distance: Math.hypot(first.x - second.x, first.y - second.y),
        };
    }

    /** Promote the two oldest pointers to a pinch, or end one that lost a finger. */
    function syncPinch(): void {
        const ids = [...activePointers.keys()];
        if (ids.length < 2) {
            pinch = null;
            return;
        }
        const pair: [number, number] = [ids[0], ids[1]];
        // Already pinching with the same pair: leave its baseline alone, or every
        // extra pointer arriving would reset the span and stall the zoom.
        if (pinch && pinch.ids[0] === pair[0] && pinch.ids[1] === pair[1]) return;
        const geometry = pinchGeometry(pair);
        pinch = geometry ? { ...geometry, ids: pair } : null;
    }

    on(stage, 'pointerdown', (event) => {
        const pointerEvent = event as PointerEvent;
        if (!isEngaged()) engagingPointerId = pointerEvent.pointerId;
        engage();

        // A primary pointer is the first of its kind to go down, so anything still
        // tracked when one arrives never ended - a pointerdown whose pointerup was
        // lost. Dropping those here is what keeps the stale-pointer recovery the
        // single-pointer path used to provide: without it a ghost would push every
        // later press into the pinch branch below, and each one-finger drag would be
        // read as a one-sided pinch against coordinates that never move again.
        // A genuine second finger is never primary, so a real pinch is untouched.
        if (pointerEvent.isPrimary) activePointers.clear();
        activePointers.set(pointerEvent.pointerId, { x: pointerEvent.clientX, y: pointerEvent.clientY });

        try {
            stage.setPointerCapture(pointerEvent.pointerId);
        } catch {
            // Not an active pointer (a synthetic event): the gesture still runs on the
            // plain pointermove/pointerup events that bubble up to the stage.
        }

        if (activePointers.size > 1) {
            // A second finger turns the drag into a pinch, and a pinch is never a
            // click however little the fingers move - so the click guard is spent
            // here rather than left to chance. `travel` is also what gates the pan's
            // own slop, and a gesture already under way should not have to re-earn it.
            syncPinch();
            travel = CLICK_SLOP + 1;
            stage.classList.remove('sfn-dragging');
            return;
        }

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
    });

    on(stage, 'pointermove', (event) => {
        const pointerEvent = event as PointerEvent;
        const tracked = activePointers.get(pointerEvent.pointerId);
        if (tracked) {
            tracked.x = pointerEvent.clientX;
            tracked.y = pointerEvent.clientY;
        }

        if (pinch) {
            // A third finger's movement changes nothing: the gesture belongs to the
            // pair that started it.
            if (pointerEvent.pointerId !== pinch.ids[0] && pointerEvent.pointerId !== pinch.ids[1]) return;
            const geometry = pinchGeometry(pinch.ids);
            if (!geometry) return;

            // Spreading the fingers scales up, and the midpoint's own movement pans -
            // both derived from the same pair, so one gesture does not fight the other.
            // Clamp first, then use the ratio actually applied: at the zoom limit the
            // maths has to fall back to a pure pan rather than drifting the diagram.
            const desired =
                pinch.distance > 0 ? viewport.scale * (geometry.distance / pinch.distance) : viewport.scale;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, desired));
            const ratio = next / viewport.scale;

            // Whatever content sat under the old midpoint stays under the new one.
            viewport.translateX = geometry.centroidX - (pinch.centroidX - viewport.translateX) * ratio;
            viewport.translateY = geometry.centroidY - (pinch.centroidY - viewport.translateY) * ratio;
            viewport.scale = next;
            viewport.adjusted = true;
            viewport.apply();

            travel += Math.abs(geometry.centroidX - pinch.centroidX) +
                Math.abs(geometry.centroidY - pinch.centroidY) +
                Math.abs(geometry.distance - pinch.distance);
            pinch = { ...geometry, ids: pinch.ids };
            return;
        }

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

    /**
     * Drop a lifted or cancelled pointer and decide what is left of the gesture.
     *
     * @returns Whether a pinch was in progress, so the caller knows not to treat the
     *   lift as a click - a two-finger gesture never is, however little it moved.
     */
    function releasePointer(pointerEvent: PointerEvent): boolean {
        const wasPinching = pinch !== null;
        activePointers.delete(pointerEvent.pointerId);
        if (stage.hasPointerCapture(pointerEvent.pointerId)) {
            stage.releasePointerCapture(pointerEvent.pointerId);
        }

        if (!wasPinching) return false;

        const remaining = [...activePointers.entries()];
        if (remaining.length >= 2) {
            // A third finger was down; the pinch carries on with the oldest surviving
            // pair, re-baselined so the change of pair is not read as a zoom.
            pinch = null;
            syncPinch();
            return true;
        }

        pinch = null;
        if (remaining.length === 1) {
            // One finger left: hand back to panning, anchored where that finger
            // actually is. Without the re-anchor the first move would be read as a
            // drag all the way from wherever the pan last left off.
            const [id, position] = remaining[0];
            dragging = true;
            dragPointerId = id;
            lastX = position.x;
            lastY = position.y;
        } else {
            dragging = false;
            dragPointerId = null;
            stage.classList.remove('sfn-dragging');
        }
        return true;
    }

    on(stage, 'pointerup', (event) => {
        const pointerEvent = event as PointerEvent;
        if (pointerEvent.pointerId === engagingPointerId) engagingPointerId = null;
        if (releasePointer(pointerEvent)) {
            downTarget = null;
            return;
        }
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
        if (releasePointer(pointerEvent)) {
            downTarget = null;
            return;
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
