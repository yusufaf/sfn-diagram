import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { DEFAULT_DIAGRAM_OPTIONS } from '../src/config';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__diagramSizeRemoval.snippet.ts');

describe('DiagramOptions width and height removal (2.0)', () => {
    it(
        'width and height are type errors on DiagramOptions',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { generateSvg } from '../src/index';\nvoid generateSvg({ aslDefinition: '{}', width: 100 });\nvoid generateSvg({ aslDefinition: '{}', height: 100 });",
                })
            ).toEqual([
                expect.stringContaining("'width' does not exist in type"),
                expect.stringContaining("'height' does not exist in type"),
            ]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the case above: the same call without the removed options
    // compiles cleanly, so their errors are the only diagnostics.
    it(
        'a size-free call compiles cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { generateSvg } from '../src/index';\nvoid generateSvg({ aslDefinition: '{}', padding: 10 });",
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it('DEFAULT_DIAGRAM_OPTIONS has no width or height key', () => {
        const keys = Object.keys(DEFAULT_DIAGRAM_OPTIONS);

        expect(keys).not.toContain('width');
        expect(keys).not.toContain('height');
    });
});
