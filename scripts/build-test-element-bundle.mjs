#!/usr/bin/env node
// Bundles a src/element entry with @dagrejs/dagre/d3-shape/yaml inlined, for driving
// the custom element in a real browser during tests (tests/element/elementRuntime.test.ts).
// A real consumer's own bundler resolves those as npm dependencies; a bare Puppeteer
// page has no module resolution, so this throwaway build inlines them instead.
//
// Deliberately a separate CLI script run via child_process rather than importing
// tsdown's build() directly into the test file: doing that put Puppeteer's browser
// automation in the same worker process as rolldown's native (NAPI) bindings, which
// was an unreliable combination in this environment.
//
// Usage: node scripts/build-test-element-bundle.mjs <entry> <outDir>
import { build } from 'tsdown';

const [, , entry, outDir] = process.argv;
if (!entry || !outDir) {
    console.error('usage: node scripts/build-test-element-bundle.mjs <entry> <outDir>');
    process.exit(1);
}

await build({
    // Without this, tsdown auto-discovers the repo's own tsdown.config.ts (a 7-entry
    // array) and merges it in - rolldown then extracts chunks shared between this ad
    // hoc entry and the real entries (e.g. a `diff.js` shared with `index`/`element`),
    // leaving `bundle.js` with a relative import that can't resolve once it's inlined
    // into a bare page with no module resolution.
    config: false,
    clean: true,
    dts: false,
    entry: { bundle: entry },
    format: ['esm'],
    hash: false,
    logLevel: 'silent',
    noExternal: [/^@dagrejs\/dagre$/, /^d3-shape$/, /^yaml$/],
    outDir,
    platform: 'browser',
});
