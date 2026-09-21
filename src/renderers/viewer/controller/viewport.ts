import { hook, type ListenerRegistry } from './dom';

/**
 * The viewer's transform state - scale and translation applied to the content node -
 * plus the geometry helpers every other module reads to place things on the stage.
 * Pointer/wheel handling lives in `panZoom.ts`; this is only the state and the maths.
 */

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

/** A rectangle in stage-local pixels. */
export interface StageArea {
    bottom: number;
    left: number;
    right: number;
    top: number;
}

/** Parameters for {@link createViewport}. */
export interface CreateViewportParams {
    /** The `data-sfn="content"` node the transform is applied to. */
    content: HTMLElement;
    /** Listener registry, for the stage resize observer's teardown. */
    registry: ListenerRegistry;
    /** Scope for hook lookups (the detail panel, when measuring the visible area). */
    root: ParentNode;
    /** The `data-sfn="stage"` node the content is fitted and centred within. */
    stage: HTMLElement;
    /** The `data-sfn="zoom-label"` node showing the current scale as a percentage. */
    zoomLabel: HTMLElement;
}

/** Transform state and geometry helpers shared by every controller module. */
export interface Viewport {
    /** The SVG of whichever pre-rendered view is currently visible. */
    activeSvg(): SVGSVGElement | null;
    /**
     * Whether the user has panned/zoomed by hand. Once true, `setContent` keeps the
     * current viewport instead of re-fitting - a user who has already framed the
     * diagram themselves should not be yanked back to a fit view by every keystroke.
     */
    adjusted: boolean;
    /** Push the current transform to the DOM and notify every `onApply` callback. */
    apply(): void;
    /** Pan so that `group` sits in the middle of the visible stage area. */
    centerOn(group: Element): void;
    /** Recentre and rescale the diagram to fit the stage. */
    fit(): void;
    /**
     * Blocks that need to react to every pan/zoom (the minimap viewport rect) push a
     * callback here, so the core stays unaware of them.
     */
    onApply: Array<() => void>;
    /**
     * Re-derives everything that follows the viewport (the minimap's viewport rect)
     * without touching the transform - for when the visible area changed instead,
     * such as the detail panel opening or closing.
     */
    refreshViewportOverlays(): void;
    scale: number;
    /** The active SVG's declared size, falling back to the content node's box. */
    svgSize(): { width: number; height: number };
    translateX: number;
    translateY: number;
    /** The part of the stage a user can actually see, net of an overlapping panel. */
    visibleStageArea(): StageArea;
}

/**
 * Create the viewport for a viewer instance. Observes the stage for resizes so
 * viewport overlays stay in step with the visible area.
 */
