// The argv/error-reporting scaffold every script in scripts/ repeats: the
// `process.argv[1] === fileURLToPath(import.meta.url)` guard that keeps a script
// importable by its own test, a strict `parseArgs`, a usage message for a missing
// required flag, and the `::error::` + exit 1 wrapper that makes a thrown error
// show up as a GitHub Actions annotation.
//
// Extracted for #230: resolve-docker-tag.mjs and resolve-optional-peer-version.mjs
// carried near-identical copies, and font-probes.mjs would have been a third.
//
// No shebang, for the same reason those two have none: they are imported directly
// by tests, and a shebang followed by CRLF line endings (what a Windows checkout
// produces) breaks esbuild's shebang-stripping regex during that import.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * @template {Record<string, unknown>} Values
 * @typedef {object} RunAsScriptParams
 * @property {string} importMetaUrl - The caller's `import.meta.url`, for the entry guard.
 * @property {(values: Values) => void | Promise<void>} main - What to do once the flags validate.
 * @property {Record<string, {type: 'string' | 'boolean'}>} options - `parseArgs` options.
 * @property {string[]} [required] - Flags that must be present and non-empty.
 * @property {string} usage - The one-line usage message, e.g. `resolve-docker-tag.mjs --tag <release-tag>`.
 */

/**
 * Run `main` when this module's file is the process entry point, with the argv
 * parsing and error reporting every script in `scripts/` needs. Does nothing at
 * all when the module was imported rather than executed, so a test can import
 * the script's exported functions without running its CLI.
 *
 * Exits 1 on a usage error (missing or unparseable flags) and 1 on a thrown
 * error, printing it as a GitHub Actions `::error::` annotation.
 *
 * @template {Record<string, unknown>} Values
 * @param {RunAsScriptParams<Values>} params - Entry URL, flag schema, usage line, and the body.
 * @returns {Promise<void>} Resolves once `main` has finished; never rejects.
 *
 * @example
 * ```javascript
 * await runAsScript({
 *     importMetaUrl: import.meta.url,
 *     options: { tag: { type: 'string' } },
 *     required: ['tag'],
 *     usage: 'resolve-docker-tag.mjs --tag <release-tag>',
 *     main: ({ tag }) => console.log(resolveDockerTag({ tag })),
 * });
 * ```
 */
export async function runAsScript(params) {
    const { importMetaUrl, main, options, required = [], usage } = params;

    if (process.argv[1] !== fileURLToPath(importMetaUrl)) return;

    let values;
    try {
        ({ values } = parseArgs({ options, strict: true }));
    } catch (error) {
        // An unknown or malformed flag is a usage error, not an internal one, so it
        // gets the usage line rather than a bare stack trace.
        console.error(
            `${error instanceof Error ? error.message : String(error)}`,
        );
        console.error(`usage: ${usage}`);
        process.exit(1);
    }

    const missing = required.filter((name) => {
        const value = values[name];
        return value === undefined || value === '';
    });
    if (missing.length > 0) {
        console.error(`usage: ${usage}`);
        process.exit(1);
    }

    try {
        await main(/** @type {Values} */ (values));
    } catch (error) {
        console.error(
            `::error::${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
    }
}
