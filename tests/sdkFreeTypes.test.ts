import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(__dirname, '..');

const SDK_PACKAGE = '@aws-sdk/client-sfn';

/** Entries a consumer can import without `@aws-sdk/client-sfn` installed. */
const SDK_FREE_ENTRIES = [
    'src/index.ts',
    'src/png.ts',
    'src/cfn.ts',
    'src/terraform.ts',
    'src/element/index.ts',
    'src/element/auto.ts',
];

/** The declaration files those entries publish, by basename. */
const SDK_FREE_DECLARATIONS = [
    'index',
    'png',
    'cfn',
    'terraform',
    'element',
    'element-auto',
];

// The fixture tests compile against dist/. The build runs before tests in CI;
// locally, `pnpm run build` first or they are skipped.
const hasBuild = existsSync(join(repoRoot, 'dist/index.d.ts'));

/**
 * What a strict consumer compiles with. `noUncheckedSideEffectImports` is
 * pinned rather than left to the TypeScript 6 default, `@types/node` covers
 * `png.d.ts` (`Buffer`) and `dom` covers `element.d.ts`.
 */
const CONSUMER_OPTIONS: ts.CompilerOptions = {
    exactOptionalPropertyTypes: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedSideEffectImports: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    typeRoots: [join(repoRoot, 'node_modules/@types')],
    types: ['node'],
};

/** Parameters for {@link resolveLocalModule}. */
interface ResolveLocalModuleParams {
    /** Absolute path of the importing file. */
    fromFile: string;
    /** The relative specifier as written. */
    specifier: string;
}

/** Parameters for {@link importSpecifiersReachableFrom}. */
interface ImportSpecifiersReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** Parameters for {@link createConsumerFixture}. */
interface CreateConsumerFixtureParams {
    /** Source files to write into the fixture, keyed by file name. */
    files: Record<string, string>;
    /** Whether to link `@aws-sdk/client-sfn` into the fixture's `node_modules`. */
    withSdk: boolean;
}

/** Parameters for {@link typeCheckConsumer}. */
interface TypeCheckConsumerParams {
    /** The fixture directory. */
    dir: string;
    /** Root file names, relative to `dir`. */
    rootNames: string[];
}

/** The outcome of {@link typeCheckConsumer}. */
interface TypeCheckConsumerResult {
    /** One formatted message per diagnostic; empty when the program is clean. */
    errors: string[];
    /** Every file the program loaded, with `/` separators. */
    sourceFiles: string[];
}

/**
 * Resolves a relative specifier to a source file, the same way
 * `tests/coreDependencies.test.ts` does.
 *
 * @param params - The importing file and the specifier.
 * @returns The absolute path of the resolved file.
 * @throws When nothing matches, so a missed subtree can't make the walk pass.
 */
