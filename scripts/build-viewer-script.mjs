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
// A second, separate bundle is built from src/renderers/viewer/relayout.ts: the
// graph transforms, dagre layout and SVG renderer the viewer needs to re-lay the
// diagram out in the browser for per-container collapse. That one deliberately
// reaches outside the viewer directory (and into @dagrejs/dagre and d3-shape), so it
// is minified, kept to an explicit allow-list of modules, and inlined only into
// documents that ship a relayout model - the plain viewer never pays for it.
//
// Run via `pnpm run build:viewer-script`. CI (`test:viewer-script`) regenerates and
// diffs against the committed files, so a stale bundle fails the build rather than
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
const relayoutSourcePath = path.join(repoRoot, viewerDir, 'relayout.ts');
const relayoutOutputPath = path.join(repoRoot, viewerDir, 'viewerRelayout.generated.ts');

/**
 * What the relayout bundle may contain. Everything the collapse -> layout -> render
 * pipeline needs, and nothing that assumes Node (the parser, the CLI, PNG export) or
 * that would drag the viewer itself back in.
 */
const RELAYOUT_ALLOWED_PREFIXES = [
    'src/renderers/viewer/relayout.ts',
    'src/renderers/viewer/minimapThreshold.ts',
    'src/config/',
    'src/constants/',
    'src/graph/',
    'src/layout/',
    'src/renderers/SvgRenderer.ts',
    'src/renderers/svgBuilder.ts',
    'src/styles/',
    'src/types/',
    'src/utils/jsonata.ts',
    'src/utils/pathSample.ts',
    'src/utils/textMeasure.ts',
];

/**
 * The only packages the relayout bundle may contain. Matched by name rather than
 * path, since pnpm installs them under `node_modules/.pnpm/<pkg>@<version>/...`.
 */
const RELAYOUT_ALLOWED_PACKAGES = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@dagrejs\/dagre|d3-path|d3-shape)\//;

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

const relayoutResult = await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [relayoutSourcePath],
    // An IIFE assigning `sfnRelayout`, so the controller script can inline it and
    // call `sfnRelayout.renderCollapsedView` without any module loader.
    format: 'iife',
    globalName: 'sfnRelayout',
    legalComments: 'none',
    metafile: true,
    minify: true,
    platform: 'neutral',
    target: 'es2019',
    write: false,
});

const relayoutInputs = Object.keys(relayoutResult.metafile.inputs);
const disallowedInputs = relayoutInputs.filter(
    (input) =>
        !RELAYOUT_ALLOWED_PREFIXES.some((prefix) => input.startsWith(prefix)) &&
        !RELAYOUT_ALLOWED_PACKAGES.test(input),
);
if (disallowedInputs.length > 0) {
    console.error(
        'build-viewer-script: the relayout bundle pulled in modules outside its ' +
            'allow-list - it must contain only the collapse/layout/render pipeline:\n' +
            disallowedInputs.map((input) => '  ' + input).join('\n'),
    );
    process.exit(1);
}

const relayoutText = relayoutResult.outputFiles[0].text;
if (/\brequire\(/.test(relayoutText)) {
    console.error('build-viewer-script: the relayout bundle still requires a module.');
    process.exit(1);
}

const relayoutFileContents = `// GENERATED FILE - do not edit by hand.
// Source: src/renderers/viewer/relayout.ts (and the graph/layout/renderer modules it imports)
// Regenerate with: pnpm run build:viewer-script

/**
 * Minified IIFE defining \`sfnRelayout\` (with \`renderCollapsedView\`), inlined into a
 * self-contained HTML viewer that ships a relayout model for per-container collapse.
 */
export const VIEWER_RELAYOUT_BUNDLE = ${JSON.stringify(relayoutText.trim())};
`;

const relativeOutputPath = path.relative(process.cwd(), outputPath);
const relativeRelayoutOutputPath = path.relative(process.cwd(), relayoutOutputPath);

// Line endings are not part of what this check is about: git checks the committed LF
// file out as CRLF wherever core.autocrlf is on, which would otherwise report a stale
// bundle on every Windows clone even with the source untouched.
const withoutCarriageReturns = (contents) => contents.replace(/\r\n/g, '\n');

const outputs = [
    { contents: fileContents, outputPath, relativePath: relativeOutputPath },
    { contents: relayoutFileContents, outputPath: relayoutOutputPath, relativePath: relativeRelayoutOutputPath },
];

if (process.argv.includes('--check')) {
    for (const output of outputs) {
        let existing = '';
        try {
            existing = readFileSync(output.outputPath, 'utf8');
        } catch {
            // Falls through to the mismatch report below - a missing file fails the same way.
        }
        if (withoutCarriageReturns(existing) !== withoutCarriageReturns(output.contents)) {
            console.error(
                `build-viewer-script: ${output.relativePath} is stale - run ` +
                    '`pnpm run build:viewer-script` and commit the result.',
            );
            process.exit(1);
        }
        console.log(`build-viewer-script: ${output.relativePath} is up to date`);
    }
    process.exit(0);
}

for (const output of outputs) {
    writeFileSync(output.outputPath, output.contents);
    console.log(`build-viewer-script: wrote ${output.relativePath}`);
}
