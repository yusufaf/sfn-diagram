import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLayoutCache, generateSvg } from '../src/index';
import type { LayoutCache } from '../src/index';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__layoutCacheNarrowing.snippet.ts');
const SIMPLE = readFileSync(join(repoRoot, 'tests/fixtures/simple.asl.json'), 'utf8');

// The cross-bundle case imports the built entries: `sfn-diagram` and
// `sfn-diagram/png` are separate bundles on npm. `pnpm run build` first, or it is skipped.
const hasBuild = existsSync(join(repoRoot, 'dist/index.js')) && existsSync(join(repoRoot, 'dist/png.js'));

describe('LayoutCache narrowing (2.0)', () => {
    it(
        'get, set and keyFor are type errors on LayoutCache',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: [
                        "import { createLayoutCache } from '../src/index';",
                        'const cache = createLayoutCache();',
                        "cache.get('k');",
                        "cache.set('k', undefined as never);",
                        'cache.keyFor({ edges: [], nodes: [], options: {} });',
                    ].join('\n'),
                })
            ).toEqual([
                expect.stringContaining("does not exist on type 'LayoutCache'"),
                expect.stringContaining("does not exist on type 'LayoutCache'"),
                expect.stringContaining("does not exist on type 'LayoutCache'"),
            ]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the case above: the members that stay compile cleanly.
    it(
        'clear and stats compile cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import { createLayoutCache } from '../src/index';\nconst cache = createLayoutCache();\ncache.clear();\ncache.stats();",
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it('a cache exposes only clear and stats', () => {
        const cache = createLayoutCache();

        expect(Object.keys(cache).sort()).toEqual(['clear', 'stats']);
        expect('get' in cache).toBe(false);
    });

    it('rejects a hand-built cache', () => {
        const handBuilt: LayoutCache = { clear() {}, stats: () => ({ entries: 0, hits: 0, misses: 0 }) };

        expect(() => generateSvg({ aslDefinition: SIMPLE, cache: handBuilt })).toThrow(TypeError);
        expect(() => generateSvg({ aslDefinition: SIMPLE, cache: handBuilt })).toThrow(/createLayoutCache/);
    });

    it('rejects a spread copy of a cache', () => {
        const copy = { ...createLayoutCache() };

        expect(() => generateSvg({ aslDefinition: SIMPLE, cache: copy })).toThrow(TypeError);
        expect(() => generateSvg({ aslDefinition: SIMPLE, cache: copy })).toThrow(/createLayoutCache/);
    });

    it('treats cache: null as no cache', () => {
        expect(() => generateSvg({ aslDefinition: SIMPLE, cache: null as never })).not.toThrow();
    });

    describe.skipIf(!hasBuild)('across the built entry points', () => {
        it('a cache from sfn-diagram is reused by exportPng from sfn-diagram/png', async () => {
            const index = (await import(pathToFileURL(join(repoRoot, 'dist/index.js')).href)) as typeof import('../src/index');
            const png = (await import(pathToFileURL(join(repoRoot, 'dist/png.js')).href)) as typeof import('../src/png');
            const cache = index.createLayoutCache();

            await png.exportPng({ aslDefinition: SIMPLE, cache });
            await png.exportPng({ aslDefinition: SIMPLE, cache });

            expect(cache.stats().hits).toBe(1);
        });
    });
});
