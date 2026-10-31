import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deprecatedUsagesIn } from './helpers/deprecatedUsagesIn';
import { COMPILE_TIMEOUT_MS } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');

// The dist case reads the bundled declarations, where a comment on a re-export
// would be dropped. The build runs before tests in CI; locally, `pnpm run build`
// first or it is skipped.
const hasBuild = existsSync(join(repoRoot, 'dist/index.d.ts'));

const SNIPPET_FILE = join(repoRoot, 'tests/__deprecations.snippet.ts');

/** Every name the snippet references that 2.0 removes, sorted. */
const EXPECTED_DEPRECATED_NAMES = [
    'buildViewerContent',
    'callerOverrides',
    'collapseTargets',
    'diffChangedIds',
    'edges',
    'executionStatusByNodeId',
    'get',
    'keyFor',
    'nodes',
    'options',
    'pngQuality',
    'resolveViewerTheme',
    'set',
];

/** Parameters for {@link snippetFor}. */
interface SnippetForParams {
    /** Specifier of the root entry, relative to the snippet. */
    indexPath: string;
    /** Specifier of the `png` entry, relative to the snippet. */
    pngPath: string;
}

/**
 * Builds a consumer snippet that touches every API 2.0 removes, plus the
 * neighbours that stay (`clear`, `stats`, `createLayoutCache`,
 * `generateViewerUpdate`, the `relayoutModel` field), which must not be flagged.
 * Properties are read rather than written in object literals: TypeScript only
 * reports deprecation on a literal property through hover and completion.
 *
 * @param params - Where the snippet imports the root and `png` entries from.
 * @returns The snippet source.
 * @example
 * snippetFor({ indexPath: '../src/index', pngPath: '../src/png' });
 */
function snippetFor(params: SnippetForParams): string {
    const { indexPath, pngPath } = params;
    return [
        `import { buildViewerContent, createLayoutCache, generateViewerUpdate, resolveViewerTheme } from '${indexPath}';`,
        `import type { DiagramOptions, ViewerUpdate } from '${indexPath}';`,
        `import type { ExportPngParams } from '${pngPath}';`,
        'declare const options: DiagramOptions;',
        'declare const pngParams: ExportPngParams;',
        'declare const update: ViewerUpdate;',
        'options.pngQuality;',
        'pngParams.pngQuality;',
        "buildViewerContent({ minimapCollapsed: false, svg: '' });",
        "resolveViewerTheme({ theme: 'dark' });",
        'const cache = createLayoutCache();',
        'const key = cache.keyFor({ edges: [], nodes: [], options });',
        'cache.set(key, cache.get(key)!);',
        'cache.clear();',
        'cache.stats();',
        "generateViewerUpdate({ aslDefinition: '{}', cache, relayout: true });",
        'const model = update.relayoutModel;',
        'model?.callerOverrides; model?.collapseTargets; model?.diffChangedIds; model?.edges;',
        'model?.executionStatusByNodeId; model?.nodes; model?.options;',
    ].join('\n');
}

describe.each([
    {
        entries: { indexPath: '../src/index', pngPath: '../src/png' },
        label: 'source',
        skip: false,
    },
    {
        entries: { indexPath: '../dist/index.js', pngPath: '../dist/png.js' },
        label: 'dist',
        skip: !hasBuild,
    },
])('2.0 deprecations ($label)', ({ entries, skip }) => {
    it.skipIf(skip)(
        'strikes through exactly the APIs 2.0 removes',
        () => {
            const usages = deprecatedUsagesIn({
                fileName: SNIPPET_FILE,
                sourceText: snippetFor(entries),
            });
            expect(
                [...new Set(usages.map((usage) => usage.name))].sort(),
            ).toEqual(EXPECTED_DEPRECATED_NAMES);
        },
        COMPILE_TIMEOUT_MS,
    );

    it.skipIf(skip)(
        'every deprecation says it is removed in 2.0',
        () => {
            const usages = deprecatedUsagesIn({
                fileName: SNIPPET_FILE,
                sourceText: snippetFor(entries),
            });
            expect(usages).not.toEqual([]);
            for (const usage of usages) {
                expect(usage.message, usage.name).toMatch(/removed in 2\.0/);
            }
        },
        COMPILE_TIMEOUT_MS,
    );
});
