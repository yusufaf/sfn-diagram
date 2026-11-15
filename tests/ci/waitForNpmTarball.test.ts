import { describe, expect, it, vi } from 'vitest';
import { waitForTarball } from '../../scripts/wait-for-npm-tarball.mjs';

const url = 'https://registry.npmjs.org/sfn-diagram/-/sfn-diagram-2.0.2.tgz';
const intervalMs = 15_000;

/**
 * A fake clock for one test. `sleep` advances it, then yields to the macrotask
 * queue: without that yield a loop that never exits runs entirely on microtasks,
 * starves the timer queue, and the vitest timeout never fires.
 */
function makeClock() {
    let clock = 0;
    return {
        get elapsed() {
            return clock;
        },
        now: () => clock,
        sleep: async (ms: number) => {
            clock += ms;
            await new Promise((resolve) => setImmediate(resolve));
        },
    };
}

/** A fetch stub whose response (or thrown error) for each call comes from `respond`. */
function makeFetchStub(respond: (call: number) => number | Error) {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
        const outcome = respond(call++);
        if (outcome instanceof Error) throw outcome;
        return new Response(null, { status: outcome });
    });
    return fetchImpl;
}

describe('waitForTarball', () => {
    it('resolves on the first attempt when the tarball is already served', async () => {
        const clock = makeClock();
        const fetchImpl = makeFetchStub(() => 200);

        const result = await waitForTarball({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            log: vi.fn(),
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: 15 * 60_000,
            url,
        });

        expect(result).toMatchObject({ attempts: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('tolerates 14 minutes of 404 before the tarball appears (the 2.0.2 lag was 8)', async () => {
        const clock = makeClock();
        const log = vi.fn();
        const fetchImpl = makeFetchStub(() => (clock.elapsed < 14 * 60_000 ? 404 : 200));

        const result = await waitForTarball({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            intervalMs,
            log,
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: 15 * 60_000,
            url,
        });

        expect(result.attempts).toBeGreaterThan(50);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'));
    });

    it('fails after the timeout when the tarball never appears', async () => {
        const clock = makeClock();
        const fetchImpl = makeFetchStub(() => 404);

        const wait = waitForTarball({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            intervalMs,
            log: vi.fn(),
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: 15 * 60_000,
            url,
        });

        await expect(wait).rejects.toThrow(/tarball .* never became available after 15 minutes/);
        await expect(wait).rejects.toThrow(/last: HTTP 404/);
        expect(clock.elapsed).toBeGreaterThanOrEqual(15 * 60_000);
        expect(clock.elapsed).toBeLessThan(15 * 60_000 + intervalMs);
    });

    it('retries a network error and a 5xx like a 404', async () => {
        const clock = makeClock();
        const outcomes: (number | Error)[] = [new TypeError('fetch failed'), 503, 200];
        const fetchImpl = makeFetchStub((call) => outcomes[call]);

        const result = await waitForTarball({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            log: vi.fn(),
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: 15 * 60_000,
            url,
        });

        expect(result).toMatchObject({ attempts: 3 });
    });

    it('fetches the plain URL with no cache-busting query', async () => {
        // A query string is a different Cloudflare cache key from the URL npx
        // fetches, so a busted poll could pass while npx still gets a 404.
        const clock = makeClock();
        const fetchImpl = makeFetchStub(() => 200);

        await waitForTarball({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            log: vi.fn(),
            now: clock.now,
            sleep: clock.sleep,
            timeoutMs: 15 * 60_000,
            url,
        });

        expect(fetchImpl.mock.calls[0]?.[0]).toBe(url);
    });

    it.each([
        [{ timeoutMs: 0 }, /timeoutMs/],
        [{ timeoutMs: Number.NaN }, /timeoutMs/],
        [{ intervalMs: 0 }, /intervalMs/],
        [{ intervalMs: Number.NaN }, /intervalMs/],
        [{ requestTimeoutMs: 0 }, /requestTimeoutMs/],
    ])('rejects a non-positive or non-finite timing parameter: %o', async (override, message) => {
        const clock = makeClock();
        const fetchImpl = makeFetchStub(() => 200);

        await expect(
            waitForTarball({
                fetchImpl: fetchImpl as unknown as typeof fetch,
                log: vi.fn(),
                now: clock.now,
                sleep: clock.sleep,
                timeoutMs: 15 * 60_000,
                url,
                ...override,
            }),
        ).rejects.toThrow(message);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
