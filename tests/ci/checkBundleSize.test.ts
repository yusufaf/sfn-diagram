import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    BUNDLE_BUDGETS,
    compareBundleSizes,
    measureDist,
} from '../../scripts/check-bundle-size.mjs';

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
    it('budgets every entry the package publishes', () => {
        // dist/cli.js is deliberately absent: package.json#files excludes it, so it
        // ships to nobody. dist/bin.js is the CLI consumers get, and it is budgeted.
        expect(Object.keys(BUNDLE_BUDGETS).sort()).toEqual([
            'aws.cjs',
            'aws.js',
            'bin.js',
            'cfn.cjs',
            'cfn.js',
            'ci.cjs',
            'ci.js',
            'element-auto.cjs',
            'element-auto.js',
            'element.cjs',
            'element.js',
            'index.cjs',
            'index.js',
            'png.cjs',
            'png.js',
        ]);
    });

    it('budgets gzip below raw for every entry, so neither column is a typo', () => {
        for (const [file, budget] of Object.entries(BUNDLE_BUDGETS)) {
            expect(budget.gzip, file).toBeLessThan(budget.raw);
        }
    });
});
