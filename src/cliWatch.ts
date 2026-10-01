/**
 * @module
 *
 * The debounced file watcher behind `sfn-diagram --watch`.
 *
 * Like `cliFollow.ts`, everything the loop touches that is hard to pin down — the
 * watcher itself and the debounce timer — arrives as a parameter, so the batching,
 * the serialisation and the teardown are tested without real filesystem events.
 * That matters more here than usual: `fs.watch` fires a different number of events
 * per platform for the same save, reports the directory rather than the file on
 * Windows, and on some editors reports a rename instead of a change. A test that
 * waited on real events would be asserting the platform, not this code.
 */
import { statSync, watch } from 'node:fs';
import { join } from 'node:path';

/** What a watcher hands back, so it can be shut down. */
export interface WatchHandle {
    /** Stop watching. Called for every target when the signal aborts. */
    close: () => void;
}

/** Parameters a {@link WatchFactory} receives. */
export interface WatchFactoryParams {
    /** Called for each change, with the path that changed. */
    onEvent: (params: { path: string }) => void;
    /** The file or directory to watch. */
    target: string;
}

/**
 * How one target is watched. Injected so tests fire events by hand, and so the
 * recursive-directory case can be swapped per platform without touching this file.
 */
export type WatchFactory = (params: WatchFactoryParams) => WatchHandle;

/**
 * The real watcher, built on `node:fs`'s `watch`.
 *
 * Directories are watched recursively so a file created later under a glob's root is
 * seen; files are watched directly. `fs.watch` reports a filename relative to the
 * target it was given, and reports `null` for it on some platforms, so the path handed
 * to `onEvent` is rebuilt from the target rather than trusted as absolute.
 *
 * `recursive` is supported on Windows and macOS everywhere, and on Linux from Node 20
 * — which is this package's floor, so no fallback is needed.
 *
 * An `error` event is swallowed: a watcher whose directory is removed mid-run should
 * stop reporting, not end the process.
 *
 * @returns A {@link WatchFactory} backed by `fs.watch`.
 *
 * @example
 * ```typescript
 * await watchPaths({ …, watch: createFsWatchFactory() });
 * ```
 */
export function createFsWatchFactory(): WatchFactory {
    return ({ onEvent, target }) => {
        const isDirectory = statSyncIsDirectory(target);
        const watcher = watch(
            target,
            { recursive: isDirectory },
            (_event, filename) => {
                // `filename` is relative to `target` for a directory watch, and is the
                // basename (or null) for a file watch, so the usable path is always
                // derived from `target`.
                onEvent({
                    path:
                        filename !== null && isDirectory
                            ? join(target, filename.toString())
                            : target,
                });
            },
        );
        watcher.on('error', () => {
            // A watched directory can be removed while the run is alive. Ending the
            // process over it would be worse than quietly stopping that one watcher.
        });
        return { close: () => watcher.close() };
    };
}

/**
 * Whether a path is a directory, swallowing the error if it has since vanished.
 *
 * @param target - The path to test.
 *
 * @returns `true` when it is a directory that still exists.
 */
function statSyncIsDirectory(target: string): boolean {
    try {
        return statSync(target).isDirectory();
    } catch {
        return false;
    }
}

/** Parameters for {@link watchPaths}. */
export interface WatchPathsParams {
    /** The quiet period, in milliseconds, before a burst is reported. */
    debounceMs: number;
    /** Called with the de-duplicated paths from one burst. Never called concurrently. */
    onChange: (params: { paths: string[] }) => Promise<void>;
    /**
     * Called when a target cannot be watched at all, instead of failing the run: a
     * path can vanish between being expanded and being watched, and losing the whole
     * watch over one of them would be worse than skipping it.
     */
    onWatchError?: (params: { error: unknown; target: string }) => void;
    /** Aborted to stop watching and close every watcher. */
    signal: AbortSignal;
    /**
     * Schedules the debounced run. Injected so tests need no real timer; the default
     * is `setTimeout`. Returns a function that cancels the pending run.
     */
    schedule?: (run: () => void, ms: number) => () => void;
    /** Files and directories to watch. */
    targets: string[];
    /** How to watch one target. */
    watch: WatchFactory;
}

/**
 * Watch a set of files and directories, reporting each settled burst of changes once.
 *
 * Three properties the callers depend on:
 *
 * - **Bursts collapse.** One save produces several events; without debouncing it
 *   re-rendered once per event.
 * - **`onChange` never overlaps itself.** A render is asynchronous and writes a file;
 *   two interleaved renders would race on the same output. A burst arriving mid-render
 *   is queued and run once the current one finishes, so no change is dropped either.
 * - **A throwing `onChange` does not stop the watch.** While a file is being edited it
 *   is routinely invalid for a moment, and a watcher that died on the first unparseable
 *   save would be useless.
 *
 * @param params - The targets, the watcher, the debounce and the change handler.
 *
 * @returns A promise that resolves once the signal has aborted and every watcher is
 *   closed.
 *
 * @example
 * ```typescript
 * await watchPaths({
 *     debounceMs: 100,
 *     onChange: async ({ paths }) => { await render(paths); },
 *     signal: controller.signal,
 *     targets: ['machines', 'sfn-diagram.config.json'],
 *     watch: createFsWatchFactory(),
 * });
 * ```
 */
export async function watchPaths(params: WatchPathsParams): Promise<void> {
    const {
        debounceMs,
        onChange,
        onWatchError,
        schedule = defaultSchedule,
        signal,
        targets,
        watch,
    } = params;

    const handles: WatchHandle[] = [];
    /** Paths seen since the last reported burst. A Set so one save counts once. */
    let pending = new Set<string>();
    // A holder rather than a bare `let`: the only assignments TypeScript can see
    // linearly are the initialiser and the one in `flush`, so a bare variable narrows
    // to `null` and the cancel below becomes uncallable.
    const scheduled: { cancel: (() => void) | null } = { cancel: null };
    /** The in-flight `onChange`, so a change arriving mid-render waits rather than racing. */
    let running: Promise<void> = Promise.resolve();

    const flush = (): void => {
        scheduled.cancel = null;
        if (signal.aborted || pending.size === 0) return;
        const paths = [...pending];
        pending = new Set();
        // Chained onto whatever is running, so renders are strictly sequential. The
        // catch is on the chain rather than the call so one failure cannot leave the
        // chain permanently rejected.
        running = running.then(() =>
            onChange({ paths }).catch(() => {
                // Reporting is the caller's business; here it only matters that a
                // failed render does not end the watch.
            }),
        );
    };

    for (const target of targets) {
        try {
            handles.push(
                watch({
                    onEvent: ({ path }) => {
                        if (signal.aborted) return;
                        pending.add(path);
                        scheduled.cancel?.();
                        scheduled.cancel = schedule(flush, debounceMs);
                    },
                    target,
                }),
            );
        } catch (error) {
            onWatchError?.({ error, target });
        }
    }

    await new Promise<void>((done) => {
        if (signal.aborted) {
            done();
            return;
        }
        signal.addEventListener('abort', () => done(), { once: true });
    });

    scheduled.cancel?.();
    for (const handle of handles) handle.close();
    // Let a render that was already in flight finish writing before returning, so the
    // last file on disk is a complete one.
    await running;
}

/**
 * The default debounce: a plain `setTimeout`.
 *
 * @param run - The debounced action.
 * @param ms - How long to wait.
 *
 * @returns A function that cancels the pending run.
 */
function defaultSchedule(run: () => void, ms: number): () => void {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
}