function resolveLocalModule(params: ResolveLocalModuleParams): string {
    const base = join(dirname(params.fromFile), params.specifier);
    const candidates = [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.cts`,
        base.replace(/\.js$/, '.ts'),
        base.replace(/\.mjs$/, '.mts'),
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
        base,
    ];
    const resolved = candidates.find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );

    if (!resolved) {
        throw new Error(
            `sdkFreeTypes: cannot resolve '${params.specifier}' from ${params.fromFile}. Teach resolveLocalModule about it — silently skipping it would make this guard pass by looking at less code.`,
        );
    }

    return resolved;
}

/**
 * Every non-relative specifier the import graph of an entry reaches, type-only
 * edges included. Unlike the runtime walker in `coreDependencies.test.ts`, this
 * follows `import type` and `export type ... from` on purpose: those survive
 * into the declarations a consumer compiles and into the source JSR serves.
 *
 * @param params - The entry module to walk from.
 * @returns The set of specifiers as written, e.g. `Set { 'd3-shape', 'yaml' }`.
 *
 * @example
 * ```typescript
 * importSpecifiersReachableFrom({ entry: join(repoRoot, 'src/aws.ts') }).has('@aws-sdk/client-sfn'); // true
 * ```
 */
function importSpecifiersReachableFrom(
    params: ImportSpecifiersReachableFromParams,
): Set<string> {
    const specifiers = new Set<string>();
    const visited = new Set<string>();
    const queue = [params.entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (visited.has(file)) continue;
        visited.add(file);

        const imported = ts
            .preProcessFile(readFileSync(file, 'utf-8'), true, true)
            .importedFiles.map((reference) => reference.fileName);
        for (const specifier of imported) {
            if (specifier.startsWith('.')) {
                queue.push(resolveLocalModule({ fromFile: file, specifier }));
            } else {
                specifiers.add(specifier);
            }
        }
    }

    return specifiers;
}

/**
 * Builds a throwaway consumer project with the built declarations installed as
 * `node_modules/sfn-diagram`. The package is copied, never symlinked: a symlink
 * realpaths into the repo, where the SDK resolves and the bug hides.
 *
 * @param params - The consumer's source files and whether to link the SDK.
 * @returns The fixture directory; the caller removes it.
 */
function createConsumerFixture(params: CreateConsumerFixtureParams): string {
    const dir = mkdtempSync(join(tmpdir(), 'sfn-sdk-free-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'sdk-free-consumer', private: true }),
    );

    const packageDir = join(dir, 'node_modules/sfn-diagram');
    mkdirSync(packageDir, { recursive: true });
    cpSync(join(repoRoot, 'package.json'), join(packageDir, 'package.json'));
    cpSync(join(repoRoot, 'dist'), join(packageDir, 'dist'), {
        filter: (source) =>
            statSync(source).isDirectory() || /\.d\.c?ts$/.test(source),
        recursive: true,
    });

    for (const [name, text] of Object.entries(params.files)) {
        writeFileSync(join(dir, name), text);
    }

    if (params.withSdk) {
        // TypeScript follows the link to its realpath, so the SDK's own
        // `@smithy/*` dependencies resolve from the pnpm store.
        mkdirSync(join(dir, 'node_modules/@aws-sdk'), { recursive: true });
        symlinkSync(
            realpathSync(join(repoRoot, 'node_modules', SDK_PACKAGE)),
            join(dir, 'node_modules', SDK_PACKAGE),
            'junction',
        );
    }

    return dir;
}

/**
 * Type-checks a consumer fixture with {@link CONSUMER_OPTIONS}.
 *
 * @param params - The fixture directory and its root files.
 * @returns The diagnostics and the files the program loaded.
 */
function typeCheckConsumer(
    params: TypeCheckConsumerParams,
): TypeCheckConsumerResult {
    const program = ts.createProgram({
        options: CONSUMER_OPTIONS,
        rootNames: params.rootNames.map((name) => join(params.dir, name)),
    });
    const host: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => params.dir,
        getNewLine: () => '\n',
    };

    return {
        errors: ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.formatDiagnostic(diagnostic, host).trim()),
        sourceFiles: program
            .getSourceFiles()
            .map((file) => file.fileName.replace(/\\/g, '/')),
    };
}

const CONSUMER_WITHOUT_SDK_MTS = `
import {
    buildExecutionTimeline,
    generateExecution,
    generateFromAwsResponse,
    generateSvg,
    parseExecutionHistory,
} from 'sfn-diagram';
import type { AslDefinition, ExecutionHistoryEvent, ExecutionHistoryInput } from 'sfn-diagram';
import { extractAslFromTemplate } from 'sfn-diagram/cfn';
import { extractAslFromTerraform } from 'sfn-diagram/terraform';
import { exportPng } from 'sfn-diagram/png';
import { SfnDiagramElement } from 'sfn-diagram/element';
import 'sfn-diagram/element/auto';

const aslDefinition: AslDefinition = { StartAt: 'Done', States: { Done: { End: true, Type: 'Pass' } } };
const events: ExecutionHistoryEvent[] = [{ id: 1, timestamp: new Date(0), type: 'ExecutionStarted' }];

// Fresh literals, written as they would be against the SDK's types.
parseExecutionHistory({
    events: [
        { executionStartedEventDetails: { input: '{}' }, id: 1, timestamp: new Date(0), type: 'ExecutionStarted' },
        { id: 2, stateEnteredEventDetails: { input: '{}', inputDetails: { truncated: false }, name: 'Done' }, timestamp: new Date(0), type: 'PassStateEntered' },
        { id: 3, stateExitedEventDetails: { assignedVariables: { total: '1' }, name: 'Done', output: '{}', outputDetails: { truncated: false } }, timestamp: new Date(0), type: 'PassStateExited' },
        { id: 4, taskFailedEventDetails: { cause: 'boom', error: 'States.TaskFailed', resource: 'invoke', resourceType: 'lambda' }, timestamp: new Date(0), type: 'TaskFailed' },
        { evaluationFailedEventDetails: { cause: 'bad', error: 'States.QueryEvaluationError', location: '$.x', state: 'Done' }, id: 5, timestamp: new Date(0), type: 'EvaluationFailed' },
    ],
});

const history: ExecutionHistoryInput = { events, nextToken: undefined };
generateExecution({ aslDefinition, history });
buildExecutionTimeline({ events });
generateFromAwsResponse({ response: { definition: JSON.stringify(aslDefinition), name: 'Orders' } });
generateSvg({ aslDefinition });

export const entries = [extractAslFromTemplate, extractAslFromTerraform, exportPng, SfnDiagramElement];
`;

