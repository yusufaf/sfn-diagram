import { hook, type ListenerRegistry } from './dom';
import type { PanZoom } from './panZoom';
import type { Viewport } from './viewport';

/**
 * Scaled overview of the whole diagram with a draggable viewport rectangle. Built
 * once from a clone of the rendered SVG (text/image/title stripped - illegible at
 * thumbnail size and just extra DOM); the viewport rectangle tracks pan/zoom via the
 * viewport's onApply hook. Placed as a sibling of the content node inside the stage,
 * so it sits outside the panned/zoomed transform.
 */

/** Parameters for {@link createMinimap}. */
export interface CreateMinimapParams {
    /** The document focus checks read from; null when `root` is detached. */
    ownerDoc: Document | null;
    /** Pan/zoom layer, so a minimap drag engages the viewer like a stage press does. */
    panZoom: PanZoom;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups and the `m` shortcut. */
    root: ParentNode & EventTarget;
    /** The search box, whose focus must not have `m` toggle the minimap mid-word. */
    searchInput: HTMLInputElement | null;
    /** The `data-sfn="stage"` node whose size the viewport rectangle mirrors. */
    stage: HTMLElement;
    /** Transform state this module reads and, on a minimap drag, drives. */
    viewport: Viewport;
}

/** The minimap's controls, all no-ops when the toolbar has no minimap. */
export interface Minimap {
    /**
     * Re-apply the now-active view's auto-visibility rule. A no-op once the user has
     * toggled the minimap by hand - their choice wins over the node-count threshold.
     */
    applyAutoVisibility(autoHidden: boolean): void;
    /** Rebuild the thumbnail from a fresh clone of the active view's SVG. */
    rebuildThumbnail(): void;
}

