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
 * Suites that mock their engine (`tests/PngExporterHtmlEngine.test.ts`) keep their
 * own, tighter timeout: nothing is rasterized there.
 */
export const REAL_PNG_EXPORT_TIMEOUT_MS = 30_000;
