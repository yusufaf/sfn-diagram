import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
function runtimeSpecifiersOf(file: string): string[] {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf-8'),
        ts.ScriptTarget.ESNext,
        true,
    );
    const specifiers: string[] = [];

    const record = (node: ts.Expression | undefined): void => {
        if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const erased =
                clause?.isTypeOnly === true ||
                (clause?.namedBindings !== undefined &&
                    ts.isNamedImports(clause.namedBindings) &&
                    everyBindingIsTypeOnly(clause.namedBindings));
            if (!erased) record(node.moduleSpecifier);
        } else if (ts.isExportDeclaration(node)) {
            const erased =
                node.isTypeOnly ||
                (node.exportClause !== undefined &&
                    ts.isNamedExports(node.exportClause) &&
                    everyBindingIsTypeOnly(node.exportClause));
            if (!erased) record(node.moduleSpecifier);
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
            record(node.arguments[0]);
        }

        ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
    return specifiers;
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
    const { entry } = params;
    const visited = new Set<string>();
    const bare = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (visited.has(file)) continue;
        visited.add(file);

        for (const specifier of runtimeSpecifiersOf(file)) {
            if (specifier.startsWith('node:')) continue;

            if (specifier.startsWith('.')) {
                queue.push(resolveLocalModule(file, specifier));
                continue;
            }

            bare.add(packageNameOf(specifier));
        }
    }

    return bare;
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
};

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
