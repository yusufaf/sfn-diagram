// Resolves the exact version pnpm-lock.yaml pins for a package in the root
// importer, so the Dockerfile can install an *optional peer* into the runtime
// image at precisely the version this repo tests against.
//
// Why this exists: PNG export's engine (@resvg/resvg-js) is declared only as a
// devDependency + optional peerDependency, so `pnpm install --prod` never
// installs it - which is https://github.com/yusufaf/sfn-diagram/issues/153, an
// image that advertised `--format png` while throwing the missing-peer error
// for three releases. Reading the pinned version here keeps the image from
// drifting to a version the test suite has never seen.
//
// Usage:
//   node scripts/resolve-optional-peer-version.mjs --package @resvg/resvg-js
// Prints the version to stdout, or exits 1 with a message.
//
// No shebang: like scripts/resolve-docker-tag.mjs, this is imported directly by
// tests/ci/resolveOptionalPeerVersion.test.ts, and a shebang followed by CRLF
// endings (what a Windows checkout produces) breaks esbuild's shebang-stripping
// regex during that import.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

/**
 * @typedef {object} ResolveOptionalPeerVersionParams
 * @property {string} lockfileContents - Raw contents of `pnpm-lock.yaml`.
 * @property {string} packageName - The package to look up, e.g. `@resvg/resvg-js`.
 */

/**
 * Resolve the exact version `pnpm-lock.yaml` pins for a package in the root
 * importer, searching both `dependencies` and `devDependencies`.
 *
 * @param {ResolveOptionalPeerVersionParams} params - The lockfile text and package name.
 * @returns {string} The exact resolved version, e.g. `2.6.2`.
 * @throws if the lockfile has no root importer, or the package is not pinned in it.
 *
 * @example
 * resolveOptionalPeerVersion({ lockfileContents, packageName: '@resvg/resvg-js' });
 * // '2.6.2'
 */
export function resolveOptionalPeerVersion(params) {
    const { lockfileContents, packageName } = params;

    const lockfile = parse(lockfileContents);
    const root = lockfile?.importers?.['.'];
    if (!root) {
        throw new Error(
            'resolveOptionalPeerVersion: no root importer (".") in pnpm-lock.yaml',
        );
    }

    const entry = root.dependencies?.[packageName] ?? root.devDependencies?.[packageName];
    if (!entry?.version) {
        throw new Error(
            `resolveOptionalPeerVersion: "${packageName}" not found in the root importer of pnpm-lock.yaml`,
        );
    }

    // pnpm suffixes peer-resolved entries, e.g. `1.2.3(react@18.3.1)`. The
    // registry only accepts the bare version.
    return String(entry.version).split('(')[0];
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
    const { values } = parseArgs({
        options: { package: { type: 'string' } },
        strict: true,
    });

    if (!values.package) {
        console.error('usage: resolve-optional-peer-version.mjs --package <name>');
        process.exit(1);
    }

    try {
        console.log(
            resolveOptionalPeerVersion({
                lockfileContents: readFileSync('pnpm-lock.yaml', 'utf-8'),
                packageName: values.package,
            }),
        );
    } catch (error) {
        console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
