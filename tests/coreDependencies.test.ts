import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');

/**
 * Bare packages the core entry (`.`) is allowed to reach at runtime. Anything
 * else here is a cost every consumer of `generateSvg`/`generateMermaid` pays,
 * including browser and edge ones — see #201.
 */
const ALLOWED_CORE_RUNTIME_PACKAGES = ['@dagrejs/dagre', 'd3-shape'];

/**
 * A value `import`/`export ... from`, or a dynamic `import()`. `import type` and
 * `export type` are deliberately not matched: TypeScript erases them, so they
 * cost an installer nothing. The static form is anchored to the start of a line
 * because `src/index.ts` carries a deprecation *string* reading
 * `"Use \`import { exportPng } from 'sfn-diagram/png'\` instead."`, which an
 * unanchored pattern reads as a real import.
 */
const VALUE_IMPORT =
    /^[ \t]*(?:import|export)\s+(?!type\s)[^;'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Parameters for {@link barePackagesReachableFrom}. */
interface BarePackagesReachableFromParams {
    /** Absolute path to the entry module to walk from. */
    entry: string;
}

/**
 * Strip comments that could contain an import-shaped example. `src/index.ts`'s
 * own JSDoc contains `import { generateSvg } from 'sfn-diagram'`, which would
 * otherwise register as a dependency. Only whole-line `//` comments are removed,
 * so a `https://` inside a string literal survives.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Reduce a specifier to the package that installs it, keeping the scope. */
function packageNameOf(specifier: string): string {
    const segments = specifier.split('/');
    return specifier.startsWith('@')
        ? segments.slice(0, 2).join('/')
        : segments[0];
}

/** Resolve an extensionless relative specifier the way the TS resolver does. */
function resolveLocalModule(
    fromFile: string,
    specifier: string,
): string | undefined {
    const base = join(dirname(fromFile), specifier);
    const candidates = [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        base.replace(/\.js$/, '.ts'),
        base,
    ];
    return candidates.find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
}

/**
 * Every bare package the transitive value-import graph of an entry reaches.
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

        for (const match of stripComments(readFileSync(file, 'utf-8')).matchAll(
            VALUE_IMPORT,
        )) {
            const specifier = match[1] ?? match[2];
            if (!specifier || specifier.startsWith('node:')) continue;

            if (specifier.startsWith('.')) {
                const next = resolveLocalModule(file, specifier);
                if (next) queue.push(next);
                continue;
            }

            bare.add(packageNameOf(specifier));
        }
    }

    return bare;
}

describe("the core entry's runtime dependency surface", () => {
    it('reaches nothing beyond dagre and d3-shape', () => {
        const packages = [
            ...barePackagesReachableFrom({
                entry: join(repoRoot, 'src/index.ts'),
            }),
        ];

        expect(packages.sort()).toEqual(ALLOWED_CORE_RUNTIME_PACKAGES);
    });

    it('never reaches yaml or minimatch, which only the Node-only entries need', () => {
        const packages = barePackagesReachableFrom({
            entry: join(repoRoot, 'src/index.ts'),
        });

        expect(packages.has('yaml')).toBe(false);
        expect(packages.has('minimatch')).toBe(false);
    });

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
