import { hook, type ListenerRegistry } from './dom';
import type { Viewport } from './viewport';

/**
 * State-name search: dims non-matching state groups, highlights and cycles through
 * hits with Enter/Shift+Enter, and claims `/` as the focus-the-search-box shortcut.
 */

/** Parameters for {@link createSearch}. */
export interface CreateSearchParams {
    /** The `data-sfn="content"` node holding the rendered view(s). */
    content: HTMLElement;
    /** The document focus checks read from; null when `root` is detached. */
    ownerDoc: Document | null;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups and the `/` shortcut. */
    root: ParentNode & EventTarget;
    /** Transform state, for centring on a hit. */
    viewport: Viewport;
}

/** The search box's controls, for the collapse toggle and `setContent`. */
export interface Search {
    /** Drop a queued (debounced) search pass without running it. */
    cancelPending(): void;
    /** Empty the search box and drop every highlight. */
    clearQuery(): void;
    /** The `data-sfn="search"` input, if the toolbar has one. */
    input: HTMLInputElement | null;
    /** Re-collect the state groups to search, against the now-active view. */
    refreshSearchables(): void;
    /** Run the current query against the searchables without moving the viewport. */
    run(): void;
}

/** Wire up the search box inside `root`. */
export function createSearch(params: CreateSearchParams): Search {
    const { content, ownerDoc, registry, root, viewport } = params;
    const { on } = registry;

    const searchInput = hook(root, 'search') as HTMLInputElement | null;
    const searchCount = hook(root, 'search-count');
    // Scoped to the active view (not `content` directly) so a hidden alternate
    // view's states never show up as search hits - see the collapse toggle.
    function computeSearchables(): HTMLElement[] {
        return Array.from((viewport.activeSvg() ?? content).querySelectorAll<HTMLElement>('[data-state-id]'));
    }
    let searchables = computeSearchables();
    let hits: HTMLElement[] = [];
    let hitIndex = 0;

    // A search pass touches every state group, which is visible jank on a large
    // diagram when it runs on every keystroke - so typing is coalesced into one pass
    // per pause. Short enough that the result still feels live.
    const SEARCH_DEBOUNCE_MS = 120;
    let pendingSearch: ReturnType<typeof setTimeout> | null = null;

    function cancelPendingSearch(): void {
        if (pendingSearch === null) return;
        clearTimeout(pendingSearch);
        pendingSearch = null;
    }
    registry.cleanups.push(cancelPendingSearch);

    function clearSearch(): void {
        cancelPendingSearch();
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
        if (shouldCenter) viewport.centerOn(current);
    }

    if (searchInput) {
        const applyTypedSearch = (): void => {
            pendingSearch = null;
            runSearch();
            if (hits.length) viewport.centerOn(hits[0]);
        };
        on(searchInput, 'input', () => {
            cancelPendingSearch();
            // Clearing the box drops the highlights at once - a lingering dim after
            // backspacing the last character would read as a stuck search.
            if (!searchInput.value.trim()) {
                clearSearch();
                return;
            }
            pendingSearch = setTimeout(applyTypedSearch, SEARCH_DEBOUNCE_MS);
        });
        on(searchInput, 'keydown', (event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (keyboardEvent.key === 'Enter') {
                keyboardEvent.preventDefault();
                // Enter inside the debounce window settles the typed query first, so
                // it cycles from that query's hits rather than the previous one's.
                if (pendingSearch !== null) {
                    cancelPendingSearch();
                    applyTypedSearch();
                }
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

    return {
        cancelPending: cancelPendingSearch,
        clearQuery(): void {
            if (searchInput) searchInput.value = '';
            clearSearch();
        },
        input: searchInput,
        refreshSearchables(): void {
            searchables = computeSearchables();
        },
        run: runSearch,
    };
}
