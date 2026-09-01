import type { AslState } from '../../types';

/**
 * Runtime controller for the interactive viewer: pan/zoom, state search, minimap,
 * and (when state data is supplied) the click-a-state detail panel.
 *
 * This is the single source of truth for viewer behaviour. It is consumed two ways:
 *  - directly, as an ES module, by the `sfn-diagram/element` custom element;
 *  - compiled to a dependency-free script by `scripts/build-viewer-script.mjs` and
 *    inlined into the self-contained HTML document produced by `generateHtml()`.
 *
 * Every lookup is scoped to `root` rather than `document`, so more than one viewer
 * (multiple `<sfn-diagram>` elements on one page) can coexist without colliding —
 * hook elements are found by `data-sfn="..."` attribute, never by `id`.
 */

/** A viewer hook element, found by its `data-sfn` attribute within `root`. */
function hook(root: ParentNode, name: string): HTMLElement | null {
    return root.querySelector('[data-sfn="' + name + '"]');
}

/** Parameters for {@link attachViewer}. */
export interface AttachViewerParams {
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

/** Handle returned by {@link attachViewer} for cleanup and imperative control. */
export interface ViewerHandle {
    /** Remove every event listener this viewer attached. Idempotent. */
    destroy(): void;
    /** Recentre and rescale the diagram to fit the stage. */
    fit(): void;
}

/**
 * Wire up the interactive viewer inside `root`.
 *
 * `root` must already contain the toolbar, stage, and (if `stateData` is passed) panel
 * markup produced by {@link wrapSvgInInteractiveHtml} or the custom element — this
 * function only attaches behaviour, it does not build markup.
 *
 * @param params - Attachment parameters
 * @param params.root - Scope for every lookup and listener
 * @param params.stateData - Raw ASL per state; enables the detail panel
 * @returns A handle to re-fit the diagram or tear down every listener
 *
 * @example
 * ```typescript
 * const handle = attachViewer({ root: document, stateData });
 * // later
 * handle.destroy();
 * ```
 */
export function attachViewer(params: AttachViewerParams): ViewerHandle {
    const { root, stateData } = params;
    const hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;

    // `Document.ownerDocument` is always null, so normalize both cases to "the
    // document this viewer's focus checks should read from".
    const ownerDoc: Document | null = root instanceof Document ? root : root.ownerDocument;

    const stage = hook(root, 'stage');
    const content = hook(root, 'content');
    const zoomLabel = hook(root, 'zoom-label');
    if (!stage || !content || !zoomLabel) {
        // Markup wasn't built (or hasn't upgraded yet) - nothing to attach to.
        return { destroy: () => {}, fit: () => {} };
    }

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    const MIN_SCALE = 0.05;
    const MAX_SCALE = 8;
    // Blocks that need to react to every pan/zoom (the minimap viewport rect) push a
    // callback here, so the core stays unaware of them.
    const onApply: Array<() => void> = [];
    const cleanups: Array<() => void> = [];

    function on(
        target: EventTarget,
        type: string,
        listener: (event: Event) => void,
        options?: AddEventListenerOptions,
    ): void {
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
    }

    function apply(): void {
        content!.style.transform =
            'translate(' + translateX + 'px,' + translateY + 'px) scale(' + scale + ')';
        zoomLabel!.textContent = Math.round(scale * 100) + '%';
        for (const callback of onApply) callback();
    }

    // When generateHtml() shipped two pre-rendered views (expanded + fully collapsed,
    // see the collapse/expand toggle further down), only one is visible (no `hidden`
    // attribute) at a time. Every reader of "the diagram's SVG" goes through this
    // instead of always reading content's first child, so size/centering/the minimap
    // thumbnail all track whichever view is currently active.
    function activeSvg(): SVGSVGElement | null {
        const visibleView = content!.querySelector('[data-sfn-view]:not([hidden])');
        return (
            visibleView ? visibleView.firstElementChild : content!.firstElementChild
        ) as SVGSVGElement | null;
    }

    function svgSize(): { width: number; height: number } {
        const svg = activeSvg();
        const width = svg?.getAttribute('width');
        const height = svg?.getAttribute('height');
        return {
            width: width ? parseFloat(width) : content!.offsetWidth,
            height: height ? parseFloat(height) : content!.offsetHeight,
        };
    }

    function fit(): void {
        const size = svgSize();
        const next = Math.min(stage!.clientWidth / size.width, stage!.clientHeight / size.height);
        scale = isFinite(next) && next > 0 ? next : 1;
        translateX = (stage!.clientWidth - size.width * scale) / 2;
        translateY = (stage!.clientHeight - size.height * scale) / 2;
        apply();
    }

    // Read the group's own translate() rather than measuring it: getBBox() reports
    // pre-transform geometry and the stage applies its own CSS transform on top.
    function nodeCenter(group: Element): { x: number; y: number } | null {
        const transform = group.getAttribute('transform') || '';
        const match = transform.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
        if (!match) return null;
        const svg = activeSvg();
        const viewBox = (svg?.getAttribute('viewBox') || '0 0 0 0').split(/[ ,]+/).map(parseFloat);
        // Node coordinates are in viewBox space; shift by its origin to get content-box pixels.
        return { x: parseFloat(match[1]) - viewBox[0], y: parseFloat(match[2]) - viewBox[1] };
    }

    function centerOn(group: Element): void {
        const center = nodeCenter(group);
        if (!center) return;
        translateX = stage!.clientWidth / 2 - center.x * scale;
        translateY = stage!.clientHeight / 2 - center.y * scale;
        apply();
    }

    // --- detail panel (optional) ---------------------------------------------------

    let openPanel: (stateId: string) => void = () => {};
    let closePanel: () => void = () => {};

    if (hasStateData) {
        const panel = hook(root, 'panel');
        const panelTitle = hook(root, 'panel-title');
        const panelBody = hook(root, 'panel-body');
        const panelClose = hook(root, 'panel-close');

        if (panel && panelTitle && panelBody && panelClose) {
            const SUMMARY_FIELDS = ['Type', 'Resource', 'Next', 'Retry', 'Catch', 'Assign'] as const;

            const summarize = (value: unknown): string => {
                if (Array.isArray(value)) return value.length + ' entr' + (value.length === 1 ? 'y' : 'ies');
                if (value && typeof value === 'object') return Object.keys(value).join(', ');
                return String(value);
            };

            closePanel = () => panel.classList.remove('sfn-open');

            openPanel = (stateId: string) => {
                const state = stateData![stateId] as unknown as Record<string, unknown> | undefined;
                if (!state) return;
                panelTitle.textContent = stateId;

                const list = document.createElement('dl');
                for (const field of SUMMARY_FIELDS) {
                    if (state[field] === undefined) continue;
                    const row = document.createElement('div');
                    row.className = 'sfn-field';
                    const term = document.createElement('dt');
                    term.textContent = field;
                    const detail = document.createElement('dd');
                    // textContent throughout: state content is untrusted and must never be parsed as HTML.
                    detail.textContent = summarize(state[field]);
                    row.appendChild(term);
                    row.appendChild(detail);
                    list.appendChild(row);
                }

                const pre = document.createElement('pre');
                pre.className = 'sfn-panel-json';
                // The standalone HTML viewer's Puppeteer test suite selects this node by
                // id; kept for back-compat alongside the class the CSS actually keys off.
                pre.id = 'sfn-panel-json';
                pre.textContent = JSON.stringify(state, null, 2);

                panelBody.textContent = '';
                panelBody.appendChild(list);
                panelBody.appendChild(pre);
                panel.classList.add('sfn-open');
            };

            on(panelClose, 'click', closePanel);
        }
    }

    function handleStageClick(target: EventTarget | null): void {
        if (!hasStateData) return;
        const group =
            target instanceof Element ? target.closest('[data-state-id]') : null;
        if (group) openPanel(group.getAttribute('data-state-id')!);
        else closePanel();
    }

    on(root, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Escape') closePanel();
    });

