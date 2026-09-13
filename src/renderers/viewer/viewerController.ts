import type { AslState } from '../../types';
import type { ViewerEdge } from './edgeData';

/**
 * Runtime controller for the interactive viewer: pan/zoom, state search, minimap,
 * and (when state or edge data is supplied) the click-for-detail panel.
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

// Module-scope rather than per-attachViewer-call: it hands out a unique suffix for a
// panel-title id across every viewer instance on one page. Safe as a plain counter -
// the compiled bundle wraps this whole module in a per-document IIFE (see
// buildViewerScript), and the custom element imports the module once per page, so
// there is exactly one counter per document either way.
let viewerInstanceCount = 0;

/** Parameters for {@link attachViewer}. */
export interface AttachViewerParams {
    /**
     * Viewer-facing detail for each edge, keyed by the `data-edge-id` the renderer
     * stamps on every edge path. Enables the click-an-edge detail panel; omit it to
     * leave edges inert.
     */
    edgeData?: Record<string, ViewerEdge>;
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
    let stateData = params.stateData;
    let edgeData = params.edgeData;
    let hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
    let hasEdgeData = edgeData !== undefined && Object.keys(edgeData).length > 0;
    // Whether the panel markup exists at all - decided once from the initial render and
    // never revisited, since setContent only ever swaps `content`'s innerHTML, never the
    // toolbar/panel chrome outside it.
    const hasPanelData = hasStateData || hasEdgeData;

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

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    // Set on the viewer's first pan/zoom/wheel/button interaction. Once true, setContent
    // keeps the current viewport instead of re-fitting - a user who has already framed
    // the diagram themselves should not be yanked back to a fit view by every keystroke.
    let viewportAdjusted = false;
    const MIN_SCALE = 0.05;
    const MAX_SCALE = 8;
    // Blocks that need to react to every pan/zoom (the minimap viewport rect) push a
    // callback here, so the core stays unaware of them.
    const onApply: Array<() => void> = [];
    const cleanups: Array<() => void> = [];

    // Marks an element root as carrying a live viewer, for stylesheet rules that must
    // only ever apply to interactive instances - a non-interactive `<sfn-diagram>`
    // shares the `data-sfn-viewer` attribute but is just an inline SVG whose layout
    // those rules (container sizing, see viewerStyles.ts) would otherwise disturb.
    if (root instanceof Element) {
        root.setAttribute('data-sfn-interactive', '');
        cleanups.push(() => root.removeAttribute('data-sfn-interactive'));
    }

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

    /** A rectangle in stage-local pixels. */
    interface StageArea {
        bottom: number;
        left: number;
        right: number;
        top: number;
    }

    // The part of the stage a user can actually see. An open detail panel is a side
    // column that shrinks the stage (so nothing is covered) at full width, but below
    // the compact breakpoint it is a bottom sheet laid over the stage - centring on
    // the stage's midpoint would then land a search hit or a focused node underneath
    // it. Whatever the panel covers along one edge is cut off here; with the panel
    // closed (or not overlapping) this is simply the whole stage.
    function visibleStageArea(): StageArea {
        const area: StageArea = { bottom: stage!.clientHeight, left: 0, right: stage!.clientWidth, top: 0 };
        const panel = hook(root, 'panel');
        if (!panel || !panel.classList.contains('sfn-open')) return area;

        const stageRect = stage!.getBoundingClientRect();
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
        translateX = (area.left + area.right) / 2 - center.x * scale;
        translateY = (area.top + area.bottom) / 2 - center.y * scale;
        apply();
    }

    // Re-derives everything that follows the viewport (the minimap's viewport rect)
    // without touching the transform - for when the visible area changed instead,
    // such as the detail panel opening or closing.
    function refreshViewportOverlays(): void {
        for (const callback of onApply) callback();
    }

    // --- detail panel (optional) ---------------------------------------------------

    /** How a node/edge was selected - shared by {@link openPanel} and {@link openEdgePanel}. */
    interface SelectionOptions {
        /**
         * Move keyboard focus into the panel once it opens. `true` for a keyboard
         * activation (Enter/Space); `false` for a pointer click - yanking focus into
         * the panel on every mouse click would be a hostile surprise for a mouse user.
         */
        moveFocus: boolean;
        /** The element that triggered this selection, so focus can return to it on close. */
        trigger: Element;
    }

