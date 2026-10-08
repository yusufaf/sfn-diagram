import { describe, expect, it } from 'vitest';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { lintAsl } from '../src/lint';
import {
    jsonataDefinition,
    jsonPathDefinition,
} from './fixtures/asl-type-coverage';

const repoRoot = resolve(__dirname, '..');

// tsconfig only includes `src`, and vitest does not type-check, so an
// `expectTypeOf` assertion here could never fail. Run the compiler instead.
const compilerOptions: ts.CompilerOptions = {
    ...ts.parseJsonConfigFileContent(
        ts.readConfigFile(join(repoRoot, 'tsconfig.json'), ts.sys.readFile)
            .config,
        ts.sys,
        repoRoot,
    ).options,
    noEmit: true,
};

const COMPILE_TIMEOUT_MS = 30_000;

/** Parameters for {@link typeErrorsIn}. */
interface TypeErrorsInParams {
    /** Absolute path of the file to type-check. */
    fileName: string;
    /** Source served in place of `fileName`, so a snippet never touches disk. */
    sourceText?: string;
}

/**
 * Type-checks a file against the repo's tsconfig and returns every diagnostic
 * in the program, not only those in `fileName`, so a stray error anywhere fails.
 *
 * @param params - The file to check and an optional in-memory replacement for it.
 * @returns One formatted message per diagnostic; empty when the program is clean.
 * @example
 * typeErrorsIn({ fileName: join(repoRoot, 'tests/fixtures/asl-type-coverage.ts') }); // []
 */
function typeErrorsIn(params: TypeErrorsInParams): string[] {
    const { fileName, sourceText } = params;
    const host = ts.createCompilerHost(compilerOptions);
    if (sourceText !== undefined) {
        const isTarget = (requestedName: string): boolean =>
            requestedName.replace(/\\/g, '/') === fileName.replace(/\\/g, '/');
        const baseGetSourceFile = host.getSourceFile;
        const baseFileExists = host.fileExists;
        host.getSourceFile = (
            requestedName,
            languageVersionOrOptions,
            onError,
            shouldCreate,
        ) =>
            isTarget(requestedName)
                ? ts.createSourceFile(
                      requestedName,
                      sourceText,
                      languageVersionOrOptions,
                  )
                : baseGetSourceFile(
                      requestedName,
                      languageVersionOrOptions,
                      onError,
                      shouldCreate,
                  );
        host.fileExists = (requestedName) =>
            isTarget(requestedName) || baseFileExists(requestedName);
    }
    const program = ts.createProgram({
        host,
        options: compilerOptions,
        rootNames: [fileName],
    });
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
        const prefix = diagnostic.file
            ? `${relative(repoRoot, diagnostic.file.fileName)}: `
            : '';
        return (
            prefix +
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
    });
}

describe('ASL definition types', () => {
    it(
        'accept a JSONPath and a JSONata definition using every field AWS documents, without a cast',
        () => {
            expect(
                typeErrorsIn({
                    fileName: join(
                        repoRoot,
                        'tests/fixtures/asl-type-coverage.ts',
                    ),
                }),
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS,
    );

    it.each([
        ['JSONPath', jsonPathDefinition],
        ['JSONata', jsonataDefinition],
    ])('the %s fixture is real, lint-clean ASL', (_label, definition) => {
        expect(lintAsl({ definition })).toEqual([]);
    });

    // Proves the first test can fail: a misspelled field must still be rejected,
    // so the type check above is not a silent no-op.
    it.each([
        [
            'RetryBlock',
            "import type { RetryBlock } from '../src/types';\nexport const retry: RetryBlock = { ErrorEquals: ['States.ALL'], MaxDelaySecond: 5 };",
            "'MaxDelaySecond' does not exist in type 'RetryBlock'",
        ],
        [
            'CatchBlock',
            "import type { CatchBlock } from '../src/types';\nexport const catcher: CatchBlock = { ErrorEquals: ['States.ALL'], Outputs: 1 };",
            "'Outputs' does not exist in type 'CatchBlock'",
        ],
        [
            'ReaderConfig',
            "import type { ReaderConfig } from '../src/types';\nexport const reader: ReaderConfig = { CSVHeader: [] };",
            "'CSVHeader' does not exist in type 'ReaderConfig'",
        ],
    ])(
        'still rejects a misspelled %s field',
        (_label, sourceText, message) => {
            expect(
                typeErrorsIn({
                    fileName: join(repoRoot, 'tests', '__aslTypes.snippet.ts'),
                    sourceText,
                }),
            ).toEqual([expect.stringContaining(message)]);
        },
        COMPILE_TIMEOUT_MS,
    );
});
