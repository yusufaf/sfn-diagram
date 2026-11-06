import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { DEFAULT_DIAGRAM_OPTIONS } from '../src/config';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__pngQualityRemoval.snippet.ts');

describe('DiagramOptions pngQuality removal (2.0)', () => {
    it(
        'pngQuality is a type error on generateSvg, exportPng and PngExporter',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { generateSvg } from '../src/index';\nimport { exportPng, PngExporter } from '../src/png';\nvoid generateSvg({ aslDefinition: '{}', pngQuality: 90 });\nvoid exportPng({ aslDefinition: '{}', pngQuality: 90 });\nnew PngExporter({ pngQuality: 90 });",
                })
            ).toEqual([
                expect.stringContaining("'pngQuality' does not exist in type"),
                expect.stringContaining("'pngQuality' does not exist in type"),
                expect.stringContaining("'pngQuality' does not exist in type"),
            ]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the case above: the same calls without the removed option
    // compile cleanly, so its errors are the only diagnostics.
    it(
        'a pngQuality-free call compiles cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { generateSvg } from '../src/index';\nimport { exportPng, PngExporter } from '../src/png';\nvoid generateSvg({ aslDefinition: '{}', padding: 10 });\nvoid exportPng({ aslDefinition: '{}', scale: 2 });\nnew PngExporter({ scale: 2 });",
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it('DEFAULT_DIAGRAM_OPTIONS has no pngQuality key', () => {
        expect(Object.keys(DEFAULT_DIAGRAM_OPTIONS)).not.toContain('pngQuality');
    });
});