    // --- pan / zoom -------------------------------------------------------------

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let travel = 0;
    let downTarget: EventTarget | null = null;
    const CLICK_SLOP = 4;

    on(
        stage,
        'wheel',
        (event) => {
            const wheelEvent = event as WheelEvent;
            wheelEvent.preventDefault();
            const rect = stage.getBoundingClientRect();
            const mx = wheelEvent.clientX - rect.left;
            const my = wheelEvent.clientY - rect.top;
            const factor = wheelEvent.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
            translateX = mx - (mx - translateX) * (next / scale);
            translateY = my - (my - translateY) * (next / scale);
            scale = next;
            apply();
        },
        { passive: false },
    );

    on(stage, 'pointerdown', (event) => {
        const pointerEvent = event as PointerEvent;
        dragging = true;
        travel = 0;
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
        // Remember what was pressed: setPointerCapture retargets every later pointer
        // event to the stage, so by pointerup e.target is no longer the node.
        downTarget = pointerEvent.target;
        stage.setPointerCapture(pointerEvent.pointerId);
    });
    on(stage, 'pointermove', (event) => {
        if (!dragging) return;
        const pointerEvent = event as PointerEvent;
        const dx = pointerEvent.clientX - lastX;
        const dy = pointerEvent.clientY - lastY;
        travel += Math.abs(dx) + Math.abs(dy);
        // Only start panning once the pointer has clearly moved, so a click that
        // jitters by a pixel still opens the detail panel.
        if (travel > CLICK_SLOP) {
            stage.classList.add('sfn-dragging');
            translateX += dx;
            translateY += dy;
            apply();
        }
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
    });
    on(stage, 'pointerup', (event) => {
        if (!dragging) return;
        const pointerEvent = event as PointerEvent;
        dragging = false;
        stage.classList.remove('sfn-dragging');
        stage.releasePointerCapture(pointerEvent.pointerId);
        if (travel <= CLICK_SLOP) handleStageClick(downTarget);
        downTarget = null;
    });

