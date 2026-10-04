/**
 * The timeout every suite that performs a *real* resvg PNG export shares.
 *
 * A cold `@resvg/resvg-js` load plus the system-font scan in
 * `src/exporters/pngFonts.ts` is slow enough on the macOS and Windows runners that
 * whichever export happens to go first regularly exceeded the 5s vitest default
 * and, once, the 15s these suites each hardcoded separately — the OS matrix added
 * in #195 is what surfaced both. One value, in one place, so the next runner that
 * is a little slower does not need four separate edits (#230).
 *
 * #336 took the font scan off the default path, so only the one test that forces
 * `loadSystemFonts: true` still pays for it — and on the Windows runner it pays
 * all of it, because it is now the first thing there to walk every installed
 * font with a cold cache: 7.7s and 12.6s across two runs of this branch,
 * where the suite was 2.0s before and
 * `tests/integration.test.ts` was the one absorbing ~9s as whichever suite went
 * first. So the value stays at 30s. Local timings are single-digit
 * milliseconds and say nothing about this.
 *
 * Suites that mock their engine (`tests/PngExporterHtmlEngine.test.ts`) keep their
 * own, tighter timeout: nothing is rasterized there.
 */
export const REAL_PNG_EXPORT_TIMEOUT_MS = 30_000;
