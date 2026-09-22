import { hasEntries, hook, type ListenerRegistry, type ViewerData } from './dom';
import type { Viewport } from './viewport';

/**
 * The click-for-detail panel: opens on a state or edge, shows its summary fields and
 * raw JSON, traps Tab while focus is inside, and highlights a selected edge's path
 * and endpoints. Present only when state or edge data was supplied.
 */

// Module-scope rather than per-attachViewer-call: it hands out a unique suffix for a
// panel-title id across every viewer instance on one page. Safe as a plain counter -
// the compiled bundle wraps this whole module in a per-document IIFE (see
// buildViewerScript), and the custom element imports the module once per page, so
// there is exactly one counter per document either way.
let viewerInstanceCount = 0;

/** How a node/edge was selected - shared by `openPanel` and `openEdgePanel`. */
export interface SelectionOptions {
    /**
     * Move keyboard focus into the panel once it opens. `true` for a keyboard
     * activation (Enter/Space); `false` for a pointer click - yanking focus into
     * the panel on every mouse click would be a hostile surprise for a mouse user.
     */
    moveFocus: boolean;
    /** The element that triggered this selection, so focus can return to it on close. */
    trigger: Element;
}

/** Parameters for {@link DetailPanel.selectFromTarget}. */
export interface SelectFromTargetParams {
    /** Whether this selection should move keyboard focus into the panel once it opens. */
    moveFocus: boolean;
    /** The event target to resolve a node/edge from - a pointer or keyboard event's. */
    target: EventTarget | null;
}

/** Parameters for {@link createDetailPanel}. */
export interface CreateDetailPanelParams {
    /** The `data-sfn="content"` node holding the rendered view(s). */
    content: HTMLElement;
    /** The viewer's current state/edge data, read at click time. */
    data: ViewerData;
    /** The document focus checks read from; null when `root` is detached. */
    ownerDoc: Document | null;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups. */
    root: ParentNode;
    /** The `data-sfn="stage"` node - the focus trigger stand-in when restoring a selection. */
    stage: HTMLElement;
    /** Transform state, for refreshing overlays as the panel opens and closes. */
    viewport: Viewport;
}

/** The detail panel's controls, all no-ops when the viewer has no panel data. */
export interface DetailPanel {
    /** Drop the highlight from the currently-selected edge's paths and endpoints. */
    clearEdgeSelection(): void;
    /** Close the panel, clearing the selection and returning focus to its trigger. */
    closePanel(): void;
    /** Whether any state or edge data was supplied at attach time. */
    hasPanelData: boolean;
    /**
     * Make every selectable state/edge in the current content a keyboard tab stop
     * with an accessible name again - for after the content has been swapped, since
     * the attributes live on the elements that were replaced.
     */
    refreshSemantics(): void;
    /**
     * Re-open the previously-selected state/edge against the current data, or close
     * the panel when its subject no longer exists (renamed or removed mid-edit).
     */
    restoreSelection(): void;
    /** Open the panel for the node/edge under `target`, or close it when there is none. */
    selectFromTarget(params: SelectFromTargetParams): void;
}

/**
 * Wire up the detail panel inside `root`. Decides once, from the initial data,
 * whether the panel markup exists at all - `setContent` only ever swaps `content`'s
 * innerHTML, never the toolbar/panel chrome outside it.
 */
export function createDetailPanel(params: CreateDetailPanelParams): DetailPanel {
    const { content, data, ownerDoc, registry, root, stage, viewport } = params;
    const { on } = registry;
    const hasPanelData = hasEntries(data.stateData) || hasEntries(data.edgeData);

    let openPanel: (stateId: string, options: SelectionOptions) => void = () => {};
    let openEdgePanel: (edgeId: string, options: SelectionOptions) => void = () => {};
    let closePanel: () => void = () => {};
    let refreshSemantics: () => void = () => {};

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
        const scope = viewport.activeSvg() ?? content;
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
                viewport.refreshViewportOverlays();
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
                viewport.refreshViewportOverlays();
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
                const state = data.stateData?.[stateId] as unknown as Record<string, unknown> | undefined;
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
                const edge = data.edgeData?.[edgeId] as unknown as Record<string, unknown> | undefined;
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
                    if (!stateId || !(stateId in (data.stateData ?? {}))) continue;
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
            refreshSemantics = applySelectableSemantics;
        }
    }

    function selectFromTarget(selectParams: SelectFromTargetParams): void {
        const { moveFocus, target } = selectParams;
        if (!hasPanelData) return;
        const element = target instanceof Element ? target : null;
        // A node wins over an edge: node groups are the larger target, and an edge path
        // never sits inside one, so a hit on both means the pointer was over the node.
        const group = element ? element.closest('[data-state-id]') : null;
        if (group) {
            openPanel(group.getAttribute('data-state-id')!, { moveFocus, trigger: group });
            return;
        }
        const edgePath = hasEntries(data.edgeData) && element ? element.closest('[data-edge-id]') : null;
        if (edgePath) {
            openEdgePanel(edgePath.getAttribute('data-edge-id')!, { moveFocus, trigger: edgePath });
        } else {
            closePanel();
        }
    }

    function restoreSelection(): void {
        if (!selection) return;
        // Not a user interaction, so focus never moves - the trigger only needs to be a
        // connected element for `SelectionOptions`' sake; nothing later reads it unless
        // focus actually lands in the panel, which moveFocus: false guarantees it won't.
        const options: SelectionOptions = { moveFocus: false, trigger: stage };
        if (selection.kind === 'state') {
            // openPanel already closes when the id has no entry in the new stateData.
            openPanel(selection.id, options);
        } else if (data.edgeData?.[selection.id] !== undefined) {
            openEdgePanel(selection.id, options);
        } else {
            closePanel();
        }
    }

    return {
        clearEdgeSelection,
        closePanel,
        hasPanelData,
        refreshSemantics: () => refreshSemantics(),
        restoreSelection,
        selectFromTarget,
    };
}
