import type { ListenerRegistry } from './dom';
import type { DetailPanel, ViewerSelection } from './panel';

/**
 * Deep links: the selected state or edge, mirrored into `location.hash` so a reader
 * can send a colleague straight to it.
 *
 * Only the standalone HTML document takes part. `location.hash` belongs to the page,
 * and an embedded `<sfn-diagram>` is a component on someone else's page - possibly
 * one of several, all sharing the one hash - so it never reads or writes it. The
 * standalone document is the page, which is exactly the distinction `panZoom`'s
 * engagement rule already draws.
 */

/** The fragment prefix, so a viewer link can never collide with an element id. */
const HASH_PREFIX = '#sfn=';

/** Parameters for {@link attachHashLinks}. */
export interface AttachHashLinksParams {
    /** The document whose `location` is read and written; null when `root` is detached. */
    ownerDoc: Document | null;
    /** The panel whose selection the fragment mirrors. */
    panel: DetailPanel;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** The viewer's scope. Anything but a whole document opts out. */
    root: ParentNode & EventTarget;
}

/** What the viewer controller needs back from the deep-link layer. */
export interface HashLinks {
    /**
     * Apply whatever selection the current fragment names, if the viewer is taking
     * part and the fragment is one of ours. Safe to call after a content swap.
     */
    applyHash(): void;
}

/**
 * Format a selection as a fragment: `#sfn=state:<id>` or `#sfn=edge:<id>`.
 *
 * The id is percent-encoded, which matters for edges - their ids carry the `->` of
 * the transition they describe.
 */
export function formatSelectionHash(selection: ViewerSelection): string {
    return `${HASH_PREFIX}${selection.kind}:${encodeURIComponent(selection.id)}`;
}

/**
 * Read a selection back out of a fragment.
 *
 * Returns `null` for anything that is not ours - an empty fragment, a plain
 * `#some-element-id`, or a kind this viewer does not know - so a document that uses
 * the fragment for something else of its own is left alone.
 *
 * @param hash - A `location.hash` value, with or without its leading `#`
 * @returns The selection the fragment names, or `null`
 *
 * @example
 * ```typescript
 * parseSelectionHash('#sfn=state:ProcessOrder'); // => { id: 'ProcessOrder', kind: 'state' }
 * parseSelectionHash('#introduction');           // => null
 * ```
 */
export function parseSelectionHash(hash: string): ViewerSelection | null {
    const withHash = hash.startsWith('#') ? hash : '#' + hash;
    if (!withHash.startsWith(HASH_PREFIX)) return null;

    const body = withHash.slice(HASH_PREFIX.length);
    const separator = body.indexOf(':');
    if (separator <= 0) return null;

    const kind = body.slice(0, separator);
    if (kind !== 'edge' && kind !== 'state') return null;

    // An id that arrives mis-encoded (a stray `%` from hand-editing) would otherwise
    // throw out of a hashchange handler rather than just failing to match anything.
    let id: string;
    try {
        id = decodeURIComponent(body.slice(separator + 1));
    } catch {
        return null;
    }
    return id ? { id, kind } : null;
}

/**
 * Keep `location.hash` and the detail panel's selection in step, in both directions.
 *
 * Selecting rewrites the fragment and closing clears it, both with `replaceState`:
 * clicking through six states should not bury the page the reader came from under six
 * history entries, so Back leaves the document exactly as it does today.
 *
 * @param params - Deep-link parameters
 * @param params.ownerDoc - The document whose `location` is read and written
 * @param params.panel - The panel whose selection the fragment mirrors
 * @param params.registry - Listener registry for the `hashchange` handler
 * @param params.root - The viewer's scope; only a whole document takes part
 * @returns Controls for applying the current fragment
 *
 * @example
 * ```typescript
 * const hash = attachHashLinks({ ownerDoc, panel, registry, root });
 * hash.applyHash(); // open whatever #sfn=state:… the document was loaded with
 * ```
 */
export function attachHashLinks(params: AttachHashLinksParams): HashLinks {
    const { ownerDoc, panel, registry, root } = params;

    const view = ownerDoc?.defaultView ?? null;
    // Not `ownerDoc !== null`: an embedded element has one too. This is the same test
    // panZoom uses to decide whether the viewer owns the page's scroll gestures.
    const isDocument = root instanceof Document && view !== null && panel.hasPanelData;
    // And the fragment has to be free. A document that arrived with someone else's
    // fragment keeps it: claiming the hash on the reader's first click would overwrite
    // it, and clearing it on close would then destroy it outright. Ours is fine - a
    // deep link is exactly what we are here to honour.
    const claimable =
        isDocument && (view.location.hash === '' || parseSelectionHash(view.location.hash) !== null);
    if (!claimable) return { applyHash: () => {} };

    // Set while a fragment is being applied to the panel, so the panel's own
    // selection notification does not write back over the fragment that caused it.
    // Without it a link into a state the diagram no longer has erases itself: select()
    // closes the panel, the listener sees "nothing selected" and clears the URL, and
    // the reader can no longer see or copy what they were sent - nor retry it after
    // the diagram is regenerated.
    let applying = false;

    /** Write `next` (or clear ours) without adding to the back stack. */
    const writeHash = (next: string | null): void => {
        if (applying) return;
        const { location } = view;
        const target =
            next !== null
                ? next
                : // Only ours gets cleared: a document that also uses the fragment for
                  // an anchor of its own should keep it when the panel closes.
                  parseSelectionHash(location.hash) === null
                  ? null
                  : location.pathname + location.search;
        if (target === null || location.hash === target) return;

        // A document with an opaque origin - srcdoc, a data: URL, about:blank - is not
        // allowed to hand replaceState a URL at all, and throwing out of a selection
        // listener would take the panel down with it. Swallowed rather than latched
        // off: the same call also throws on Safari's rate limit (about 100 in 30
        // seconds), and a reader clicking quickly through a large diagram should not
        // lose deep links for the rest of the page's life over it. An opaque origin
        // has no address to share anyway, so retrying there costs one caught throw
        // per click and nothing else. Probing `location.origin === 'null'` up front
        // would be cheaper and wrong - Chromium reports that for `file://` too, which
        // is where a standalone document usually lives.
        try {
            view.history.replaceState(view.history.state, '', target);
        } catch {
            // Deep links are a convenience; the panel is not.
        }
    };

    panel.onSelectionChange((selection) => {
        writeHash(selection ? formatSelectionHash(selection) : null);
    });

    /** Apply `wanted` without the resulting selection writing back over the URL. */
    const applySelection = (wanted: ViewerSelection): void => {
        applying = true;
        try {
            // `select` closes when the id names nothing in the current content, which
            // also takes care of a stale link into a diagram that has since been
            // edited - and the fragment survives that, so it can be read and retried.
            panel.select(wanted);
        } finally {
            applying = false;
        }
    };

    const applyHash = (): void => {
        const wanted = parseSelectionHash(view.location.hash);
        if (wanted) applySelection(wanted);
    };

    // replaceState never fires hashchange, so this only ever hears the reader: a link
    // followed in the same tab, or the address bar edited by hand.
    registry.on(view, 'hashchange', () => {
        const wanted = parseSelectionHash(view.location.hash);
        if (wanted) {
            applySelection(wanted);
        } else if (view.location.hash === '' || view.location.hash === '#') {
            panel.closePanel();
        }
    });

    return { applyHash };
}
