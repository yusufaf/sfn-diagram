// Shared by generate-doc-images.mjs and generate-gallery-images.mjs: embedding
// service icons from the aws-icons dev dependency instead of jsDelivr, and the
// --check mode that fails CI when a committed image no longer matches what its
// generator produces (#685).
//
// No shebang: tests/ci/imageDrift.test.ts imports this file, and a shebang
// followed by CRLF line endings breaks esbuild's import (see cliScript.mjs).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * The command every drift error names. `check:images` stops at the first
 * generator that fails, so a change that drifts both sets of images must still
 * send the author to both generators.
 */
export const REGENERATE_COMMAND = 'pnpm run docs:images && pnpm run gallery:images';

const ICON_URL_PATTERN =
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/aws-icons@([^/]+)\/(icons\/[^?#]+)$/;

const REMOTE_IMAGE_HREF = /<image\b[^>]*?\s(?:xlink:)?href="(https?:\/\/[^"]*)"/;

/**
 * @typedef {object} ResolveAwsIconsPackageParams
 * @property {string} repoRoot - Absolute repo root; resolution starts from its package.json.
 */

/**
 * Locate the installed `aws-icons` dev dependency.
 *
 * @param {ResolveAwsIconsPackageParams} params - Where to resolve from.
 * @returns {{ dir: string, version: string }} The package directory and its version.
 *
 * @example
 * ```javascript
 * const { dir, version } = resolveAwsIconsPackage({ repoRoot });
 * ```
 */
export function resolveAwsIconsPackage(params) {
    const { repoRoot } = params;
    const packageJsonPath = createRequire(join(repoRoot, 'package.json')).resolve(
        'aws-icons/package.json',
    );
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return { dir: dirname(packageJsonPath), version };
}

/**
 * @typedef {object} CreateLocalIconFetchParams
 * @property {string} iconsPackageDir - The installed aws-icons directory, from {@link resolveAwsIconsPackage}.
 * @property {string} iconsVersion - The installed aws-icons version.
 */

/**
 * Build a `fetch` replacement that answers the renderer's jsDelivr icon URLs
 * from the installed aws-icons package, so embedding never touches the network.
 *
 * Rejects any other URL, a URL for a different aws-icons version (the renderer's
 * `AWS_ICONS_VERSION` and the dev dependency must be bumped together), a path
 * outside the package's `icons/` directory, and an icon the package lacks.
 *
 * @param {CreateLocalIconFetchParams} params - The installed package to serve from.
 * @returns {(input: string | URL | Request) => Promise<Response>} The fetch replacement.
 *
 * @example
 * ```javascript
 * const iconFetch = createLocalIconFetch({ iconsPackageDir: dir, iconsVersion: version });
 * ```
 */
export function createLocalIconFetch(params) {
    const { iconsPackageDir, iconsVersion } = params;
    const iconsDir = join(iconsPackageDir, 'icons') + sep;

    return async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        const match = ICON_URL_PATTERN.exec(url);
        if (!match) throw new Error(`not an aws-icons jsDelivr URL: ${url}`);

        const [, requestedVersion, iconPath] = match;
        if (requestedVersion !== iconsVersion) {
            throw new Error(
                `${url} asks for aws-icons@${requestedVersion} but ${iconsVersion} is installed; ` +
                    'bump the aws-icons devDependency and AWS_ICONS_VERSION in ' +
                    'src/services/ServiceDetector.ts together',
            );
        }

        const file = resolve(iconsPackageDir, iconPath);
        if (!file.startsWith(iconsDir)) {
            throw new Error(`${url} points outside the aws-icons icons directory`);
        }

        return new Response(readFileSync(file), {
            headers: { 'content-type': 'image/svg+xml' },
            status: 200,
        });
    };
}