    const zoomIn = hook(root, 'zoom-in');
    const zoomOut = hook(root, 'zoom-out');
    const zoomFit = hook(root, 'zoom-fit');
    const zoomReset = hook(root, 'zoom-reset');
    if (zoomIn) on(zoomIn, 'click', () => { scale = Math.min(MAX_SCALE, scale * 1.2); apply(); });
    if (zoomOut) on(zoomOut, 'click', () => { scale = Math.max(MIN_SCALE, scale / 1.2); apply(); });
    if (zoomFit) on(zoomFit, 'click', fit);
    if (zoomReset) on(zoomReset, 'click', () => { scale = 1; translateX = 0; translateY = 0; apply(); });

    // --- search -------------------------------------------------------------------

    const searchInput = hook(root, 'search') as HTMLInputElement | null;
    const searchCount = hook(root, 'search-count');
    // Scoped to the active view (not `content` directly) so a hidden alternate
    // view's states never show up as search hits - see the toggle further down.
    function computeSearchables(): HTMLElement[] {
        return Array.from((activeSvg() ?? content!).querySelectorAll<HTMLElement>('[data-state-id]'));
    }
    let searchables = computeSearchables();
    let hits: HTMLElement[] = [];
    let hitIndex = 0;

    function clearSearch(): void {
        for (const group of searchables) {
            group.classList.remove('sfn-dim');
            group.classList.remove('sfn-hit');
        }
        hits = [];
        hitIndex = 0;
        if (searchCount) searchCount.textContent = '';
    }

    function runSearch(): void {
        const query = (searchInput?.value ?? '').trim().toLowerCase();
        if (!query) {
            clearSearch();
            return;
        }
        hits = [];
        for (const group of searchables) {
            const id = (group.getAttribute('data-state-id') || '').toLowerCase();
            const matched = id.indexOf(query) !== -1;
            group.classList.toggle('sfn-dim', !matched);
            group.classList.remove('sfn-hit');
            if (matched) hits.push(group);
        }
        hitIndex = 0;
        updateHit(false);
    }

    function updateHit(shouldCenter: boolean): void {
        for (const group of searchables) group.classList.remove('sfn-hit');
        if (!hits.length) {
            if (searchCount) searchCount.textContent = '0 / 0';
            return;
        }
        if (hitIndex >= hits.length) hitIndex = 0;
        if (hitIndex < 0) hitIndex = hits.length - 1;
        const current = hits[hitIndex];
        current.classList.add('sfn-hit');
        if (searchCount) searchCount.textContent = hitIndex + 1 + ' / ' + hits.length;
        if (shouldCenter) centerOn(current);
    }

