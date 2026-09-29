// Fails when the committed custom-elements.json no longer matches what
// `pnpm run build:manifest` would generate from src/element/.
//
// #199: the file is committed and regenerated inside `pnpm run build`, but nothing
// checked it for staleness - unlike the generated viewer script
// (scripts/build-viewer-script.mjs --check) and the Action's committed bundle. A
// stale manifest ships wrong docs to every editor and IDE that reads
// `package.json#customElements`.
//
// Two things this is careful about:
//
//   1. It never writes into the repository. The analyzer runs with --outdir
//      pointing at a fresh temp directory, because a check that regenerates the
//      committed file in place always passes and silently swallows the drift.
//   2. It compares with line endings normalized, including the `\r\n` that a
//      Windows checkout leaves *escaped inside* JSON string values, which git's
//      own eol normalization does not touch. Without that, every local run on
//      Windows would fail on churn with no content change.
//
// Usage:
//   node scripts/check-manifest.mjs --check
//
// No shebang: like the other scripts here it is imported by its own test, and a
// shebang plus CRLF endings breaks esbuild's shebang-stripping regex on import.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAsScript } from './lib/cliScript.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest file both `build:manifest` and this check work on. */
export const MANIFEST_FILE = 'custom-elements.json';

/**
 * The analyzer arguments, identical to `package.json#build:manifest` apart from
 * `--outdir`, which the caller supplies.
 */
export const CEM_ARGS = [
    'analyze',
    '--globs',
    'src/element/**/*.ts',
    '--exclude',
    'src/element/**/*.test.ts',
];

/** Recursively replace CRLF with LF in every string a parsed manifest holds. */
function normalizeStrings(value) {
    if (typeof value === 'string') return value.replace(/\r\n/g, '\n');
    if (Array.isArray(value)) return value.map(normalizeStrings);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [key, normalizeStrings(inner)])
        );
    }
    return value;
}

/** Sort by a field so a platform's traversal order cannot look like a change. */
function sortedBy(items, field) {
    if (!Array.isArray(items)) return items;
    return [...items].sort((left, right) =>
        String(left?.[field] ?? '').localeCompare(String(right?.[field] ?? ''))
    );
}

/**
 * Reduce a manifest to a form that depends only on its content: CRLF normalized
 * inside every string, and the module/declaration/export lists in a fixed order.
 *
 * Order matters here because it is not stable across platforms. Measured: on a
 * Windows checkout the analyzer emits `auto.ts` first, on Linux
 * `SfnDiagramElement.ts` first, with byte-identical content otherwise - so a
 * string comparison reports the committed file as stale on whichever platform did
 * not generate it.
 */
function canonicalize(contents) {
    const manifest = normalizeStrings(JSON.parse(contents));

    manifest.modules = sortedBy(manifest.modules, 'path').map((module) => ({
        ...module,
        declarations: sortedBy(module.declarations, 'name'),
        exports: sortedBy(module.exports, 'name'),
    }));

    return JSON.stringify(manifest, null, 2);
}

/** Fallback for content that is not valid JSON: normalize line endings only. */
function normalize(contents) {
    return contents.replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\\n').replace(/\n+$/, '');
}

/** Canonical form when the text parses as JSON, normalized text when it does not. */
function comparable(contents) {
    try {
        return canonicalize(contents);
    } catch {
        return normalize(contents);
    }
}

/**
 * @typedef {object} ManifestsMatchParams
 * @property {string} committed - Contents of the committed `custom-elements.json`.
 * @property {string} regenerated - Contents the analyzer just produced.
 */

/**
 * Whether a freshly generated manifest matches the committed one, ignoring line
 * endings — including the `\r\n` a Windows checkout leaves escaped inside JSON
 * string values, which is the whole of the churn this file shows on Windows.
 *
 * @param {ManifestsMatchParams} params - The two file contents.
 * @returns {boolean} True when they differ only by line endings.
 *
 * @example
 * ```javascript
 * manifestsMatch({ committed: '{"d":"a\\r\\nb"}\r\n', regenerated: '{"d":"a\\nb"}\n' }); // true
 * ```
 */
