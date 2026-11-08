import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');

// The dist rows read the bundled entry and declarations. The build runs before
// tests in CI; locally, `pnpm run build` first or they are skipped.
const hasBuild = existsSync(join(repoRoot, 'dist/index.d.ts'));

const SNIPPET_FILE = join(repoRoot, 'tests', '__viewerInternalsRemoval.snippet.ts');

describe.each([
    { indexPath: '../src/index', label: 'source', skip: false },
    { indexPath: '../dist/index.js', label: 'dist', skip: !hasBuild },
])('viewer internals removal (2.0, $label)', ({ indexPath, label, skip }) => {
    it.skipIf(skip)(
        'buildViewerContent and resolveViewerTheme are not root exports',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: `import { buildViewerContent, resolveViewerTheme } from '${indexPath}';\nvoid buildViewerContent; void resolveViewerTheme;`,
                })
            ).toEqual([
                expect.stringMatching(/has no exported member(?: named)? 'buildViewerContent'/),
                expect.stringMatching(/has no exported member(?: named)? 'resolveViewerTheme'/),
            ]);
        },
        COMPILE_TIMEOUT_MS
    );

    it.skipIf(skip)(
        'ViewerUpdate.relayoutModel is opaque',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: `import type { ViewerUpdate } from '${indexPath}';\ndeclare const update: ViewerUpdate;\nvoid update.relayoutModel.nodes;`,
                })
            ).toEqual([expect.stringContaining("'update.relayoutModel' is of type 'unknown'")]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the cases above: passing the model through untouched, across a
    // JSON hop, compiles cleanly, as does the ViewerTheme type that stays.
    it.skipIf(skip)(
        'passing relayoutModel through compiles cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: [
                        `import { generateViewerUpdate } from '${indexPath}';`,
                        `import type { ViewerTheme, ViewerUpdate } from '${indexPath}';`,
                        "const update = generateViewerUpdate({ aslDefinition: '{}', relayout: true });",
                        "const message: { relayoutModel?: ViewerUpdate['relayoutModel'] } = { relayoutModel: update.relayoutModel };",
                        "const roundTripped: ViewerUpdate['relayoutModel'] = JSON.parse(JSON.stringify(message));",
                        "const chrome: ViewerTheme = 'auto';",
                        'void roundTripped; void chrome;',
                    ].join('\n'),
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it.skipIf(skip)('the module object has neither name', async () => {
        const root: Record<string, unknown> =
            label === 'source'
                ? await import('../src/index')
                : await import(pathToFileURL(join(repoRoot, 'dist/index.js')).href);
        expect(Object.keys(root)).not.toContain('buildViewerContent');
        expect(Object.keys(root)).not.toContain('resolveViewerTheme');
        expect(Object.keys(root)).toContain('generateViewerUpdate');
    });
});
