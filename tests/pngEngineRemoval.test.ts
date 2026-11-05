import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportPng, PngExporter } from '../src/png';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__pngEngineRemoval.snippet.ts');

describe('html-to-image engine removal (2.0)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects the removed html-to-image engine with a migration hint', () => {
        expect(() => new PngExporter({ engine: 'html-to-image' as never })).toThrow(
            /PNG export 'engine' must be 'resvg', got 'html-to-image'.*removed in sfn-diagram 2\.0/s
        );
    });

    it('exportPng rejects the removed engine before fetching any icon', async () => {
        // Never call through: an unmocked spy would reach the icon CDN if the
        // engine check ever ran after embedIcons again.
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
        const aslDefinition = readFileSync(join(repoRoot, 'tests/fixtures/services.asl.json'), 'utf8');

        await expect(
            exportPng({ aslDefinition, engine: 'html-to-image' as never, showIcons: true })
        ).rejects.toThrow(/removed in sfn-diagram 2\.0/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(
        'engine: html-to-image is a type error',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { exportPng } from '../src/png';\nvoid exportPng({ aslDefinition: '{}', engine: 'html-to-image' });",
                })
            ).toEqual([expect.stringContaining(`Type '"html-to-image"' is not assignable to type`)]);
        },
        COMPILE_TIMEOUT_MS
    );

    it(
        'convert({ height }) is a type error',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { PngExporter } from '../src/png';\nvoid new PngExporter({}).convert({ height: 100, svg: '', width: 100 });",
                })
            ).toEqual([expect.stringContaining("'height' does not exist in type")]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the two type cases above: the same calls without the removed
    // option and value compile cleanly, so their errors are the only diagnostics.
    it(
        'the resvg engine and a height-free convert call compile cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { exportPng, PngExporter } from '../src/png';\nvoid exportPng({ aslDefinition: '{}', engine: 'resvg' });\nvoid new PngExporter({}).convert({ svg: '', width: 100 });",
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it('node-html-to-image is no longer declared in package.json', () => {
        const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
            string,
            Record<string, unknown> | undefined
        >;

        expect(pkg.dependencies?.['node-html-to-image']).toBeUndefined();
        expect(pkg.devDependencies?.['node-html-to-image']).toBeUndefined();
        expect(pkg.peerDependencies?.['node-html-to-image']).toBeUndefined();
        expect(pkg.peerDependenciesMeta?.['node-html-to-image']).toBeUndefined();
    });
});
