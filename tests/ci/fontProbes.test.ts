import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { FONT_PROBES } from '../../src/exporters/pngFonts';
import { readFontProbePaths } from '../../scripts/font-probes.mjs';

const repoRoot = resolve(__dirname, '../..');
const script = join(repoRoot, 'scripts', 'font-probes.mjs');

/**
 * `scripts/font-probes.mjs` parses the probe table out of `pngFonts.ts` rather than
 * importing it, because its callers are workflow steps with a bare `node` and no
 * install. These tests are what keeps that parse honest: a probe path the parser
 * cannot see would otherwise turn CI's font check into an assertion about a path
 * nothing looks for any more — the false positive #230 flagged.
 */
describe('scripts/font-probes.mjs', () => {
    const platforms = Object.keys(FONT_PROBES) as (keyof typeof FONT_PROBES)[];

    it('knows about every platform in the table, and no others', () => {
        expect(platforms.sort()).toEqual(['darwin', 'linux', 'win32']);
    });

    it.each(platforms)(
        'reports exactly the paths pngFonts.ts probes on %s',
        (platform) => {
            const expected = (FONT_PROBES[platform] ?? []).map(
                (probe) => probe.path,
            );

            expect(expected.length).toBeGreaterThan(0);
            expect(readFontProbePaths({ platform })).toEqual(expected);
        },
    );

    it.each(platforms)(
        'prints those paths one per line when run as a script (%s)',
        (platform) => {
            const stdout = execFileSync(
                process.execPath,
                [script, '--platform', platform],
                {
                    encoding: 'utf-8',
                },
            );

            expect(stdout.trim().split(/\r?\n/)).toEqual(
                (FONT_PROBES[platform] ?? []).map((probe) => probe.path),
            );
        },
    );

    it('prints the Liberation Sans path first on linux, which is what the image installs', () => {
        // Docker's runtime stage installs fonts-liberation for exactly this path, and
        // scripts/docker-smoke.sh asserts the file exists at whatever this prints.
        expect(readFontProbePaths({ platform: 'linux' })[0]).toBe(
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        );
    });

    it('fails, rather than printing nothing, for a platform with no probes', () => {
        expect(() => readFontProbePaths({ platform: 'aix' })).toThrow(
            /no probes for platform/,
        );
    });

    it('fails if the probe table cannot be found at all', () => {
        expect(() =>
            readFontProbePaths({
                platform: 'linux',
                source: '// nothing here',
            }),
        ).toThrow(/no FONT_PROBES table/);
    });
});