export function manifestsMatch(params) {
    const { committed, regenerated } = params;
    return comparable(committed) === comparable(regenerated);
}

/**
 * Describe the first place two manifests differ, after normalization, as two
 * windows of context.
 *
 * @param {ManifestsMatchParams} params - The two file contents.
 * @returns {string} A human-readable report naming the offset and both snippets.
 *
 * @example
 * ```javascript
 * describeFirstDifference({ committed: '{"a":1}', regenerated: '{"a":2}' });
 * // 'first difference at character 5 ...'
 * ```
 */
export function describeFirstDifference(params) {
    const committed = comparable(params.committed);
    const regenerated = comparable(params.regenerated);

    let index = 0;
    while (
        index < committed.length &&
        index < regenerated.length &&
        committed[index] === regenerated[index]
    ) {
        index += 1;
    }

    const window = (text) => JSON.stringify(text.slice(Math.max(0, index - 80), index + 120));

    return [
        `first difference at character ${index} of ${committed.length} (committed) / ${regenerated.length} (regenerated)`,
        `  committed:   ${window(committed)}`,
        `  regenerated: ${window(regenerated)}`,
    ].join('\n');
}

/**
 * Run the analyzer into a throwaway directory and return what it produced.
 *
 * @returns {string} The generated manifest's contents.
 * @throws if the analyzer fails or writes nothing.
 */
function regenerateManifest() {
    // Under node_modules/.cache, not the OS temp directory: the analyzer joins
    // --outdir onto its cwd, so an absolute path becomes C:\repo\C:\Users\... and
    // fails outright on Windows. node_modules is already ignored, so nothing here
    // can turn up in `git status` either.
    const cacheDir = join(repoRoot, 'node_modules', '.cache');
    mkdirSync(cacheDir, { recursive: true });
    const outDir = mkdtempSync(join(cacheDir, 'sfn-manifest-'));

    // The analyzer's `packagejson` option defaults to true, which rewrites this
    // repo's package.json#customElements to point at whatever --outdir was - so a
    // bare `cem analyze --outdir <temp>` leaves the repo pointing at a deleted temp
    // directory. It cannot be turned off from the command line (the flag is a
    // value-less Boolean), but a config file beats DEFAULTS in the analyzer's own
    // merge, so the check brings its own.
    const configPath = join(outDir, 'cem-check.config.mjs');
    writeFileSync(configPath, 'export default { packagejson: false };\n');

    // Spawned through node against the analyzer's own entry rather than
    // node_modules/.bin/cem, which is a .CMD shim on Windows that execFileSync
    // cannot run directly.
    const cem = join(repoRoot, 'node_modules', '@custom-elements-manifest', 'analyzer', 'cem.js');

    try {
        execFileSync(
            process.execPath,
            [
                cem,
                ...CEM_ARGS,
                '--outdir',
                relative(repoRoot, outDir),
                '--config',
                relative(repoRoot, configPath),
            ],
            { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] }
        );

        return readFileSync(join(outDir, MANIFEST_FILE), 'utf-8');
    } finally {
        rmSync(outDir, { force: true, recursive: true });
    }
}

await runAsScript({
    importMetaUrl: import.meta.url,
    options: { check: { type: 'boolean' } },
    required: ['check'],
    usage: 'check-manifest.mjs --check',
    main: () => {
        const committed = readFileSync(join(repoRoot, MANIFEST_FILE), 'utf-8');
        const regenerated = regenerateManifest();

        if (!manifestsMatch({ committed, regenerated })) {
            // Print where they part company. "It is stale" alone leaves the reader
            // guessing whether the committed file is behind or the check is wrong.
            console.error(describeFirstDifference({ committed, regenerated }));
            throw new Error(
                `${MANIFEST_FILE} is stale - run 'pnpm run build:manifest' and commit the result.`
            );
        }

        console.log(`check-manifest: ${MANIFEST_FILE} is up to date`);
    },
});
