// Polls a freshly published npm tarball URL until the registry serves it, so the
// release workflow's post-publish `npx` check runs only once npx can download the
// package.
//
// Why this exists: https://github.com/yusufaf/sfn-diagram/issues/659. After the
// 2.0.2 publish, the packument listed the version and its `dist.tarball` at once,
// but the tarball URL itself returned 404 for about 8 minutes. The npx probe's
// retries (about 2-3.5 minutes) ran out first, failing a release that was fine.
//
// The poll requests the plain `dist.tarball` URL, exactly as npx does. Neither
// cache-busting option helps: a query string is a different Cloudflare cache key,
// so it can see a 200 from origin while npx's URL still serves a 404, and
// Cloudflare ignores a `Cache-Control: no-cache` request header.
//
// Usage:
//   node scripts/wait-for-npm-tarball.mjs --url <tarball-url> [--timeout-minutes 15] [--interval-seconds 15]
// Exits 0 once the URL returns 2xx, or exits 1 with an `::error::` once the
// timeout passes.
//
// No shebang: like scripts/resolve-docker-tag.mjs, this is imported directly by
// tests/ci/waitForNpmTarball.test.ts, and a shebang followed by CRLF endings
// (what a Windows checkout produces) breaks esbuild's shebang-stripping regex
// during that import.
import { setTimeout as delay } from 'node:timers/promises';
import { runAsScript } from './lib/cliScript.mjs';

/**
 * @typedef {object} WaitForTarballParams
 * @property {typeof fetch} [fetchImpl] - The fetch to use. Defaults to the global `fetch`.
 * @property {number} [intervalMs] - Wait between attempts. Defaults to 15 000.
 * @property {(message: string) => void} [log] - Where retry lines go. Defaults to `console.log`.
 * @property {() => number} [now] - The clock, in ms. Defaults to `Date.now`.
 * @property {number} [requestTimeoutMs] - Abort one request after this long. Defaults to 30 000.
 * @property {(ms: number) => Promise<unknown>} [sleep] - Waits `ms`. Defaults to a timer.
 * @property {number} timeoutMs - Give up once this much time has passed since the first attempt.
 * @property {string} url - The tarball URL, as `npm view <pkg>@<version> dist.tarball` prints it.
 */

/**
 * @typedef {object} AssertPositiveParams
 * @property {string} name - The parameter name, for the error message.
 * @property {number} value - The value to check.
 */

/**
 * Throw unless `value` is a finite number greater than 0.
 *
 * @param {AssertPositiveParams} params - The parameter's name and value.
 * @returns {void}
 * @throws if `value` is NaN, infinite, 0 or negative.
 */
function assertPositive(params) {
    const { name, value } = params;
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`waitForTarball: ${name} must be a positive number`);
    }
}

/**
 * Poll `url` until it returns a 2xx response or `timeoutMs` passes. Every other
 * outcome, a 404, a 5xx or a network error, is retried, since a fresh tarball can
 * 404 for minutes while the CDN catches up and a transient error shouldn't fail a
 * release. The response body is never read.
 *
 * @param {WaitForTarballParams} params - The URL, the timeout, and optional overrides for tests.
 * @returns {Promise<{attempts: number, elapsedMs: number}>} How many requests it took and how long.
 * @throws if a timing parameter is not a positive number, or the URL never returned 2xx in time.
 * The timeout message starts with `tarball <url> never became available after N minutes`.
 *
 * @example
 * ```javascript
 * await waitForTarball({
 *     timeoutMs: 15 * 60_000,
 *     url: 'https://registry.npmjs.org/sfn-diagram/-/sfn-diagram-2.0.2.tgz',
 * });
 * // { attempts: 1, elapsedMs: 120 }
 * ```
 */
export async function waitForTarball(params) {
    const {
        fetchImpl = fetch,
        intervalMs = 15_000,
        log = console.log,
        now = Date.now,
        requestTimeoutMs = 30_000,
        sleep = delay,
        timeoutMs,
        url,
    } = params;

    assertPositive({ name: 'intervalMs', value: intervalMs });
    assertPositive({ name: 'requestTimeoutMs', value: requestTimeoutMs });
    assertPositive({ name: 'timeoutMs', value: timeoutMs });

    const startedAt = now();
    let attempts = 0;
    for (;;) {
        attempts++;
        let last;
        try {
            const response = await fetchImpl(url, {
                signal: AbortSignal.timeout(requestTimeoutMs),
            });
            await response.body?.cancel();
            if (response.ok) return { attempts, elapsedMs: now() - startedAt };
            last = `HTTP ${response.status}`;
        } catch (error) {
            last = error instanceof Error ? error.message : String(error);
        }

        if (now() - startedAt >= timeoutMs) {
            throw new Error(
                `tarball ${url} never became available after ${timeoutMs / 60_000} minutes (${attempts} attempts, last: ${last})`,
            );
        }
        log(`tarball not served yet (attempt ${attempts}, ${last}); retrying in ${intervalMs / 1000}s`);
        await sleep(intervalMs);
    }
}

await runAsScript({
    importMetaUrl: import.meta.url,
    options: {
        'interval-seconds': { type: 'string' },
        'timeout-minutes': { type: 'string' },
        url: { type: 'string' },
    },
    required: ['url'],
    usage: 'wait-for-npm-tarball.mjs --url <tarball-url> [--timeout-minutes 15] [--interval-seconds 15]',
    main: async (values) => {
        const { attempts } = await waitForTarball({
            intervalMs: Number(values['interval-seconds'] ?? '15') * 1000,
            timeoutMs: Number(values['timeout-minutes'] ?? '15') * 60_000,
            url: values.url,
        });
        console.log(`tarball served after ${attempts} attempt(s)`);
    },
});
