#!/usr/bin/env node
// Compiles src/renderers/viewer/viewerController.ts - a plain-DOM module with zero
// imports at runtime (its only import is `import type`, fully erased) - into a bare
// script body with no import/export syntax, and writes it as a committed string
// constant. That constant is what buildViewerScript() inlines into the self-contained
// HTML document; the custom element imports viewerController.ts directly instead.
//
// Run via `pnpm run build:viewer-script`. CI (`test:viewer-script`) regenerates and
// diffs against the committed file, so a stale bundle fails the build rather than
// silently drifting from its source.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '../src/renderers/viewer/viewerController.ts');
const outputPath = path.join(here, '../src/renderers/viewer/viewerScript.generated.ts');

const source = readFileSync(sourcePath, 'utf8');

const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
        target: ts.ScriptTarget.ES2019,
        module: ts.ModuleKind.CommonJS,
        removeComments: true,
    },
    reportDiagnostics: true,
});

const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
if (errors.length > 0) {
    for (const diagnostic of errors) {
        console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }
    process.exit(1);
}

if (/\brequire\(/.test(outputText)) {
    console.error(
        'build-viewer-script: transpiled output still requires a module - ' +
            'viewerController.ts must have no runtime (non-type-only) imports.',
    );
    process.exit(1);
}

const banner = `// GENERATED FILE - do not edit by hand.
// Source: src/renderers/viewer/viewerController.ts
// Regenerate with: pnpm run build:viewer-script
`;

// transpileModule always emits CommonJS interop boilerplate for a file with `export`,
// even under ModuleKind.None. Since the only export is the `attachViewer` function
// declaration - already hoisted and present in the body - the interop lines (strict
// mode pragma, __esModule marker, the `exports.attachViewer = ...` assignment) are
// pure boilerplate here and are stripped to leave a bare script.
const body = outputText
    .replace(/^"use strict";\s*$/m, '')
    .replace(/^Object\.defineProperty\(exports, "__esModule".*$/m, '')
    .replace(/^exports\.attachViewer = attachViewer;\s*$/m, '')
    .trim();

const fileContents = `${banner}
/** Compiled body of {@link attachViewer}, inlined into the self-contained HTML viewer. */
export const VIEWER_CONTROLLER_BUNDLE = ${JSON.stringify(body)};
`;

const relativeOutputPath = path.relative(process.cwd(), outputPath);

if (process.argv.includes('--check')) {
    let existing = '';
    try {
        existing = readFileSync(outputPath, 'utf8');
    } catch {
        // Falls through to the mismatch report below - a missing file fails the same way.
    }
    if (existing !== fileContents) {
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