export function createViewport(params: CreateViewportParams): Viewport {
    const { content, registry, root, stage, zoomLabel } = params;

    function apply(): void {
        content.style.transform =
            'translate(' + viewport.translateX + 'px,' + viewport.translateY + 'px) scale(' + viewport.scale + ')';
        zoomLabel.textContent = Math.round(viewport.scale * 100) + '%';
        for (const callback of viewport.onApply) callback();
    }

    // When generateHtml() shipped two pre-rendered views (expanded + fully collapsed,
    // see the collapse/expand toggle), only one is visible (no `hidden` attribute) at
    // a time. Every reader of "the diagram's SVG" goes through this instead of always
    // reading content's first child, so size/centering/the minimap thumbnail all track
    // whichever view is currently active.
    function activeSvg(): SVGSVGElement | null {
        const visibleView = content.querySelector('[data-sfn-view]:not([hidden])');
        return (
            visibleView ? visibleView.firstElementChild : content.firstElementChild
        ) as SVGSVGElement | null;
    }

    function svgSize(): { width: number; height: number } {
        const svg = activeSvg();
        const width = svg?.getAttribute('width');
        const height = svg?.getAttribute('height');
        return {
            width: width ? parseFloat(width) : content.offsetWidth,
            height: height ? parseFloat(height) : content.offsetHeight,
        };
    }

    function fit(): void {
        const size = svgSize();
        const next = Math.min(stage.clientWidth / size.width, stage.clientHeight / size.height);
        viewport.scale = isFinite(next) && next > 0 ? next : 1;
        viewport.translateX = (stage.clientWidth - size.width * viewport.scale) / 2;
        viewport.translateY = (stage.clientHeight - size.height * viewport.scale) / 2;
        apply();
    }

    // A node/container group's own translate() gives its centre directly - reading it
    // is cheaper and exact, unlike getBBox() (pre-transform geometry, plus the stage's
    // own CSS transform sits on top). An edge path carries no such transform - its `d`
    // points are already absolute in the same coordinate space - so its own bounding
    // box *is* that space, and centring it needs no transform parsing at all.
    function nodeCenter(group: Element): { x: number; y: number } | null {
        const svg = activeSvg();
        const viewBox = (svg?.getAttribute('viewBox') || '0 0 0 0').split(/[ ,]+/).map(parseFloat);

        const transform = group.getAttribute('transform') || '';
        const match = transform.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
        if (match) {
            // Node coordinates are in viewBox space; shift by its origin to get content-box pixels.
            return { x: parseFloat(match[1]) - viewBox[0], y: parseFloat(match[2]) - viewBox[1] };
        }

        if (typeof (group as SVGGraphicsElement).getBBox === 'function') {
            const box = (group as SVGGraphicsElement).getBBox();
            return {
                x: box.x + box.width / 2 - viewBox[0],
                y: box.y + box.height / 2 - viewBox[1],
            };
        }
        return null;
    }

    // The part of the stage a user can actually see. An open detail panel is a side
    // column that shrinks the stage (so nothing is covered) at full width, but below
    // the compact breakpoint it is a bottom sheet laid over the stage - centring on
    // the stage's midpoint would then land a search hit or a focused node underneath
    // it. Whatever the panel covers along one edge is cut off here; with the panel
    // closed (or not overlapping) this is simply the whole stage.
    function visibleStageArea(): StageArea {
        // Measured with the same fractional geometry as the panel below - the integer
        // clientWidth/clientHeight would round a 512.5px stage up to 513 and the
        // sheet's 512.5px edge would then never be seen to span it.
        const stageRect = stage.getBoundingClientRect();
        const area: StageArea = { bottom: stageRect.height, left: 0, right: stageRect.width, top: 0 };
        const panel = hook(root, 'panel');
        if (!panel || !panel.classList.contains('sfn-open')) return area;

        const panelRect = panel.getBoundingClientRect();
        const covered: StageArea = {
            bottom: Math.min(panelRect.bottom, stageRect.bottom) - stageRect.top,
            left: Math.max(panelRect.left, stageRect.left) - stageRect.left,
            right: Math.min(panelRect.right, stageRect.right) - stageRect.left,
            top: Math.max(panelRect.top, stageRect.top) - stageRect.top,
        };
        if (covered.right <= covered.left || covered.bottom <= covered.top) return area;

        const spansHeight = covered.top <= area.top && covered.bottom >= area.bottom;
        const spansWidth = covered.left <= area.left && covered.right >= area.right;
        if (spansHeight && covered.left > area.left) {
            area.right = covered.left;
        } else if (spansHeight) {
            area.left = covered.right;
        } else if (spansWidth && covered.top > area.top) {
            area.bottom = covered.top;
        } else if (spansWidth) {
            area.top = covered.bottom;
        }
        return area;
    }

    function centerOn(group: Element): void {
        const center = nodeCenter(group);
        if (!center) return;
        const area = visibleStageArea();
        viewport.translateX = (area.left + area.right) / 2 - center.x * viewport.scale;
        viewport.translateY = (area.top + area.bottom) / 2 - center.y * viewport.scale;
        apply();
    }

    function refreshViewportOverlays(): void {
        for (const callback of viewport.onApply) callback();
    }

    const viewport: Viewport = {
        activeSvg,
        adjusted: false,
        apply,
        centerOn,
        fit,
        onApply: [],
        refreshViewportOverlays,
        scale: 1,
        svgSize,
        translateX: 0,
        translateY: 0,
        visibleStageArea,
    };

    // A resize can also change the visible area - and cross the compact breakpoint,
    // revealing a minimap whose viewport rect went stale while the sheet hid it.
    if (typeof ResizeObserver !== 'undefined') {
        const stageResizeObserver = new ResizeObserver(() => refreshViewportOverlays());
        stageResizeObserver.observe(stage);
        registry.cleanups.push(() => stageResizeObserver.disconnect());
    }

    return viewport;
}