/**
 * @template Result
 * @typedef {object} WithLocalIconFetchParams
 * @property {(input: string | URL | Request) => Promise<Response>} iconFetch - What `fetch` answers with while `run` is in progress.
 * @property {() => Promise<Result>} run - The work that fetches icons (`embedIcons`, `exportPng`).
 */

/**
 * Run `run` with the global `fetch` replaced by `iconFetch`, restoring it afterwards.
 *
 * The library's icon embedder swallows fetch errors and keeps the remote URL, so
 * a failure would otherwise produce an image that silently lacks its icons. Every
 * failed fetch is recorded and turned into one thrown error once `run` settles.
 *
 * @template Result
 * @param {WithLocalIconFetchParams<Result>} params - The replacement fetch and the work to run.
 * @returns {Promise<Result>} Whatever `run` resolves to.
 * @throws {Error} `icon embedding failed:` plus one `<url>: <message>` line per failed fetch.
 *
 * @example
 * ```javascript
 * const { buffer } = await withLocalIconFetch({
 *     iconFetch,
 *     run: () => exportPng({ aslDefinition, showIcons: true }),
 * });
 * ```
 */
export async function withLocalIconFetch(params) {
    const { iconFetch, run } = params;
    const savedFetch = globalThis.fetch;
    /** @type {{ message: string, url: string }[]} */
    const failures = [];

    globalThis.fetch = async (input) => {
        try {
            return await iconFetch(input);
        } catch (error) {
            failures.push({
                message: error instanceof Error ? error.message : String(error),
                url: String(input instanceof Request ? input.url : input),
            });
            throw error;
        }
    };

    let result;
    try {
        result = await run();
    } finally {
        globalThis.fetch = savedFetch;
    }

    if (failures.length > 0) {
        const lines = failures.map((failure) => `${failure.url}: ${failure.message}`);
        throw new Error(`icon embedding failed:\n${lines.join('\n')}`);
    }
    return result;
}

/**
 * @typedef {object} EmbedIconsLocallyParams
 * @property {(params: { svg: string }) => Promise<string>} embedIcons - The library's `embedIcons`, injected so this file imports nothing from `dist/`.
 * @property {(input: string | URL | Request) => Promise<Response>} iconFetch - From {@link createLocalIconFetch}.
 * @property {string} svg - SVG whose `<image>` elements link to jsDelivr.
 */

/**
 * Inline every service icon in `svg` as a data URI, served from the installed
 * aws-icons package. A browser loads nothing external for an SVG shown through
 * `<img>`, which is how the docs site shows these images.
 *
 * @param {EmbedIconsLocallyParams} params - The embedder, the local fetch, and the SVG.
 * @returns {Promise<string>} The SVG with no remote `<image>` href left.
 * @throws {Error} When a fetch failed, or a remote icon href is still present.
 *
 * @example
 * ```javascript
 * svg = await embedIconsLocally({ embedIcons, iconFetch, svg });
 * ```
 */
export async function embedIconsLocally(params) {
    const { embedIcons, iconFetch, svg } = params;
    const embedded = await withLocalIconFetch({ iconFetch, run: () => embedIcons({ svg }) });
    const remaining = REMOTE_IMAGE_HREF.exec(embedded);
    if (remaining) throw new Error(`remote icon left in the SVG: ${remaining[1]}`);
    return embedded;
}

/**
 * @typedef {object} NormalizeLineEndingsParams
 * @property {string} contents - Text that may carry CRLF line endings.
 */

/**
 * Turn CRLF into LF, so a Windows checkout's committed files compare equal to
 * freshly generated ones.
 *
 * @param {NormalizeLineEndingsParams} params - The text.
 * @returns {string} The text with LF line endings.
 *
 * @example
 * ```javascript
 * normalizeLineEndings({ contents: 'a\r\nb' }); // 'a\nb'
 * ```
 */
export function normalizeLineEndings(params) {
    return params.contents.replace(/\r\n/g, '\n');
}

