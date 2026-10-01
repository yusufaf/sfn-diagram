import { describe, expect, it, vi } from 'vitest';
import type { WatchFactory } from '../src/cliWatch';
import { watchPaths } from '../src/cliWatch';

/**
 * A watcher that records what it was asked to watch and lets a test fire events by
 * hand, so no test depends on real filesystem notifications — which differ per
 * platform, arrive in bursts, and on Windows arrive for the directory rather than
 * the file.
 */
function fakeWatcher() {
    const watched: string[] = [];
    const closed: string[] = [];
    const listeners = new Map<string, (params: { path: string }) => void>();

    const watch: WatchFactory = ({ onEvent, target }) => {
        watched.push(target);
        listeners.set(target, onEvent);
        return {
            close: () => {
                closed.push(target);
                listeners.delete(target);
            },
        };
    };

    return {
        closed,
        /** Fire one change for `path`, attributed to the watcher on `target`. */
        fire: (target: string, path: string) => {
            const listener = listeners.get(target);
            if (listener === undefined) {
                throw new Error(`nothing is watching ${target}`);
            }
            listener({ path });
        },
        watch,
        watched,
    };
}

/** A debounce that fires on the next microtask, so no test waits on a timer. */
const immediateDebounce = {
    debounceMs: 0,
    schedule: (run: () => void) => {
        void Promise.resolve().then(run);
        return () => {};
    },
};