/** Wire up the minimap inside `root`, if its markup is present. */
export function createMinimap(params: CreateMinimapParams): Minimap {
    const { ownerDoc, panZoom, registry, root, searchInput, stage, viewport } = params;
    const { on } = registry;

    const minimap = hook(root, 'minimap');
    const minimapThumb = hook(root, 'minimap-thumb');
    const minimapViewport = hook(root, 'minimap-viewport');
    const minimapToggle = hook(root, 'minimap-toggle');

    if (!minimap || !minimapThumb || !minimapViewport || !minimapToggle) {
        return { applyAutoVisibility: () => {}, rebuildThumbnail: () => {} };
    }

    const buildMinimapThumbnail = (): void => {
        const source = viewport.activeSvg();
        if (!source) return;
        const clone = source.cloneNode(true) as SVGSVGElement;
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.style.width = '100%';
        clone.style.height = '100%';
        clone.style.display = 'block';
        // defs (arrowhead markers etc.) carries ids that would otherwise collide with
        // the original SVG's - invalid HTML, and a latent bug if a marker ever needs
        // to render differently per-copy. Edges keep their marker-end url(#...)
        // attributes, but with no matching id in the document they just draw without
        // an arrowhead, which doesn't matter at thumbnail scale.
        for (const node of Array.from(clone.querySelectorAll('text, image, title, desc, defs'))) {
            node.remove();
        }
        // The clone is taken from the live SVG *after* applySelectableSemantics has
        // already run on it, so without this it would carry every tabindex/role/
        // aria-label onto a scaled-down, decorative copy - duplicate tab stops a
        // keyboard user could land on. The minimap div itself is aria-hidden, which
        // keeps this out of the accessibility tree but does nothing about
        // keyboard focus, so tabindex has to go explicitly.
        for (const node of [
            clone,
            ...Array.from(clone.querySelectorAll('[tabindex], [role], [aria-label]')),
        ]) {
            node.removeAttribute('tabindex');
            node.removeAttribute('role');
            node.removeAttribute('aria-label');
        }
        minimapThumb.textContent = ''; // clear a previous thumbnail before rebuilding
        minimapThumb.appendChild(clone);
    };

    // The thumbnail's own box replicates the meet-scaling the SVG's
    // preserveAspectRatio already does when the diagram's aspect ratio doesn't
    // match the box's, so viewport placement lines up with what's actually drawn.
    const minimapGeometry = (): { offsetX: number; offsetY: number; scale: number } => {
        const size = viewport.svgSize();
        const box = minimapThumb.getBoundingClientRect();
        const minimapScale = Math.min(box.width / size.width, box.height / size.height);
        return {
            offsetX: (box.width - size.width * minimapScale) / 2,
            offsetY: (box.height - size.height * minimapScale) / 2,
            scale: minimapScale,
        };
    };

    const updateMinimapViewport = (): void => {
        if (minimap.classList.contains('sfn-minimap-collapsed')) return;
        // Also hidden by CSS while a compact-mode bottom sheet is open; the thumb
        // then has no box, and a rect computed against it would be garbage.
        if (minimapThumb.getClientRects().length === 0) return;
        const geometry = minimapGeometry();
        minimapViewport.style.left = (-viewport.translateX / viewport.scale) * geometry.scale + geometry.offsetX + 'px';
        minimapViewport.style.top = (-viewport.translateY / viewport.scale) * geometry.scale + geometry.offsetY + 'px';
        minimapViewport.style.width = Math.max(0, (stage.clientWidth / viewport.scale) * geometry.scale) + 'px';
        minimapViewport.style.height = Math.max(0, (stage.clientHeight / viewport.scale) * geometry.scale) + 'px';
    };

    const jumpToMinimapPoint = (clientX: number, clientY: number): void => {
        const geometry = minimapGeometry();
        const box = minimapThumb.getBoundingClientRect();
        const contentX = (clientX - box.left - geometry.offsetX) / geometry.scale;
        const contentY = (clientY - box.top - geometry.offsetY) / geometry.scale;
        viewport.translateX = stage.clientWidth / 2 - contentX * viewport.scale;
        viewport.translateY = stage.clientHeight / 2 - contentY * viewport.scale;
        viewport.adjusted = true;
        viewport.apply();
    };

    // Set once the viewer toggles the minimap themselves, so the collapse/expand
    // toggle's auto-visibility rule (below) stops overriding their choice.
    let minimapUserToggled = false;

    // Keeps the toolbar button's aria-pressed in sync with the minimap's actual
    // visibility - "pressed" reads as "the minimap is showing", the inverse of the
    // collapsed class - so it can never fall out of step with the class it mirrors.
    const syncMinimapToggleState = (): void => {
        minimapToggle.setAttribute(
            'aria-pressed',
            minimap.classList.contains('sfn-minimap-collapsed') ? 'false' : 'true',
        );
    };

    const toggleMinimap = (): void => {
        minimapUserToggled = true;
        minimap.classList.toggle('sfn-minimap-collapsed');
        updateMinimapViewport();
        syncMinimapToggleState();
    };

    const applyMinimapAutoVisibility = (autoHidden: boolean): void => {
        if (minimapUserToggled) return;
        minimap.classList.toggle('sfn-minimap-collapsed', autoHidden);
        updateMinimapViewport();
        syncMinimapToggleState();
    };

    let minimapDragging = false;
    // Stop propagation throughout: the minimap sits inside the stage, so without
    // it every drag here would also trigger the stage's own pan-the-canvas handler.
    on(minimapThumb, 'pointerdown', (event) => {
        const pointerEvent = event as PointerEvent;
        pointerEvent.stopPropagation();
        // The stage's own pointerdown never sees this press, so engage here too -
        // a minimap drag is as deliberate as one on the stage.
        panZoom.engage();
        minimapDragging = true;
        minimapThumb.setPointerCapture(pointerEvent.pointerId);
        jumpToMinimapPoint(pointerEvent.clientX, pointerEvent.clientY);
    });
    on(minimapThumb, 'pointermove', (event) => {
        if (!minimapDragging) return;
        const pointerEvent = event as PointerEvent;
        pointerEvent.stopPropagation();
        jumpToMinimapPoint(pointerEvent.clientX, pointerEvent.clientY);
    });
    on(minimapThumb, 'pointerup', (event) => {
        if (!minimapDragging) return;
        const pointerEvent = event as PointerEvent;
        pointerEvent.stopPropagation();
        minimapDragging = false;
        minimapThumb.releasePointerCapture(pointerEvent.pointerId);
    });
    on(minimapThumb, 'wheel', (event) => event.stopPropagation(), { passive: true });

    on(minimapToggle, 'click', toggleMinimap);
    on(root, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'm' && ownerDoc?.activeElement !== searchInput) {
            toggleMinimap();
        }
    });

    buildMinimapThumbnail();
    syncMinimapToggleState();
    viewport.onApply.push(updateMinimapViewport);

    return { applyAutoVisibility: applyMinimapAutoVisibility, rebuildThumbnail: buildMinimapThumbnail };
}