    let openPanel: (stateId: string, options: SelectionOptions) => void = () => {};
    let openEdgePanel: (edgeId: string, options: SelectionOptions) => void = () => {};
    let closePanel: () => void = () => {};

    // The currently-selected state or edge, if any - restored by setContent after a
    // content swap, and cleared whenever the panel closes.
    let selection: { id: string; kind: 'edge' | 'state' } | null = null;
    // The element to return focus to on close - set by every open, read only when
    // focus actually made it into the panel (see closePanel).
    let panelTrigger: Element | null = null;

    // Every path carrying the selected edge's id, so the highlight can be lifted again
    // without re-querying — an id may contain characters that need CSS escaping, and an
    // attribute-value scan avoids depending on `CSS.escape` being present.
    let selectedEdgePaths: Element[] = [];
    let selectedEdgeEndpoints: Element[] = [];

    function clearEdgeSelection(): void {
        for (const path of selectedEdgePaths) path.classList.remove('sfn-edge-selected');
        for (const node of selectedEdgeEndpoints) node.classList.remove('sfn-edge-endpoint');
        selectedEdgePaths = [];
        selectedEdgeEndpoints = [];
    }

    /** Elements whose `data-*` attribute equals `value`, scoped to the visible view. */
    function elementsByDataValue(attribute: string, value: string): Element[] {
        const scope = activeSvg() ?? content!;
        return Array.from(scope.querySelectorAll('[' + attribute + ']')).filter(
            (element) => element.getAttribute(attribute) === value,
        );
    }

    function selectEdge(edgeId: string, endpoints: string[]): void {
        clearEdgeSelection();
        selectedEdgePaths = elementsByDataValue('data-edge-id', edgeId);
        for (const path of selectedEdgePaths) path.classList.add('sfn-edge-selected');
        for (const stateId of endpoints) {
            for (const node of elementsByDataValue('data-state-id', stateId)) {
                node.classList.add('sfn-edge-endpoint');
                selectedEdgeEndpoints.push(node);
            }
        }
    }

