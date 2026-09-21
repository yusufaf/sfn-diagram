#!/usr/bin/env node
// Bundles src/renderers/viewer/viewerController.ts and the ./controller/* modules it
// composes into a bare script body with no import/export syntax, and writes it as a
// committed string constant. That constant is what buildViewerScript() inlines into
// the self-contained HTML document; the custom element imports viewerController.ts
// directly instead.
//
// The controller must stay free of runtime dependencies - the inlined script has no
// module loader, and pulling a package into it would silently bloat every generated
// HTML document. The bundle is therefore restricted to sources under the viewer
// directory: any import that resolves elsewhere (a node_modules package, or a src/
// module outside the viewer that happens to carry runtime code) fails the build.
//
// Run via `pnpm run build:viewer-script`. CI (`test:viewer-script`) regenerates and
// diffs against the committed file, so a stale bundle fails the build rather than
// silently drifting from its source.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const viewerDir = 'src/renderers/viewer';
const sourcePath = path.join(repoRoot, viewerDir, 'viewerController.ts');
const outputPath = path.join(repoRoot, viewerDir, 'viewerScript.generated.ts');

const result = await build({
    // Paths in the metafile and the per-module `// src/...` comments are relative to
    // this, so the output is byte-identical whichever directory the script runs from.
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [sourcePath],
    format: 'esm',
    legalComments: 'none',
    metafile: true,
    platform: 'neutral',
    target: 'es2019',
    write: false,
});

const bundledInputs = Object.keys(result.metafile.inputs);
const foreignInputs = bundledInputs.filter((input) => !input.startsWith(viewerDir + '/'));
if (foreignInputs.length > 0) {
    console.error(
        'build-viewer-script: the viewer controller bundle pulled in modules from ' +
            'outside ' + viewerDir + '/ - it must have no runtime dependencies:\n' +
            foreignInputs.map((input) => '  ' + input).join('\n'),
    );
    process.exit(1);
}

const outputText = result.outputFiles[0].text;

if (/\brequire\(/.test(outputText)) {
    console.error(
        'build-viewer-script: bundled output still requires a module - ' +
            'the viewer controller must have no runtime (non-type-only) imports.',
    );
    process.exit(1);
}

// esbuild's ESM output ends with the entry's export list. The only export is the
// `attachViewer` function declaration - already hoisted and present in the body - so
// that one statement is stripped to leave a bare script; buildViewerScript() calls
// `attachViewer` by name inside the IIFE it wraps this body in. Anything other than
// exactly that statement means the entry's exports changed, and the inline caller
// would break at runtime, so the build stops here instead.
const EXPORT_STATEMENT = /\nexport \{\n {2}attachViewer\n\};\n$/;
if (!EXPORT_STATEMENT.test(outputText)) {
    console.error(
        'build-viewer-script: expected the bundle to end with `export { attachViewer };` ' +
            'and nothing else - viewerController.ts must export only attachViewer.',
    );
    process.exit(1);
}
const body = outputText.replace(EXPORT_STATEMENT, '').trim();

const banner = `// GENERATED FILE - do not edit by hand.
// Source: src/renderers/viewer/viewerController.ts (and src/renderers/viewer/controller/*)
// Regenerate with: pnpm run build:viewer-script
`;

const fileContents = `${banner}
/** Compiled body of {@link attachViewer}, inlined into the self-contained HTML viewer. */
export const VIEWER_CONTROLLER_BUNDLE = ${JSON.stringify(body)};
`;

const relativeOutputPath = path.relative(process.cwd(), outputPath);

// Line endings are not part of what this check is about: git checks the committed LF
// file out as CRLF wherever core.autocrlf is on, which would otherwise report a stale
// bundle on every Windows clone even with the source untouched.
const withoutCarriageReturns = (contents) => contents.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
    let existing = '';
    try {
        existing = readFileSync(outputPath, 'utf8');
    } catch {
        // Falls through to the mismatch report below - a missing file fails the same way.
    }
    if (withoutCarriageReturns(existing) !== withoutCarriageReturns(fileContents)) {
        console.error(
            `build-viewer-script: ${relativeOutputPath} is stale - run ` +
                '`pnpm run build:viewer-script` and commit the result.',
        );
        process.exit(1);
    }
    console.log(`build-viewer-script: ${relativeOutputPath} is up to date`);
    process.exit(0);
}

writeFileSync(outputPath, fileContents);
console.log(`build-viewer-script: wrote ${relativeOutputPath}`);