/** Drain the microtask queue so debounced and chained work has run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe('watchPaths', () => {
    it('watches every target it is given', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();
        controller.abort();

        await watchPaths({
            ...immediateDebounce,
            onChange: vi.fn(),
            signal: controller.signal,
            targets: ['a.asl.json', 'b.asl.json', 'machines'],
            watch: watcher.watch,
        });

        expect(watcher.watched).toEqual([
            'a.asl.json',
            'b.asl.json',
            'machines',
        ]);
    });

    it('closes every watcher when the signal aborts', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();

        const watching = watchPaths({
            ...immediateDebounce,
            onChange: vi.fn(),
            signal: controller.signal,
            targets: ['a.asl.json', 'machines'],
            watch: watcher.watch,
        });
        controller.abort();
        await watching;

        expect(watcher.closed).toEqual(['a.asl.json', 'machines']);
    });

    it('reports the path that changed', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        controller.abort();
        await watching;

        expect(onChange).toHaveBeenCalledWith({ paths: ['a.asl.json'] });
    });

    it('collapses a burst of events into one call', async () => {
        // Editors save in bursts — a write, a truncate, sometimes a temp file and a
        // rename — and every one of those is an event. Without this, one save
        // re-rendered three times.
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        watcher.fire('a.asl.json', 'a.asl.json');
        watcher.fire('a.asl.json', 'a.asl.json');
        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        controller.abort();
        await watching;

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reports two different paths from one burst together', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['machines'],
            watch: watcher.watch,
        });

        watcher.fire('machines', 'machines/a.asl.json');
        watcher.fire('machines', 'machines/b.asl.json');
        await settle();
        controller.abort();
        await watching;

        expect(onChange).toHaveBeenCalledWith({
            paths: ['machines/a.asl.json', 'machines/b.asl.json'],
        });
    });

    it('de-duplicates one path reported twice in a burst', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['machines'],
            watch: watcher.watch,
        });

        watcher.fire('machines', 'machines/a.asl.json');
        watcher.fire('machines', 'machines/a.asl.json');
        await settle();
        controller.abort();
        await watching;

        expect(onChange).toHaveBeenCalledWith({
            paths: ['machines/a.asl.json'],
        });
    });

    it('does not start a second onChange while one is still running', async () => {
        // A render is async and writes a file. An event arriving mid-render must not
        // interleave two renders writing the same output.
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const gates: Array<() => void> = [];
        let running = 0;
        let maxConcurrent = 0;
        const onChange = vi.fn().mockImplementation(async () => {
            running += 1;
            maxConcurrent = Math.max(maxConcurrent, running);
            await new Promise<void>((done) => gates.push(done));
            running -= 1;
        });

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        expect(gates).toHaveLength(1);

        // A second burst while the first render is still blocked.
        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        // It has not started: still exactly one render in flight.
        expect(gates).toHaveLength(1);
        expect(maxConcurrent).toBe(1);

        // Let the first finish; the queued one may now start.
        gates[0]();
        await settle();
        expect(gates).toHaveLength(2);
        gates[1]();

        controller.abort();
        await watching;
        expect(maxConcurrent).toBe(1);
    });

    it('still runs the queued change after the one in flight finishes', async () => {
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const gates: Array<() => void> = [];
        const seen: string[][] = [];
        const onChange = vi
            .fn()
            .mockImplementation(async ({ paths }: { paths: string[] }) => {
                seen.push(paths);
                await new Promise<void>((done) => gates.push(done));
            });

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['machines'],
            watch: watcher.watch,
        });

        watcher.fire('machines', 'machines/a.asl.json');
        await settle();
        watcher.fire('machines', 'machines/b.asl.json');
        await settle();
        gates[0]();
        await settle();
        gates[1]();

        controller.abort();
        await watching;

        // The second burst was not dropped, and it carried only its own path.
        expect(seen).toEqual([['machines/a.asl.json'], ['machines/b.asl.json']]);
    });

    it('keeps watching when onChange throws', async () => {
        // A render that fails is the normal case while editing: the file is briefly
        // invalid JSON. Watching must survive it.
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi
            .fn()
            .mockRejectedValueOnce(new Error('invalid JSON'))
            .mockResolvedValueOnce(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        watcher.fire('a.asl.json', 'a.asl.json');
        await settle();
        controller.abort();
        await watching;

        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('ignores events that arrive after the signal aborted', async () => {
        // Abort and the event can land in the same tick: the handles are not closed
        // until a microtask later, so a watcher can still fire into a loop that is
        // already shutting down. Rendering then would write a file after the run
        // reported it was done.
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);

        const watching = watchPaths({
            ...immediateDebounce,
            onChange,
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        controller.abort();
        // Still watching at this instant, so the event is delivered.
        watcher.fire('a.asl.json', 'a.asl.json');
        await watching;
        await settle();

        expect(onChange).not.toHaveBeenCalled();
    });

    it('drops a burst whose debounce had not fired when the signal aborted', async () => {
        // The other ordering, and the one that actually happens: the event lands, then
        // Ctrl-C arrives inside the debounce window. The guard in the event handler
        // cannot help here because the event was already accepted, so `flush` needs
        // its own check. A `schedule` that is cancellable would mask this, which is
        // why this test keeps the pending run alive.
        const watcher = fakeWatcher();
        const controller = new AbortController();
        const onChange = vi.fn().mockResolvedValue(undefined);
        const pendingRuns: Array<() => void> = [];

        const watching = watchPaths({
            debounceMs: 0,
            onChange,
            schedule: (run) => {
                pendingRuns.push(run);
                return () => {};
            },
            signal: controller.signal,
            targets: ['a.asl.json'],
            watch: watcher.watch,
        });

        watcher.fire('a.asl.json', 'a.asl.json');
        controller.abort();
        await watching;
        // The debounce fires only now, after the abort.
        for (const run of pendingRuns) run();
        await settle();

        expect(onChange).not.toHaveBeenCalled();
    });

    it('survives a target that cannot be watched', async () => {
        // A path can vanish between expansion and the watch call. Refusing to start
        // the whole watch over one of them would be worse than skipping it.
        const controller = new AbortController();
        controller.abort();
        const problems: string[] = [];

        await watchPaths({
            ...immediateDebounce,
            onChange: vi.fn(),
            onWatchError: ({ target }) => problems.push(target),
            signal: controller.signal,
            targets: ['gone.asl.json', 'here.asl.json'],
            watch: ({ target }) => {
                if (target === 'gone.asl.json') {
                    throw Object.assign(new Error('ENOENT'), {
                        code: 'ENOENT',
                    });
                }
                return { close: () => {} };
            },
        });

        expect(problems).toEqual(['gone.asl.json']);
    });
});
