import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import type { CompilerOptions } from 'typescript';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');

// The fixture asserts on the inferred type of unannotated exports, which
// `isolatedDeclarations` rejects. Nothing here emits declarations.
const NARROWING_COMPILER_OPTIONS: CompilerOptions = {
    isolatedDeclarations: false,
};

describe('output and option types', () => {
    it(
        'the type fixture compiles with every Equals assertion true',
        () => {
            expect(
                typeErrorsIn({
                    compilerOptions: NARROWING_COMPILER_OPTIONS,
                    fileName: join(repoRoot, 'tests/fixtures/format-narrowing.ts'),
                }),
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS,
    );

    // Proves the fixture can fail: `Equals` must reject types that are only
    // assignable, or every assertion above would pass vacuously.
    it(
        'the Equals check rejects types that are only assignable',
        () => {
            expect(
                typeErrorsIn({
                    compilerOptions: NARROWING_COMPILER_OPTIONS,
                    fileName: join(repoRoot, 'tests', '__formatNarrowing.snippet.ts'),
                    sourceText:
                        "import type { MermaidOutput, SvgOutput } from '../src/index';\nimport type { Equals } from './fixtures/format-narrowing';\nexport const mismatch: Equals<SvgOutput, MermaidOutput> = true;",
                }),
            ).toEqual([expect.stringContaining("Type 'true' is not assignable to type 'false'")]);
        },
        COMPILE_TIMEOUT_MS,
    );

    // Proves the overloads did not loosen the params: the snippet is a bare call
    // so the overload error is the only diagnostic it can produce.
    it(
        'a misspelled option is still rejected through the overloads',
        () => {
            expect(
                typeErrorsIn({
                    compilerOptions: NARROWING_COMPILER_OPTIONS,
                    fileName: join(repoRoot, 'tests', '__formatNarrowing.snippet.ts'),
                    sourceText:
                        "import { generateDiagram } from '../src/index';\ngenerateDiagram({ aslDefinition: '{}', themee: 'dark' });",
                }),
            ).toEqual([expect.stringContaining('No overload matches this call')]);
        },
        COMPILE_TIMEOUT_MS,
    );
});