    if (searchInput) {
        on(searchInput, 'input', () => {
            runSearch();
            if (hits.length) centerOn(hits[0]);
        });
        on(searchInput, 'keydown', (event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (keyboardEvent.key === 'Enter') {
                keyboardEvent.preventDefault();
                hitIndex += keyboardEvent.shiftKey ? -1 : 1;
                updateHit(true);
            } else if (keyboardEvent.key === 'Escape') {
                keyboardEvent.preventDefault();
                searchInput.value = '';
                clearSearch();
                searchInput.blur();
            }
        });
    }
    on(root, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === '/' && ownerDoc?.activeElement !== searchInput) {
            keyboardEvent.preventDefault();
            searchInput?.focus();
        }
    });

    // Reassigned below when the minimap is present, so the collapse/expand toggle
    // (further down) can rebuild the thumbnail without knowing whether one exists.
    let rebuildMinimapThumbnail: () => void = () => {};

    // Reassigned below when the minimap is present, so the collapse/expand toggle can
    // re-apply the now-active view's auto-visibility rule without knowing whether a
    // minimap exists. A no-op once the viewer has toggled the minimap by hand — see
    // `minimapUserToggled` below.
    let applyMinimapAutoVisibility: (autoHidden: boolean) => void = () => {};

    // --- minimap --------------------------------------------------------------
    //
    // Scaled overview of the whole diagram with a draggable viewport rectangle. Built
    // once from a clone of the rendered SVG (text/image/title stripped - illegible at
    // thumbnail size and just extra DOM); the viewport rectangle tracks pan/zoom via
    // the onApply hook above. Placed as a sibling of the content node inside the
    // stage, so it sits outside the panned/zoomed transform.

    const minimap = hook(root, 'minimap');
    const minimapThumb = hook(root, 'minimap-thumb');
    const minimapViewport = hook(root, 'minimap-viewport');
    const minimapToggle = hook(root, 'minimap-toggle');

    if (minimap && minimapThumb && minimapViewport && minimapToggle) {
        const buildMinimapThumbnail = (): void => {
            const source = activeSvg();
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
            for (const node of Array.from(clone.querySelectorAll('text, image, title, defs'))) {
                node.remove();
            }
            minimapThumb.textContent = ''; // clear a previous thumbnail before rebuilding
            minimapThumb.appendChild(clone);
        };
        rebuildMinimapThumbnail = buildMinimapThumbnail;

        // The thumbnail's own box replicates the meet-scaling the SVG's
        // preserveAspectRatio already does when the diagram's aspect ratio doesn't
        // match the box's, so viewport placement lines up with what's actually drawn.
        const minimapGeometry = (): { offsetX: number; offsetY: number; scale: number } => {
            const size = svgSize();
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
            const geometry = minimapGeometry();
            minimapViewport.style.left = (-translateX / scale) * geometry.scale + geometry.offsetX + 'px';
            minimapViewport.style.top = (-translateY / scale) * geometry.scale + geometry.offsetY + 'px';
            minimapViewport.style.width = Math.max(0, (stage!.clientWidth / scale) * geometry.scale) + 'px';
            minimapViewport.style.height = Math.max(0, (stage!.clientHeight / scale) * geometry.scale) + 'px';
        };

        const jumpToMinimapPoint = (clientX: number, clientY: number): void => {
            const geometry = minimapGeometry();
            const box = minimapThumb.getBoundingClientRect();
            const contentX = (clientX - box.left - geometry.offsetX) / geometry.scale;
            const contentY = (clientY - box.top - geometry.offsetY) / geometry.scale;
            translateX = stage!.clientWidth / 2 - contentX * scale;
            translateY = stage!.clientHeight / 2 - contentY * scale;
            apply();
        };

        // Set once the viewer toggles the minimap themselves, so the collapse/expand
        // toggle's auto-visibility rule (below) stops overriding their choice.
        let minimapUserToggled = false;

        const toggleMinimap = (): void => {
            minimapUserToggled = true;
            minimap.classList.toggle('sfn-minimap-collapsed');
            updateMinimapViewport();
        };

        applyMinimapAutoVisibility = (autoHidden: boolean): void => {
            if (minimapUserToggled) return;
            minimap.classList.toggle('sfn-minimap-collapsed', autoHidden);
            updateMinimapViewport();
        };

        let minimapDragging = false;
        // Stop propagation throughout: the minimap sits inside the stage, so without
        // it every drag here would also trigger the stage's own pan-the-canvas handler.
        on(minimapThumb, 'pointerdown', (event) => {
            const pointerEvent = event as PointerEvent;
            pointerEvent.stopPropagation();
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
        onApply.push(updateMinimapViewport);
    }

    // --- collapse / expand toggle (optional) ---------------------------------------
    //
    // Present only when generateHtml() shipped two pre-rendered views (expanded and
    // fully collapsed containers) - see wrapSvgInInteractiveHtml's collapsedSvg param.
    // Swaps which view is visible; search state and the minimap thumbnail are reset
    // against the now-active view since both derive from it.

    const collapseToggle = hook(root, 'collapse-toggle');
    const expandedView = content.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
    const collapsedView = content.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;

    if (collapseToggle && expandedView && collapsedView) {
        on(collapseToggle, 'click', () => {
            expandedView.hidden = !expandedView.hidden;
            collapsedView.hidden = !collapsedView.hidden;
            collapseToggle.textContent = collapsedView.hidden ? 'Collapse' : 'Expand';
            if (searchInput) searchInput.value = '';
            clearSearch();
            searchables = computeSearchables();
            rebuildMinimapThumbnail();
            const activeView = collapsedView.hidden ? expandedView : collapsedView;
            applyMinimapAutoVisibility(activeView.dataset.sfnMinimapAuto === '1');
            fit();
        });
    }

    fit();

    return {
        destroy(): void {
            for (const cleanup of cleanups) cleanup();
            cleanups.length = 0;
        },
        fit,
    };
}
