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
 * #336 took the font scan off the default path, so most of these exports now run
 * in single-digit milliseconds and only the one test that forces
 * `loadSystemFonts: true` still pays for it. The value is deliberately left
 * alone: the cold native module load it was also covering has not changed, and
 * the runner timings that justified 30s came from CI, so lowering it wants CI
 * evidence rather than a local measurement.
 *
 * Suites that mock their engine (`tests/PngExporterHtmlEngine.test.ts`) keep their
 * own, tighter timeout: nothing is rasterized there.
 */
export const REAL_PNG_EXPORT_TIMEOUT_MS = 30_000;
