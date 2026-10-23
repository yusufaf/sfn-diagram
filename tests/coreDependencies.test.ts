import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(__dirname, '..');

/**
 * Bare packages the browser-facing entries are allowed to reach at runtime.
 * Anything else here is a cost every consumer of `generateSvg`/`generateMermaid`
 * or `<sfn-diagram>` pays, including browser and edge ones — see #201.
 */
const ALLOWED_CORE_RUNTIME_PACKAGES = ['@dagrejs/dagre', 'd3-shape'];

/** Entries that must stay on that list: the core entry and the custom element. */
const BROWSER_FACING_ENTRIES = [
    'src/index.ts',
    'src/element/index.ts',
    'src/element/auto.ts',
];

/** Parameters for {@link barePackagesReachableFrom}. */
interface BarePackagesReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** Parameters for {@link nodeSpecifiersReachableFrom}. */
interface NodeSpecifiersReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** Parameters for {@link staticImportersReachableFrom}. */
interface StaticImportersReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** Parameters for {@link externalImportsReachableFrom}. */
interface ExternalImportsReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** Parameters for {@link externalSpecifiersReachableFrom}. */
interface ExternalSpecifiersReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/** One runtime import edge out of a file. */
interface RuntimeImport {
    /** Whether the edge is an `import()` call rather than an import/export declaration. */
    dynamic: boolean;
    /** The module specifier as written. */
    specifier: string;
}

/** A non-relative runtime import, with the file that makes it. */
interface ExternalImport extends RuntimeImport {
    /** Absolute path of the importing file. */
    file: string;
}

/** Reduce a specifier to the package that installs it, keeping the scope. */
function packageNameOf(specifier: string): string {
    const segments = specifier.split('/');
    return specifier.startsWith('@')
        ? segments.slice(0, 2).join('/')
        : segments[0];
}

/** Whether every named binding in an import/export clause is `type`-prefixed. */
function everyBindingIsTypeOnly(
    clause: ts.NamedImports | ts.NamedExports,
): boolean {
    return (
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly)
    );
}

/**
 * Module specifiers a file needs *at runtime*. Parsed with the TypeScript
 * compiler rather than a regex: a regex has to strip comments and string
 * literals to avoid false positives, and getting that wrong fails silently in
 * the direction that makes this guard useless. Two real cases in this repo would
 * defeat a comment-stripping regex — `// ... /controller/*)` in
 * viewerScript.generated.ts and `// \`machines/**\/*.asl.json\`` in cliInputs.ts
 * both open a block comment that swallows the imports after them.
 *
 * `import type` / `export type`, and clauses whose every binding is
 * `type`-prefixed, are excluded: TypeScript erases them, so they cost an
 * installer nothing. Side-effect imports (`import './register'`) are included —
 * they are real runtime edges.
 */
function runtimeImportsOf(file: string): RuntimeImport[] {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf-8'),
        ts.ScriptTarget.ESNext,
        true,
    );
    const imports: RuntimeImport[] = [];

    const record = (
        node: ts.Expression | undefined,
        dynamic: boolean,
    ): void => {
        if (node && ts.isStringLiteralLike(node))
            imports.push({ dynamic, specifier: node.text });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const erased =
                clause?.isTypeOnly === true ||
                (clause?.name === undefined &&
                    clause?.namedBindings !== undefined &&
                    ts.isNamedImports(clause.namedBindings) &&
                    everyBindingIsTypeOnly(clause.namedBindings));
            if (!erased) record(node.moduleSpecifier, false);
        } else if (ts.isExportDeclaration(node)) {
            const erased =
                node.isTypeOnly ||
                (node.exportClause !== undefined &&
                    ts.isNamedExports(node.exportClause) &&
                    everyBindingIsTypeOnly(node.exportClause));
            if (!erased) record(node.moduleSpecifier, false);
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
            record(node.arguments[0], true);
        }

        ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
    return imports;
}

/** Resolve a relative specifier the way the TypeScript resolver does. */
function resolveLocalModule(fromFile: string, specifier: string): string {
    const base = join(dirname(fromFile), specifier);
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

    // Deliberately fatal rather than skipped: a specifier this cannot resolve
    // would drop a whole subtree from the walk, and the assertions below would
    // then pass by having looked at less code.
    if (!resolved) {
        throw new Error(
            `coreDependencies: cannot resolve '${specifier}' from ${fromFile}. Teach resolveLocalModule about it — silently skipping it would make this guard pass by looking at less code.`,
        );
    }

    return resolved;
}