/**
 * @typedef {object} ImageDrift
 * @property {string} path - Repo-relative POSIX path.
 * @property {'missing' | 'stale' | 'unexpected'} problem - How the committed file differs.
 */

/**
 * @typedef {object} FindImageDriftParams
 * @property {Map<string, string>} expected - Generated contents, keyed by repo-relative POSIX path.
 * @property {string[]} [ownedDirs] - Repo-relative POSIX directories only the generator writes to; any other file in them is drift.
 * @property {string} repoRoot - Absolute repo root.
 */

/**
 * Compare committed files with what a generator would write, without writing.
 *
 * A file is `missing` when it is not committed and `stale` when its content
 * differs (line endings aside). In an owned directory, a file the generator does
 * not produce is `unexpected`; dotfiles are skipped there, since git ignores
 * `.DS_Store` and it would otherwise fail only on the author's machine.
 *
 * @param {FindImageDriftParams} params - Expected contents and where to look.
 * @returns {ImageDrift[]} Every difference, sorted by path; empty when all match.
 *
 * @example
 * ```javascript
 * const drift = findImageDrift({ expected, ownedDirs: ['site/public/gallery'], repoRoot });
 * ```
 */
export function findImageDrift(params) {
    const { expected, ownedDirs = [], repoRoot } = params;
    /** @type {ImageDrift[]} */
    const drift = [];

    for (const [path, contents] of expected) {
        const file = join(repoRoot, path);
        if (!existsSync(file)) {
            drift.push({ path, problem: 'missing' });
        } else if (
            normalizeLineEndings({ contents: readFileSync(file, 'utf-8') }) !==
            normalizeLineEndings({ contents })
        ) {
            drift.push({ path, problem: 'stale' });
        }
    }

    for (const dir of ownedDirs) {
        const dirPath = join(repoRoot, dir);
        if (!existsSync(dirPath)) continue;
        for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
            if (!entry.isFile() || entry.name.startsWith('.')) continue;
            const path = `${dir}/${entry.name}`;
            if (!expected.has(path)) drift.push({ path, problem: 'unexpected' });
        }
    }

    return drift.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * @typedef {object} WriteOrCheckImagesParams
 * @property {boolean} check - True to compare with the committed files, false to write them.
 * @property {Map<string, string>} expected - Generated contents, keyed by repo-relative POSIX path.
 * @property {string[]} [ownedDirs] - See {@link FindImageDriftParams}.
 * @property {string} regenerateCommand - The command a drift error tells the author to run.
 * @property {string} repoRoot - Absolute repo root.
 */

/**
 * Write a generator's output, or in check mode fail when the committed files
 * differ from it. Check mode never writes.
 *
 * @param {WriteOrCheckImagesParams} params - The output, the mode, and the command to name.
 * @returns {Promise<void>} Resolves once written, or once the check passes.
 * @throws {Error} In check mode, listing every drifted file and the command to run.
 *
 * @example
 * ```javascript
 * await writeOrCheckImages({ check, expected, regenerateCommand: REGENERATE_COMMAND, repoRoot });
 * ```
 */
export async function writeOrCheckImages(params) {
    const { check, expected, ownedDirs = [], regenerateCommand, repoRoot } = params;

    if (!check) {
        for (const [path, contents] of expected) {
            const file = join(repoRoot, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, contents, 'utf-8');
            console.log(`✓ ${path}`);
        }
        return;
    }

    const drift = findImageDrift({ expected, ownedDirs, repoRoot });
    if (drift.length > 0) {
        const lines = drift.map(({ path, problem }) =>
            problem === 'unexpected'
                ? `  unexpected ${path} (no generator writes it; delete it)`
                : `  ${problem} ${path}`,
        );
        throw new Error(
            `${drift.length} committed image file(s) are out of date:\n${lines.join('\n')}\n` +
                `Run '${regenerateCommand}' and commit the result.`,
        );
    }
    console.log(`✓ ${expected.size} files match`);
}
