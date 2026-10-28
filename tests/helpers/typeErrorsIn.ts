import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(__dirname, '../..');

// tsconfig only includes `src`, and vitest does not type-check, so an
// `expectTypeOf` assertion here could never fail. Run the compiler instead.
const baseCompilerOptions: ts.CompilerOptions = {
    ...ts.parseJsonConfigFileContent(
        ts.readConfigFile(join(repoRoot, 'tsconfig.json'), ts.sys.readFile)
            .config,
        ts.sys,
        repoRoot,
    ).options,
    noEmit: true,
};

export const COMPILE_TIMEOUT_MS = 30_000;

/** Parameters for {@link typeErrorsIn}. */
export interface TypeErrorsInParams {
    /** Overrides merged over the repo tsconfig for this compile only. */
    compilerOptions?: ts.CompilerOptions;
    /** Absolute path of the file to type-check. */
    fileName: string;
    /** Source served in place of `fileName`, so a snippet never touches disk. */
    sourceText?: string;
}

/**
 * Type-checks a file against the repo's tsconfig and returns every diagnostic
 * in the program, not only those in `fileName`, so a stray error anywhere fails.
 *
 * @param params - The file to check, an optional in-memory replacement for it,
 * and optional compiler option overrides.
 * @returns One formatted message per diagnostic; empty when the program is clean.
 * @example
 * typeErrorsIn({ fileName: join(repoRoot, 'tests/fixtures/asl-type-coverage.ts') }); // []
 */
export function typeErrorsIn(params: TypeErrorsInParams): string[] {
    const { compilerOptions, fileName, sourceText } = params;
    const options: ts.CompilerOptions = {
        ...baseCompilerOptions,
        ...compilerOptions,
    };
    const host = ts.createCompilerHost(options);
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
        options,
        // `src/index` reaches viewer code that gets DOM types only from this
        // ambient file, which tsconfig's `include` loads but a fixture-rooted
        // program does not.
        rootNames: [fileName, join(repoRoot, 'src/dom-globals.d.ts')],
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