/**
 * Every bare package the transitive runtime-import graph of an entry reaches.
 *
 * @param params - The entry module to walk from.
 * @returns The set of package names, e.g. `Set { '@dagrejs/dagre', 'd3-shape' }`.
 *
 * @example
 * ```typescript
 * barePackagesReachableFrom({ entry: join(repoRoot, 'src/cfn.ts') }).has('yaml'); // true
 * ```
 */
function barePackagesReachableFrom(
    params: BarePackagesReachableFromParams,
): Set<string> {
    const bare = new Set<string>();
    for (const specifier of externalSpecifiersReachableFrom(params)) {
        if (!specifier.startsWith('node:')) bare.add(packageNameOf(specifier));
    }
    return bare;
}

/**
 * Every `node:` specifier the transitive runtime-import graph of an entry reaches.
 * Node built-ins cost an installer nothing, but they break browsers and edge runtimes, so an
 * entry documented as platform-agnostic must reach none.
 *
 * @param params - The entry module to walk from.
 * @returns The `node:` specifiers, e.g. `['node:fs']`; empty when the entry is platform-agnostic.
 *
 * @example
 * ```typescript
 * nodeSpecifiersReachableFrom({ entry: join(repoRoot, 'src/bin.ts') }).includes('node:fs'); // true
 * ```
 */
function nodeSpecifiersReachableFrom(
    params: NodeSpecifiersReachableFromParams,
): string[] {
    return externalSpecifiersReachableFrom(params)
        .filter((specifier) => specifier.startsWith('node:'))
        .sort();
}

/**
 * Every non-relative runtime import (bare package or `node:` built-in) in the graph an
 * entry reaches, following every relative edge, static and `import()` alike. The one
 * walker the helpers below share, so a resolver fix reaches all of them.
 *
 * @param params - The entry module to walk from.
 * @returns One record per import, in walk order; a package imported twice appears twice.
 *
 * @example
 * ```typescript
 * externalImportsReachableFrom({ entry: join(repoRoot, 'src/aws.ts') })
 *     .some((edge) => edge.specifier === '@aws-sdk/client-sfn' && !edge.dynamic); // true
 * ```
 */
function externalImportsReachableFrom(
    params: ExternalImportsReachableFromParams,
): ExternalImport[] {
    const { entry } = params;
    const visited = new Set<string>();
    const external: ExternalImport[] = [];
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (visited.has(file)) continue;
        visited.add(file);

        for (const edge of runtimeImportsOf(file)) {
            if (edge.specifier.startsWith('.')) {
                queue.push(resolveLocalModule(file, edge.specifier));
                continue;
            }

            external.push({ ...edge, file });
        }
    }

    return external;
}

/** Every non-relative specifier (bare package or `node:` built-in) an entry reaches at runtime. */
function externalSpecifiersReachableFrom(
    params: ExternalSpecifiersReachableFromParams,
): string[] {
    return [
        ...new Set(
            externalImportsReachableFrom(params).map((edge) => edge.specifier),
        ),
    ];
}

/**
 * Which files statically import each bare package, across everything an entry
 * reaches. The walk follows every relative edge, `import()` included, but only
 * records the static (declaration) imports of bare packages.
 *
 * @param params - The entry module to walk from.
 * @returns Package name to the repo-relative files that import it statically.
 *
 * @example
 * ```typescript
 * staticImportersReachableFrom({ entry: join(repoRoot, 'src/aws.ts') })
 *     .get('@aws-sdk/client-sfn'); // ['src/aws.ts']
 * ```
 */
function staticImportersReachableFrom(
    params: StaticImportersReachableFromParams,
): Map<string, string[]> {
    const importers = new Map<string, string[]>();

    for (const { dynamic, file, specifier } of externalImportsReachableFrom(
        params,
    )) {
        if (dynamic || specifier.startsWith('node:')) continue;

        const name = packageNameOf(specifier);
        const files = importers.get(name) ?? [];
        files.push(relative(repoRoot, file).split(sep).join('/'));
        importers.set(name, files);
    }

    return importers;
}