    if (hasPanelData) {
        const panel = hook(root, 'panel');
        const panelTitle = hook(root, 'panel-title');
        const panelBody = hook(root, 'panel-body');
        const panelClose = hook(root, 'panel-close');

        if (panel && panelTitle && panelBody && panelClose) {
            // Reuses the standalone document's own `id="sfn-panel-title"` (legacyIds)
            // when present, and otherwise mints one unique to this instance - keeps
            // `elementRuntime.test.ts`'s no-duplicate-ids guarantee even with several
            // `<sfn-diagram>` elements sharing a page.
            const titleId = panelTitle.id || 'sfn-panel-title-' + ++viewerInstanceCount;
            panelTitle.id = titleId;
            panel.setAttribute('aria-labelledby', titleId);
            // Defensive, alongside the static markup in buildViewerBody - covers the
            // pre-existing-markup progressive-enhancement path too.
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('tabindex', '-1');

            const focusPanel = (): void => {
                panel.focus({ preventScroll: true });
            };

            const SUMMARY_FIELDS = ['Type', 'Resource', 'Next', 'Retry', 'Catch', 'Assign'] as const;
            const EDGE_FIELDS = ['from', 'to', 'type', 'condition', 'label'] as const;
            // The panel's own labels, not content — the record keys are lowercase, but a
            // reader expects title case beside the state panel's ASL field names.
            const EDGE_FIELD_LABELS: Record<string, string> = {
                condition: 'Condition',
                from: 'From',
                label: 'Label',
                to: 'To',
                type: 'Type',
            };

            const summarize = (value: unknown): string => {
                if (Array.isArray(value)) return value.length + ' entr' + (value.length === 1 ? 'y' : 'ies');
                if (value && typeof value === 'object') return Object.keys(value).join(', ');
                return String(value);
            };

            /** One `<dt>`/`<dd>` row. textContent only — content here is untrusted. */
            const fieldRow = (term: string, detail: string): HTMLElement => {
                const row = document.createElement('div');
                row.className = 'sfn-field';
                const termElement = document.createElement('dt');
                termElement.textContent = term;
                const detailElement = document.createElement('dd');
                detailElement.textContent = detail;
                row.appendChild(termElement);
                row.appendChild(detailElement);
                return row;
            };

            /** Fill and open the panel. Shared by the state and edge views. */
            const showPanel = (title: string, rows: HTMLElement[], raw: unknown): void => {
                panelTitle.textContent = title;

                const list = document.createElement('dl');
                for (const row of rows) list.appendChild(row);

                const pre = document.createElement('pre');
                pre.className = 'sfn-panel-json';
                // The standalone HTML viewer's Puppeteer test suite selects this node by
                // id; kept for back-compat alongside the class the CSS actually keys off.
                pre.id = 'sfn-panel-json';
                pre.textContent = JSON.stringify(raw, null, 2);

                panelBody.textContent = '';
                panelBody.appendChild(list);
                panelBody.appendChild(pre);
                panel.classList.add('sfn-open');
                // At full width the side panel just shrank the stage, which changes
                // how much of the diagram the minimap's viewport rect should cover.
                refreshViewportOverlays();
            };

            closePanel = () => {
                // Read before removing sfn-open: that class drives `display: none` in
                // CSS, and a browser force-blurs a focused element the instant it (or an
                // ancestor) leaves layout - by the next line, activeElement would already
                // have moved to <body>, not the panel.
                const activeElement = ownerDoc?.activeElement ?? null;
                panel.classList.remove('sfn-open');
                // The minimap may have been hidden underneath a bottom sheet, its
                // viewport rect left stale by every pan made meanwhile.
                refreshViewportOverlays();
                clearEdgeSelection();
                selection = null;
                if (
                    activeElement &&
                    panel.contains(activeElement) &&
                    panelTrigger &&
                    panelTrigger.isConnected
                ) {
                    (panelTrigger as HTMLElement | SVGElement).focus({ preventScroll: true });
                }
                panelTrigger = null;
            };

            openPanel = (stateId: string, options: SelectionOptions) => {
                const state = stateData?.[stateId] as unknown as Record<string, unknown> | undefined;
                // Virtual nodes (branch/iterator end markers, Distributed Map satellites)
                // have no ASL of their own, so there is nothing to show. Close rather than
                // return: leaving a previously-selected edge highlighted beside a panel
                // describing something else reads as a stuck UI.
                if (!state) {
                    closePanel();
                    return;
                }
                clearEdgeSelection();

                const rows: HTMLElement[] = [];
                for (const field of SUMMARY_FIELDS) {
                    if (state[field] === undefined) continue;
                    rows.push(fieldRow(field, summarize(state[field])));
                }
                showPanel(stateId, rows, state);
                selection = { id: stateId, kind: 'state' };
                panelTrigger = options.trigger;
                if (options.moveFocus) focusPanel();
            };

            openEdgePanel = (edgeId: string, options: SelectionOptions) => {
                const edge = edgeData?.[edgeId] as unknown as Record<string, unknown> | undefined;
                // An id with no entry still opens: the title alone is the `edgeOverrides`
                // key the reader came for, and staying silent would look like a dead click.
                const rows: HTMLElement[] = [];
                if (edge) {
                    for (const field of EDGE_FIELDS) {
                        if (edge[field] === undefined) continue;
                        rows.push(fieldRow(EDGE_FIELD_LABELS[field], String(edge[field])));
                    }
                }
                showPanel(edgeId, rows, edge ?? { id: edgeId });
                selectEdge(
                    edgeId,
                    edge ? [String(edge.from), String(edge.to)] : [],
                );
                selection = { id: edgeId, kind: 'edge' };
                panelTrigger = options.trigger;
                if (options.moveFocus) focusPanel();
            };

            on(panelClose, 'click', closePanel);

            const PANEL_FOCUSABLE_SELECTOR =
                'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

            // Bound to the panel itself, so a mouse user who never enters it is never
            // trapped - it only engages once focus is actually inside. The panel is
            // visually non-modal (the diagram stays interactive beside it), so this is
            // the only thing standing in for a native <dialog>'s focus containment.
            on(panel, 'keydown', (event) => {
                const keyboardEvent = event as KeyboardEvent;
                if (keyboardEvent.key !== 'Tab') return;

                const focusable = Array.from(
                    panel.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE_SELECTOR),
                );
                if (focusable.length === 0) {
                    keyboardEvent.preventDefault();
                    focusPanel();
                    return;
                }

                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                const active = ownerDoc?.activeElement;

                if (keyboardEvent.shiftKey) {
                    if (active === first || active === panel) {
                        keyboardEvent.preventDefault();
                        last.focus({ preventScroll: true });
                    }
                } else if (active === last) {
                    keyboardEvent.preventDefault();
                    first.focus({ preventScroll: true });
                }
            });

            // Makes every selectable state/edge a keyboard tab stop with an accessible
            // name, scoped to `content` so both the expanded and collapsed views (when
            // both exist) get the treatment - the hidden one is untabbable anyway, so
            // this needs no re-run when the collapse toggle switches which view shows.
            const applySelectableSemantics = (): void => {
                for (const group of Array.from(content.querySelectorAll('[data-state-id]'))) {
                    const stateId = group.getAttribute('data-state-id');
                    if (!stateId || !(stateId in (stateData ?? {}))) continue;
                    const label = group.querySelector('title')?.textContent || stateId;
                    group.setAttribute('tabindex', '0');
                    group.setAttribute('role', 'button');
                    group.setAttribute('aria-label', label);
                }

                // Expanded and collapsed views each need their own edge dedup pass -
                // an edge can carry the same data-edge-id in both views, and dedup was
                // previously done across the whole of `content`, so whichever view's
                // elements the query happened to visit first silently claimed every id
                // and the other view's matching edges never became tab stops.
                const viewRoots = content.querySelectorAll('[data-sfn-view]');
                for (const viewRoot of viewRoots.length ? Array.from(viewRoots) : [content]) {
                    // Prefer the hit area (a comfortable target already used for pointer
                    // selection); fall back to the drawn path only when none was rendered
                    // (edgeHitAreas off). Either way, de-duplicated by id so a labelled
                    // edge's separate label rect/text never becomes a second tab stop.
                    const hitAreas = viewRoot.querySelectorAll('[data-edge-hit-area]');
                    const edgeElements = hitAreas.length
                        ? hitAreas
                        : viewRoot.querySelectorAll('path[data-edge-id]');
                    const seenEdgeIds = new Set<string>();
                    for (const element of Array.from(edgeElements)) {
                        const edgeId = element.getAttribute('data-edge-id');
                        if (!edgeId || seenEdgeIds.has(edgeId)) continue;
                        seenEdgeIds.add(edgeId);
                        const label = element.querySelector('title')?.textContent || edgeId;
                        element.setAttribute('tabindex', '0');
                        element.setAttribute('role', 'button');
                        element.setAttribute('aria-label', label);
                    }
                }
            };
            applySelectableSemantics();
        }
    }

    /** Parameters for {@link selectFromTarget}. */
    interface SelectFromTargetParams {
        /** Whether this selection should move keyboard focus into the panel once it opens. */
        moveFocus: boolean;
        /** The event target to resolve a node/edge from - a pointer or keyboard event's. */
        target: EventTarget | null;
    }

    function selectFromTarget(params: SelectFromTargetParams): void {
        const { moveFocus, target } = params;
        if (!hasPanelData) return;
        const element = target instanceof Element ? target : null;
        // A node wins over an edge: node groups are the larger target, and an edge path
        // never sits inside one, so a hit on both means the pointer was over the node.
        const group = element ? element.closest('[data-state-id]') : null;
        if (group) {
            openPanel(group.getAttribute('data-state-id')!, { moveFocus, trigger: group });
            return;
        }
        const edgePath = hasEdgeData && element ? element.closest('[data-edge-id]') : null;
        if (edgePath) {
            openEdgePanel(edgePath.getAttribute('data-edge-id')!, { moveFocus, trigger: edgePath });
        } else {
            closePanel();
        }
    }

    on(root, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Escape') closePanel();
    });

    on(stage, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
        // Space would otherwise scroll the stage (an overflow: hidden container still
        // honours the default scroll action a native button would suppress on its own).
        keyboardEvent.preventDefault();
        selectFromTarget({ moveFocus: true, target: event.target });
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
        const area = visibleStageArea();
        const groupRect = group.getBoundingClientRect();
        const isVisible =
            groupRect.left >= stageRect.left + area.left &&
            groupRect.right <= stageRect.left + area.right &&
            groupRect.top >= stageRect.top + area.top &&
            groupRect.bottom <= stageRect.top + area.bottom;
        if (!isVisible) centerOn(group);
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
            viewportAdjusted = true;
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
            viewportAdjusted = true;
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
        if (travel <= CLICK_SLOP) selectFromTarget({ moveFocus: false, target: downTarget });
        downTarget = null;
    });

    const zoomIn = hook(root, 'zoom-in');
    const zoomOut = hook(root, 'zoom-out');
    const zoomFit = hook(root, 'zoom-fit');
    const zoomReset = hook(root, 'zoom-reset');
    if (zoomIn) on(zoomIn, 'click', () => { scale = Math.min(MAX_SCALE, scale * 1.2); viewportAdjusted = true; apply(); });
    if (zoomOut) on(zoomOut, 'click', () => { scale = Math.max(MIN_SCALE, scale / 1.2); viewportAdjusted = true; apply(); });
    if (zoomFit) on(zoomFit, 'click', () => { viewportAdjusted = true; fit(); });
    if (zoomReset) on(zoomReset, 'click', () => { scale = 1; translateX = 0; translateY = 0; viewportAdjusted = true; apply(); });

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
            // Also hidden by CSS while a compact-mode bottom sheet is open; the thumb
            // then has no box, and a rect computed against it would be garbage.
            if (minimapThumb.getClientRects().length === 0) return;
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
            viewportAdjusted = true;
            apply();
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

        applyMinimapAutoVisibility = (autoHidden: boolean): void => {
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
        onApply.push(updateMinimapViewport);
    }

    // --- collapse / expand toggle (optional) ---------------------------------------
    //
    // Present only when generateHtml() shipped two pre-rendered views (expanded and
    // fully collapsed containers) - see wrapSvgInInteractiveHtml's collapsedSvg param.
    // Swaps which view is visible; search state and the minimap thumbnail are reset
    // against the now-active view since both derive from it.

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
            if (searchInput) searchInput.value = '';
            clearSearch();
            // The highlighted paths belong to the view being hidden; the panel would
            // otherwise keep pointing at elements no longer on screen.
            closePanel();
            searchables = computeSearchables();
            rebuildMinimapThumbnail();
            const activeView = collapsedView.hidden ? expandedView : collapsedView;
            applyMinimapAutoVisibility(activeView.dataset.sfnMinimapAuto === '1');
            fit();
        });
    }

    // Re-open the previously-selected state/edge against the new data, or close the
    // panel when its subject no longer exists (renamed or removed mid-edit).
    function restoreSelection(): void {
        if (!selection) return;
        // Not a user interaction, so focus never moves - the trigger only needs to be a
        // connected element for `SelectionOptions`' sake; nothing later reads it unless
        // focus actually lands in the panel, which moveFocus: false guarantees it won't.
        const options: SelectionOptions = { moveFocus: false, trigger: stage! };
        if (selection.kind === 'state') {
            // openPanel already closes when the id has no entry in the new stateData.
            openPanel(selection.id, options);
        } else if (edgeData?.[selection.id] !== undefined) {
            openEdgePanel(selection.id, options);
        } else {
            closePanel();
        }
    }

    /**
     * Swap in a freshly-rendered diagram in place. See {@link ViewerHandle.setContent}.
     */
    function setContent(setContentParams: SetViewerContentParams): void {
        const { contentHtml, edgeData: nextEdgeData, stateData: nextStateData } = setContentParams;
        const collapsedWasActive = collapsedView !== null && !collapsedView.hidden;

        stateData = nextStateData;
        edgeData = nextEdgeData;
        hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
        hasEdgeData = edgeData !== undefined && Object.keys(edgeData).length > 0;

        clearEdgeSelection();
        content!.innerHTML = contentHtml;

        expandedView = content!.querySelector('[data-sfn-view="expanded"]') as HTMLElement | null;
        collapsedView = content!.querySelector('[data-sfn-view="collapsed"]') as HTMLElement | null;

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

        // Same rule the collapse-toggle click handler applies (line ~683): a freshly
        // swapped-in view can cross the auto-hide node-count threshold in either
        // direction, so the minimap's visibility must be re-derived from the view now
        // actually on screen rather than left at whatever it was for the old content.
        const activeView = expandedView && !expandedView.hidden ? expandedView : collapsedView;
        if (activeView) {
            applyMinimapAutoVisibility(activeView.dataset.sfnMinimapAuto === '1');
        }

        searchables = computeSearchables();
        // Rebuilt from a clean clone before search/selection reapply their own classes
        // to the live SVG - runSearch's `.sfn-dim`/`.sfn-hit` and restoreSelection's
        // `.sfn-edge-selected` would otherwise get baked into the thumbnail clone too.
        rebuildMinimapThumbnail();
        runSearch();
        restoreSelection();
        if (viewportAdjusted) apply();
        else fit();
    }

    fit();

    return {
        destroy(): void {
            for (const cleanup of cleanups) cleanup();
            cleanups.length = 0;
        },
        fit,
        setContent,
    };
}