const CONSUMER_WITHOUT_SDK_CTS = `
import { generateSvg } from 'sfn-diagram';
import { extractAslFromTemplate } from 'sfn-diagram/cfn';
import { extractAslFromTerraform } from 'sfn-diagram/terraform';
import { exportPng } from 'sfn-diagram/png';
import { SfnDiagramElement } from 'sfn-diagram/element';
import 'sfn-diagram/element/auto';

export const entries = [generateSvg, extractAslFromTemplate, extractAslFromTerraform, exportPng, SfnDiagramElement];
`;

const CONSUMER_WITH_SDK_MTS = `
import type { DescribeStateMachineCommandOutput, GetExecutionHistoryCommandOutput, HistoryEvent } from '@aws-sdk/client-sfn';
import { buildExecutionTimeline, generateExecution, generateFromAwsResponse, parseExecutionHistory } from 'sfn-diagram';
import type { AslDefinition } from 'sfn-diagram';
import type { SfnDiagramElement } from 'sfn-diagram/element';

declare const events: HistoryEvent[];
declare const page: GetExecutionHistoryCommandOutput;
declare const described: DescribeStateMachineCommandOutput;
declare const aslDefinition: AslDefinition;
declare const element: SfnDiagramElement;

parseExecutionHistory({ events });
buildExecutionTimeline({ events });
generateExecution({ aslDefinition, history: page });
generateExecution({ aslDefinition, history: events });
generateFromAwsResponse({ response: described });
element.history = page;
`;

describe('modules reachable from the SDK-free entries', () => {
    it.each(SDK_FREE_ENTRIES)(
        '%s imports nothing from @aws-sdk/client-sfn, type-only imports included',
        (entry) => {
            expect(
                importSpecifiersReachableFrom({
                    entry: join(repoRoot, entry),
                }).has(SDK_PACKAGE),
            ).toBe(false);
        },
    );

    it.each(['src/aws.ts', 'src/types/awsSdkCompat.ts'])(
        'the walker does find the SDK from %s, which imports it',
        (entry) => {
            expect(
                importSpecifiersReachableFrom({
                    entry: join(repoRoot, entry),
                }).has(SDK_PACKAGE),
            ).toBe(true);
        },
    );
});

describe.skipIf(!hasBuild)(
    'the published declarations without @aws-sdk/client-sfn installed',
    { timeout: 60_000 },
    () => {
        let dir: string;

        beforeAll(() => {
            dir = createConsumerFixture({
                files: {
                    'consumer.cts': CONSUMER_WITHOUT_SDK_CTS,
                    'consumer.mts': CONSUMER_WITHOUT_SDK_MTS,
                },
                withSdk: false,
            });
        });

        afterAll(() => {
            rmSync(dir, { force: true, recursive: true });
        });

        it('cannot resolve the SDK from the fixture', () => {
            expect(
                () =>
                    createRequire(join(dir, 'package.json')).resolve(
                        SDK_PACKAGE,
                    ),
                `${SDK_PACKAGE} resolves from ${dir}, probably through an ancestor node_modules, so the check below would pass without proving anything`,
            ).toThrow();
        });

        it('type-check with skipLibCheck off for every SDK-free entry, ESM and CJS', () => {
            const { errors, sourceFiles } = typeCheckConsumer({
                dir,
                rootNames: ['consumer.mts', 'consumer.cts'],
            });

            expect(errors).toEqual([]);
            for (const name of SDK_FREE_DECLARATIONS) {
                for (const extension of ['.d.ts', '.d.cts']) {
                    const suffix = `node_modules/sfn-diagram/dist/${name}${extension}`;
                    expect(
                        sourceFiles.some((file) => file.endsWith(suffix)),
                        `${suffix} was not part of the program`,
                    ).toBe(true);
                }
            }
        });
    },
);

describe.skipIf(!hasBuild)(
    'the published declarations with @aws-sdk/client-sfn installed',
    { timeout: 60_000 },
    () => {
        let dir: string;

        beforeAll(() => {
            dir = createConsumerFixture({
                files: { 'consumer.mts': CONSUMER_WITH_SDK_MTS },
                withSdk: true,
            });
        });

        afterAll(() => {
            rmSync(dir, { force: true, recursive: true });
        });

        it("accept the SDK's own objects under exactOptionalPropertyTypes", () => {
            expect(
                typeCheckConsumer({ dir, rootNames: ['consumer.mts'] }).errors,
            ).toEqual([]);
        });
    },
);