describe("the browser-facing entries' runtime dependency surface", () => {
    it.each(BROWSER_FACING_ENTRIES)(
        '%s reaches nothing beyond dagre and d3-shape',
        (entry) => {
            const packages = [
                ...barePackagesReachableFrom({ entry: join(repoRoot, entry) }),
            ];

            expect(packages.sort()).toEqual(ALLOWED_CORE_RUNTIME_PACKAGES);
        },
    );

    it.each(BROWSER_FACING_ENTRIES)(
        '%s never reaches yaml or minimatch, which only the Node-only entries need',
        (entry) => {
            const packages = barePackagesReachableFrom({
                entry: join(repoRoot, entry),
            });

            expect(packages.has('yaml')).toBe(false);
            expect(packages.has('minimatch')).toBe(false);
        },
    );

    it('still reaches yaml from the cfn entry and minimatch from the ci entry', () => {
        expect(
            barePackagesReachableFrom({
                entry: join(repoRoot, 'src/cfn.ts'),
            }).has('yaml'),
        ).toBe(true);
        expect(
            barePackagesReachableFrom({
                entry: join(repoRoot, 'src/ci/index.ts'),
            }).has('minimatch'),
        ).toBe(true);
    });

    it('keeps the terraform entry free of packages, so its "no dependencies" claim holds', () => {
        expect([
            ...barePackagesReachableFrom({
                entry: join(repoRoot, 'src/terraform.ts'),
            }),
        ]).toEqual([]);
    });

    it('keeps the terraform entry free of node: built-ins, so it runs in browsers and edge runtimes', () => {
        expect(
            nodeSpecifiersReachableFrom({
                entry: join(repoRoot, 'src/terraform.ts'),
            }),
        ).toEqual([]);
        // The walker must see node: imports at all, or the assertion above proves nothing.
        expect(
            nodeSpecifiersReachableFrom({
                entry: join(repoRoot, 'src/bin.ts'),
            }),
        ).toContain('node:fs');
    });

    it('reaches both from the CLI, which is why neither can be an optional peer', () => {
        const packages = barePackagesReachableFrom({
            entry: join(repoRoot, 'src/bin.ts'),
        });

        expect(packages.has('yaml')).toBe(true);
        expect(packages.has('minimatch')).toBe(true);
    });
});

const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const OPTIONAL_PEERS = Object.entries(packageJson.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta.optional === true)
    .map(([name]) => name)
    .sort();

describe('the CLI graph bun compiles into the standalone binaries', () => {
    // bun --compile hoists a static import of an --external package out of every
    // module it inlines, including one reached only through import(), so the
    // binary resolves it at startup and crashes without node_modules (#341).
    it('reads the optional peers from package.json', () => {
        expect(OPTIONAL_PEERS).toEqual([
            '@aws-sdk/client-sfn',
            '@resvg/resvg-js',
            'node-html-to-image',
        ]);
    });

    it.each(OPTIONAL_PEERS)(
        'no module reachable from src/bin.ts imports %s statically',
        (peer) => {
            const importers = staticImportersReachableFrom({
                entry: join(repoRoot, 'src/bin.ts'),
            });

            expect(importers.get(peer) ?? []).toEqual([]);
        },
    );

    it('sees the static SDK import in src/aws.ts, so the check above can fail', () => {
        expect(
            staticImportersReachableFrom({
                entry: join(repoRoot, 'src/aws.ts'),
            }).get('@aws-sdk/client-sfn'),
        ).toContain('src/aws.ts');
    });

    it('still reaches the SDK from the CLI, through import() only', () => {
        const sdkEdges = externalImportsReachableFrom({
            entry: join(repoRoot, 'src/bin.ts'),
        }).filter((edge) => edge.specifier === '@aws-sdk/client-sfn');

        expect(sdkEdges.length).toBeGreaterThan(0);
        expect(sdkEdges.every((edge) => edge.dynamic)).toBe(true);
    });
});

describe.each(['minimatch', 'yaml'])('%s', (name) => {
    // The CLI shipped in this same package (dist/bin.js) imports both, so an
    // optional peer would turn `npx sfn-diagram` into an install-two-more-packages
    // error the moment a config file or a glob input is used. See #201.
    it('is a real dependency, never an optional peer', () => {
        expect(packageJson.dependencies?.[name]).toBeDefined();
        expect(packageJson.peerDependencies?.[name]).toBeUndefined();
    });
});

describe.each([
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
])('%s', (name) => {
    // eslint.config.ts uses the typescript-eslint@^8 meta-package exclusively, and
    // the v6 packages do not support ESLint 9 at all.
    it('is not a devDependency', () => {
        expect(packageJson.devDependencies?.[name]).toBeUndefined();
    });
});
