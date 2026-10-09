// Fails when a published dist/ entry grows past its budget, raw or gzipped.
//
// #199: nothing caught size regressions, and the core entry had quietly reached
// 478 KB raw / 139 KB gzip - the issue's own "~125KB" figure was stale by the time
// it was filed. Most of that is the generated viewer script the entry pulls in
// (151 KB of TypeScript across viewerScript.generated.ts and
// viewerRelayout.generated.ts), which is exactly the kind of growth a budget is
// for: generated code does not get reviewed line by line.
//
// Both numbers are checked. Gzip is what a consumer downloads, raw is what their
// bundler parses, and generated code regresses in the raw direction first because
// it compresses well.
//
// Budgets are measured-plus-headroom, not aspirations: each is about 10% above the
// size at the commit that added this file. To re-measure after a deliberate change:
//   pnpm run build && node scripts/check-bundle-size.mjs
// which prints every entry's headroom, then raise the numbers that need it in the
// same commit that grew them.
//
// Usage:
//   node scripts/check-bundle-size.mjs [--dist dist]
//
// No shebang: like the other scripts here it is imported by its own test, and a
// shebang plus CRLF endings breaks esbuild's shebang-stripping regex on import.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { runAsScript } from './lib/cliScript.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Byte ceilings per published entry, `{ gzip, raw }`.
 *
 * `dist/cli.js` is absent on purpose: `package.json#files` excludes it
 * (`"!dist/cli.js"`), so it ships to nobody. `dist/bin.js` is the CLI consumers
 * actually get, and it is budgeted.
 *
 * Every budget sits roughly 10% above what its entry measured when it was last set.
 * That headroom is the whole mechanism: it absorbs ordinary change and trips on
 * something unexpected. A budget the current build only just fits under has stopped
 * being a gate and become a tripwire for whoever lands next, so when a deliberate
 * growth eats the headroom, the right move is to re-measure and restate the budget in
 * the same commit — not to leave it at 2% and let an unrelated PR take the blame.
 *
 * `bin.js` was last restated at 674,000 / 197,500 after the CLI gained `--from-aws`,
 * `--execution <arn> --follow` and `--watch` (#192, #283, #190), which together took
 * it from 567,677 to 613,128 raw: +45,451 bytes, +8.0%, for three features. The AWS
 * SDK is not in that number — it stays an externalised optional peer.
 *
 * `png.js`/`png.cjs` were last restated at 234,000 / 69,000 when `edgeStyle: 'orthogonal'`
 * gained real routing (#323), which took png.cjs from 201,658 to 212,407 raw and from
 * 59,348 to 62,343 gzip.
 */
export const BUNDLE_BUDGETS = {
    'aws.cjs': { gzip: 1000, raw: 2100 },
    'aws.js': { gzip: 1000, raw: 2100 },
    'bin.js': { gzip: 197500, raw: 674000 },
    'cfn.cjs': { gzip: 3600, raw: 9800 },
    'cfn.js': { gzip: 3600, raw: 9800 },
    'ci.cjs': { gzip: 83500, raw: 287000 },
    'ci.js': { gzip: 83500, raw: 287000 },
    'element-auto.cjs': { gzip: 107000, raw: 373000 },
    'element-auto.js': { gzip: 107000, raw: 373000 },
    'element.cjs': { gzip: 107000, raw: 373000 },
    'element.js': { gzip: 107000, raw: 373000 },
    'index.cjs': { gzip: 154000, raw: 528000 },
    'index.js': { gzip: 154000, raw: 528000 },
    'png.cjs': { gzip: 69000, raw: 234000 },
    'png.js': { gzip: 69000, raw: 234000 },
};

/**
 * @typedef {object} MeasureDistParams
 * @property {string} distDir - Directory holding the built entries.
 * @property {Record<string, {gzip: number, raw: number}>} [budgets] - Which files to measure.
 */

/**
 * Measure the raw and gzipped size of every budgeted entry that exists.
 *
 * A file that is missing is simply absent from the result - `compareBundleSizes`
 * treats that as a failure rather than a pass, so a build that produced nothing
 * cannot slip through as "under budget".
 *
 * @param {MeasureDistParams} params - Where the build output is.
 * @returns {Record<string, {gzip: number, raw: number}>} Sizes in bytes, per file.
 *
 * @example
 * ```javascript
 * measureDist({ distDir: 'dist' });
 * // { 'index.js': { gzip: 139036, raw: 477795 }, ... }
 * ```
 */
export function measureDist(params) {
    const { budgets = BUNDLE_BUDGETS, distDir } = params;
    /** @type {Record<string, {gzip: number, raw: number}>} */
    const measured = {};

    for (const file of Object.keys(budgets)) {
        const path = join(distDir, file);
        try {
            if (!statSync(path).isFile()) continue;
        } catch {
            continue;
        }
        const contents = readFileSync(path);
        measured[file] = { gzip: gzipSync(contents).length, raw: contents.length };
    }

    return measured;
}

/**
 * @typedef {object} BundleSizeRow
 * @property {number} budget - The ceiling in bytes.
 * @property {string} file - The entry's filename.
 * @property {'gzip' | 'raw'} kind - Which size this row reports.
 * @property {number | undefined} size - The measured size, or undefined when the file is missing.
 */

/**
 * @typedef {object} CompareBundleSizesParams
 * @property {Record<string, {gzip: number, raw: number}>} budgets - Ceilings per entry.
 * @property {Record<string, {gzip: number, raw: number}>} measured - Sizes per entry.
 */

/**
 * Compare measured sizes against their budgets.
 *
 * @param {CompareBundleSizesParams} params - The budgets and the measurements.
 * @returns {{ overBudget: BundleSizeRow[], rows: BundleSizeRow[] }} Every row, and just the failures.
 *
 * @example
 * ```javascript
 * compareBundleSizes({
 *     budgets: { 'index.js': { gzip: 100, raw: 200 } },
 *     measured: { 'index.js': { gzip: 90, raw: 190 } },
 * }).overBudget; // []
 * ```
 */
export function compareBundleSizes(params) {
    const { budgets, measured } = params;
    /** @type {BundleSizeRow[]} */
    const rows = [];

    for (const [file, budget] of Object.entries(budgets)) {
        for (const kind of /** @type {const} */ (['raw', 'gzip'])) {
            rows.push({ budget: budget[kind], file, kind, size: measured[file]?.[kind] });
        }
    }

    // An absent file counts as over budget: a build that emitted nothing must not
    // read as the smallest possible bundle.
    const overBudget = rows.filter((row) => row.size === undefined || row.size > row.budget);

    return { overBudget, rows };
}

/** Format one row as `index.js  raw   477795 / 528000  (9.5% headroom)`. */
function formatRow(row) {
    const label = `${row.file.padEnd(18)} ${row.kind.padEnd(4)}`;
    if (row.size === undefined) return `${label} MISSING from the build output`;

    const headroom = (((row.budget - row.size) / row.budget) * 100).toFixed(1);
    const sizes = `${String(row.size).padStart(7)} / ${String(row.budget).padStart(7)}`;
    return `${label} ${sizes}  (${headroom}% headroom)`;
}

await runAsScript({
    importMetaUrl: import.meta.url,
    options: { dist: { type: 'string' } },
    usage: 'check-bundle-size.mjs [--dist <dir>]',
    main: ({ dist = join(repoRoot, 'dist') }) => {
        const measured = measureDist({ distDir: dist });
        const { overBudget, rows } = compareBundleSizes({
            budgets: BUNDLE_BUDGETS,
            measured,
        });

        for (const row of rows) console.log(formatRow(row));

        if (overBudget.length > 0) {
            for (const row of overBudget) {
                console.error(`::error::${formatRow(row)}`);
            }
            throw new Error(
                `${overBudget.length} bundle size budget(s) exceeded. Either shrink the ` +
                    `entry or raise its budget in scripts/check-bundle-size.mjs, in the ` +
                    `same commit that grew it.`
            );
        }

        console.log(`check-bundle-size: ok (${rows.length / 2} entries)`);
    },
});
