import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
    BUNDLE_BUDGETS,
    compareBundleSizes,
    measureDist,
} from '../../scripts/check-bundle-size.mjs';

const repoRoot = resolve(__dirname, '../..');

describe('compareBundleSizes', () => {
    it('reports nothing over budget when every entry fits', () => {
        const { overBudget } = compareBundleSizes({
            budgets: { 'index.js': { gzip: 100, raw: 200 } },
            measured: { 'index.js': { gzip: 90, raw: 190 } },
        });

        expect(overBudget).toEqual([]);
    });

    it('flags a raw-only regression, which is how generated code grows', () => {
        const { overBudget } = compareBundleSizes({
            budgets: { 'index.js': { gzip: 100, raw: 200 } },
            measured: { 'index.js': { gzip: 90, raw: 201 } },
        });

        expect(overBudget).toEqual([
            { budget: 200, file: 'index.js', kind: 'raw', size: 201 },
        ]);
    });

    it('flags a gzip-only regression', () => {
        const { overBudget } = compareBundleSizes({
            budgets: { 'index.js': { gzip: 100, raw: 200 } },
            measured: { 'index.js': { gzip: 101, raw: 190 } },
        });

        expect(overBudget).toEqual([
            { budget: 100, file: 'index.js', kind: 'gzip', size: 101 },
        ]);
    });

    it('treats a budget exactly met as within budget', () => {
        const { overBudget } = compareBundleSizes({
            budgets: { 'index.js': { gzip: 100, raw: 200 } },
            measured: { 'index.js': { gzip: 100, raw: 200 } },
        });

        expect(overBudget).toEqual([]);
    });

    it('fails a missing build output rather than reading it as the smallest bundle', () => {
        const { overBudget } = compareBundleSizes({
            budgets: { 'index.js': { gzip: 100, raw: 200 } },
            measured: {},
        });

        expect(overBudget.map((row) => row.kind)).toEqual(['raw', 'gzip']);
        expect(overBudget.every((row) => row.size === undefined)).toBe(true);
    });
});

describe('measureDist', () => {
    it('reports both sizes for a file that exists, and omits one that does not', () => {
        const distDir = mkdtempSync(join(tmpdir(), 'sfn-bundle-size-'));
        writeFileSync(join(distDir, 'index.js'), 'x'.repeat(5000));

        const measured = measureDist({
            budgets: { 'index.js': { gzip: 1, raw: 1 }, 'gone.js': { gzip: 1, raw: 1 } },
            distDir,
        });

        expect(measured['index.js'].raw).toBe(5000);
        // Highly compressible input, so this only has to be smaller than raw.
        expect(measured['index.js'].gzip).toBeLessThan(5000);
        expect(measured['gone.js']).toBeUndefined();
    });
});

describe('BUNDLE_BUDGETS', () => {
    it('budgets every file package.json points consumers at', () => {
        // Derived from package.json rather than restated: a hardcoded list only
        // notices an edit to BUNDLE_BUDGETS itself, so adding a new subpath (a new
        // tsdown entry plus an `exports` entry) would ship an unbudgeted bundle with
        // nothing failing. dist/cli.js is excluded by package.json#files, so it ships
        // to nobody; dist/bin.js is the CLI consumers get, and is budgeted via `bin`.
        const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
            bin: Record<string, string>;
            exports: Record<string, { import: { default: string }; require: { default: string } }>;
        };

        const published = new Set<string>();
        for (const entry of Object.values(packageJson.exports)) {
            published.add(basename(entry.import.default));
            published.add(basename(entry.require.default));
        }
        for (const entry of Object.values(packageJson.bin)) {
            published.add(basename(entry));
        }

        expect(Object.keys(BUNDLE_BUDGETS).sort()).toEqual([...published].sort());
    });

    it('budgets gzip below raw for every entry, so neither column is a typo', () => {
        for (const [file, budget] of Object.entries(BUNDLE_BUDGETS)) {
            expect(budget.gzip, file).toBeLessThan(budget.raw);
        }
    });
});
