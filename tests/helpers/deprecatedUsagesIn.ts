import { join, resolve } from 'node:path';
import ts from 'typescript';
import { baseCompilerOptions } from './typeErrorsIn';

const repoRoot = resolve(__dirname, '../..');

/** One reference to a `@deprecated` declaration, as an editor strikes it through. */
export interface DeprecatedUsage {
    /** The `@deprecated` tag text of the referenced declaration; `''` when the tag is bare. */
    message: string;
    /** The referencing identifier as written in the source. */
    name: string;
}

/** Parameters for {@link deprecatedUsagesIn}. */
export interface DeprecatedUsagesInParams {
    /** Absolute path the snippet is served at; relative imports resolve from it. */
    fileName: string;
    /** Source served in place of `fileName`, so the snippet never touches disk. */
    sourceText: string;
}

/**
 * Lists every reference in a snippet that the TypeScript language service
 * reports as deprecated: the same suggestion diagnostics an editor renders as
 * strikethrough. `tsc` and the linters never surface these, so this is the only
 * way to prove a `@deprecated` tag reaches consumers.
 *
 * @param params - The snippet and the absolute path it is served at.
 * @returns One entry per flagged reference, in source order; empty when nothing is deprecated.
 * @example
 * deprecatedUsagesIn({
 *     fileName: join(repoRoot, 'tests/__snippet.ts'),
 *     sourceText: "import type { DiagramOptions } from '../src/index';\ndeclare const options: DiagramOptions;\noptions.width;",
 * }); // [{ message: 'No effect; will be removed in 2.0. ...', name: 'width' }]
 */
export function deprecatedUsagesIn(
    params: DeprecatedUsagesInParams,
): DeprecatedUsage[] {
    const { fileName, sourceText } = params;
    const isTarget = (requestedName: string): boolean =>
        requestedName.replace(/\\/g, '/') === fileName.replace(/\\/g, '/');
    const host: ts.LanguageServiceHost = {
        fileExists: (requestedName) =>
            isTarget(requestedName) || ts.sys.fileExists(requestedName),
        getCompilationSettings: () => baseCompilerOptions,
        getCurrentDirectory: () => repoRoot,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        getScriptFileNames: () => [
            fileName,
            join(repoRoot, 'src/dom-globals.d.ts'),
        ],
        getScriptSnapshot: (requestedName) => {
            const text = isTarget(requestedName)
                ? sourceText
                : ts.sys.readFile(requestedName);
            return text === undefined
                ? undefined
                : ts.ScriptSnapshot.fromString(text);
        },
        getScriptVersion: () => '1',
        readFile: (requestedName) =>
            isTarget(requestedName)
                ? sourceText
                : ts.sys.readFile(requestedName),
    };
    const service = ts.createLanguageService(host);
    return service
        .getSuggestionDiagnostics(fileName)
        .filter(
            (diagnostic) =>
                diagnostic.reportsDeprecated && diagnostic.start !== undefined,
        )
        .map((diagnostic) => {
            const start = diagnostic.start!;
            const tag = service
                .getQuickInfoAtPosition(fileName, start)
                ?.tags?.find((candidate) => candidate.name === 'deprecated');
            return {
                message: ts.displayPartsToString(tag?.text),
                name: sourceText.slice(start, start + diagnostic.length),
            };
        });
}
