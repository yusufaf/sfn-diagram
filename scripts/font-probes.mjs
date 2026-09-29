// Prints the font files src/exporters/pngFonts.ts probes on a platform, most
// preferred first, so a CI check can assert the font an image ships is the one the
// PNG engine will actually look for instead of restating a path in a comment.
//
// Why it parses the source rather than importing it: the callers are workflow steps
// that have a bare `node` and nothing else - docker.yml never runs `pnpm install`,
// so there is no tsx and no built dist/ to import from. tests/ci/fontProbes.test.ts
// imports FONT_PROBES from the TypeScript directly and asserts this script's output
// matches it exactly, so a probe change this parser cannot see fails the suite
// rather than turning the CI font check into a false positive.
//
// Usage:
//   node scripts/font-probes.mjs --platform linux
// Prints one absolute path per line, or exits 1 if the platform has no probes.
//
// No shebang: like the other scripts here, it is imported by its own test, and a
// shebang plus CRLF endings breaks esbuild's shebang-stripping regex on import.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAsScript } from './lib/cliScript.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the probe table lives. */
export const FONT_PROBES_SOURCE = join(
    repoRoot,
    'src',
    'exporters',
    'pngFonts.ts',
);

/**
 * @typedef {object} ReadFontProbePathsParams
 * @property {string} [source] - The contents of `pngFonts.ts`. Defaults to reading it.
 * @property {string} platform - A `process.platform` value, e.g. `linux`.
 */

/**
 * Read the absolute font-file paths `pngFonts.ts` probes on a platform, in the
 * order it probes them.
 *
 * @param {ReadFontProbePathsParams} params - The platform, and optionally the source text.
 * @returns {string[]} The probe paths, most preferred first.
 * @throws if the platform has no entry in the probe table, or the table cannot be found.
 *
 * @example
 * ```javascript
 * readFontProbePaths({ platform: 'linux' });
 * // ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', ...]
 * ```
 */
export function readFontProbePaths(params) {
    const { platform, source = readFileSync(FONT_PROBES_SOURCE, 'utf-8') } =
        params;

    const table = source.match(/const FONT_PROBES[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!table) {
        throw new Error(
            `font-probes: no FONT_PROBES table in ${FONT_PROBES_SOURCE}`,
        );
    }

    // Each platform's entry is `<platform>: [ ... ],` at one indent level inside the
    // table, written across several lines for linux/darwin and on one line for win32.
    // No entry nests an array, so the first `],` closes it either way.
    const entry = table[1].match(
        new RegExp(`\\n    ${platform}:\\s*\\[([\\s\\S]*?)\\],`),
    );
    if (!entry) {
        throw new Error(`font-probes: no probes for platform '${platform}'`);
    }

    // `path:` values are template or plain string literals; anything interpolated
    // (win32 uses `${process.env.WINDIR ?? 'C:\\Windows'}`) is resolved here the
    // same way pngFonts.ts resolves it.
    const paths = [
        ...entry[1].matchAll(/path:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g),
    ].map((match) =>
        match[2]
            .replace(
                /\$\{process\.env\.WINDIR \?\? '([^']*)'\}/g,
                (_full, fallback) =>
                    (process.env.WINDIR ?? fallback).replace(/\\\\/g, '\\'),
            )
            .replace(/\\\\/g, '\\'),
    );

    if (paths.length === 0) {
        throw new Error(
            `font-probes: platform '${platform}' has an empty probe list`,
        );
    }

    return paths;
}

await runAsScript({
    importMetaUrl: import.meta.url,
    options: { platform: { type: 'string' } },
    required: ['platform'],
    usage: 'font-probes.mjs --platform <linux|darwin|win32>',
    main: ({ platform }) => {
        console.log(readFontProbePaths({ platform }).join('\n'));
    },
});
