import type { AslState, ExecutionTimeline } from '../../../types';
import type { ViewerEdge } from '../edgeData';

/**
 * Shared DOM plumbing for the viewer controller modules: hook lookup, listener
 * registration with teardown, and the mutable data the panel reads at click time.
 */

/** A viewer hook element, found by its `data-sfn` attribute within `root`. */
export function hook(root: ParentNode, name: string): HTMLElement | null {
    return root.querySelector('[data-sfn="' + name + '"]');
}

/**
 * The per-state ASL and per-edge detail the viewer was attached with. Held in one
 * mutable record rather than captured values so that `setContent` can swap both in
 * place and every module reads the current data at click time.
 */
export interface ViewerData {
    /** Viewer-facing detail for each edge, keyed by `data-edge-id`. */
    edgeData?: Record<string, ViewerEdge>;
    /** Raw ASL for each state, keyed by state name. */
    stateData?: Record<string, AslState>;
    /**
     * The execution timeline, when the document was built from a history: what the
     * detail panel reads to list a state's runs, with their payloads when those were
     * embedded too.
     */
    timeline?: ExecutionTimeline;
}

/** Whether a data record was supplied and has at least one entry. */
export function hasEntries(record: Record<string, unknown> | undefined): boolean {
    return record !== undefined && Object.keys(record).length > 0;
}

/**
 * Registers event listeners (and any other teardown work) so that
 * {@link ViewerHandle.destroy} can undo all of it in one pass.
 */
export interface ListenerRegistry {
    /** Teardown callbacks, run in registration order by `destroy`. */
    cleanups: Array<() => void>;
    /** `addEventListener` whose matching `removeEventListener` is queued for `destroy`. */
    on(
        target: EventTarget,
        type: string,
        listener: (event: Event) => void,
        options?: AddEventListenerOptions,
    ): void;
}

/** Create an empty {@link ListenerRegistry}. */
export function createListenerRegistry(): ListenerRegistry {
    const cleanups: Array<() => void> = [];
    return {
        cleanups,
        on(target, type, listener, options) {
            target.addEventListener(type, listener, options);
            cleanups.push(() => target.removeEventListener(type, listener, options));
        },
    };
}
