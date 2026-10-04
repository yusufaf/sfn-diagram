import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOAD_SYSTEM_FONTS_ENV_VAR, resolvePngFontOptions } from '../src/exporters/pngFonts';

const LINUX_LIBERATION = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

/**
 * Path checks for a host where the Liberation Sans probe is a readable font and
 * the given directories exist. Both predicates matter: the probe table is
 * matched with `isFile`, while `fontDirs` are pruned with `fileExists`.
 *
 * @param dirs - Directories to report as existing.
 * @returns `fileExists`/`isFile` params to spread in.
 */
const hostWithLiberation = (...dirs: string[]) => ({
    fileExists: (path: string) => path === LINUX_LIBERATION || dirs.includes(path),
    isFile: (path: string) => path === LINUX_LIBERATION,
});

beforeEach(() => {
    // Ambient font env vars would otherwise reach the cases that assert on the
    // probe table or on the real filesystem.
    for (const name of [
        'SFN_DIAGRAM_PNG_FONT_DIRS',
        'SFN_DIAGRAM_PNG_FONT_FAMILY',
        LOAD_SYSTEM_FONTS_ENV_VAR,
    ]) {
        vi.stubEnv(name, '');
    }
});

afterEach(() => {
    vi.unstubAllEnvs();
});

/**
 * Inputs whose branch default for `loadSystemFonts` is `defaultValue`, and which
 * always carry a font source so the unsatisfiable-off guard stays out of the way.
 *
 * @param defaultValue - The default the returned inputs should produce.
 * @returns Params to spread into {@link resolvePngFontOptions}.
 */
const inputsDefaultingTo = (defaultValue: boolean) =>
    defaultValue
        ? { fileExists: () => true, fontDirs: ['/exists'], isFile: () => false }
        : { fileExists: () => true, fontFiles: ['/exists/font.ttf'], isFile: () => true };

describe('resolvePngFontOptions', () => {
    it('passes explicit fontFiles and fontDirs through verbatim', () => {
        const result = resolvePngFontOptions({
            fontDirs: ['/my/fonts'],
            fontFiles: ['/my/fonts/custom.ttf'],
            fileExists: () => true,
        });

        expect(result.fontFiles).toEqual(['/my/fonts/custom.ttf']);
        expect(result.fontDirs).toEqual(['/my/fonts']);
    });

    it('uses an explicit fontFamily as both default and sans-serif family', () => {
        const result = resolvePngFontOptions({ fontFamily: 'Custom Sans', fileExists: () => true });

        expect(result.defaultFontFamily).toBe('Custom Sans');
        expect(result.sansSerifFamily).toBe('Custom Sans');
    });

    it('probes for Liberation Sans on linux', () => {
        const result = resolvePngFontOptions({
            platform: 'linux',
            ...hostWithLiberation('/usr/share/fonts'),
        });

        expect(result.sansSerifFamily).toBe('Liberation Sans');
        expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
    });

    it('probes for Arial on win32', () => {
        const result = resolvePngFontOptions({
            platform: 'win32',
            fileExists: () => false,
            isFile: (path) => path.toLowerCase().endsWith('arial.ttf'),
        });

        expect(result.defaultFontFamily).toBe('Arial');
    });

    it('falls back to loadSystemFonts alone when nothing probed exists', () => {
        // isFile too: the probe table is matched with that one, and a CI runner
        // really does have a font at the probed path.
        const result = resolvePngFontOptions({
            platform: 'linux',
            fileExists: () => false,
            isFile: () => false,
        });

        expect(result.loadSystemFonts).toBe(true);
        expect(result.fontDirs).toBeUndefined();
        expect(result.sansSerifFamily).toBeUndefined();
    });

    it('filters out non-existent directories', () => {
        const result = resolvePngFontOptions({
            fontDirs: ['/exists', '/does-not-exist'],
            fileExists: (path) => path === '/exists',
        });

        expect(result.fontDirs).toEqual(['/exists']);
    });

    describe('preferredFamily', () => {
        // It names a family; it is not a font source. Letting it select one would
        // skip the dirs a caller configured, which is the only reason they would
        // have mounted a font in the first place.
        it('leaves SFN_DIAGRAM_PNG_FONT_DIRS searched', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', '/mounted/fonts');

            const result = resolvePngFontOptions({
                fileExists: () => true,
                preferredFamily: 'Georgia',
            });

            expect(result.fontDirs).toEqual(['/mounted/fonts']);
            expect(result.sansSerifFamily).toBe('Georgia');
        });

        it('loses to SFN_DIAGRAM_PNG_FONT_FAMILY', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Env Sans');

            const result = resolvePngFontOptions({
                fileExists: () => true,
                preferredFamily: 'Georgia',
            });

            expect(result.sansSerifFamily).toBe('Env Sans');
        });

        it('is ignored for the scan decision when an explicit fontFamily overrides it', () => {
            // The theme family is discarded here, so paying ~250ms to make it
            // findable buys nothing.
            const result = resolvePngFontOptions({
                fontFamily: 'Inter',
                fontFiles: ['/opt/fonts/Inter.ttf'],
                preferredFamily: 'Georgia',
                fileExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(false);
            expect(result.sansSerifFamily).toBe('Inter');
        });

        it('loses to an explicit fontFamily', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Explicit Sans',
                preferredFamily: 'Georgia',
                fileExists: () => true,
                isFile: () => true,
            });

            expect(result.sansSerifFamily).toBe('Explicit Sans');
        });

        it('keeps the scan on even when explicit fontFiles resolved', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                preferredFamily: 'Georgia',
                fileExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('still reaches the probe table when a blank env font dirs value is set', () => {
            // ''.split(delimiter).filter(Boolean) is an empty array, which is
            // truthy - a set-but-blank value must not shadow the probe table.
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', '');

            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Georgia',
                ...hostWithLiberation(),
            });

            expect(result.sansSerifFamily).toBe('Georgia');
            expect(result.fontDirs).toEqual([]);
        });

        it('still names the family when no probe matched at all', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Georgia',
                fileExists: () => false,
                isFile: () => false,
            });

            expect(result.defaultFontFamily).toBe('Georgia');
            expect(result.sansSerifFamily).toBe('Georgia');
            expect(result.loadSystemFonts).toBe(true);
        });
    });

    describe('renderedText coverage', () => {
        const svgWith = (text) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`;

        // The single-file fast path gives up resvg's fallback, so a glyph the
        // probed face lacks renders as a tofu box with nothing reported.
        // Measured on Windows against the real engine: CJK paints 272 pixels
        // against 1833 with the scan on, and U+21BB paints 68 - a tofu box -
        // against 180.
        it.each([
            ['plain ASCII', 'Order Received', false],
            ['the middot and ellipsis this package emits', 'Map \u00b7 items\u2026', false],
            ['the \u00d7 in a retry count', 'Retry \u00d73', false],
            ['Cyrillic, which the probed fonts cover', '\u041d\u0430\u0447\u0430\u043b\u043e', false],
            ['the U+21BB in this package own retry label', '\u21bb \u00d73', true],
            ['CJK state names', '\u51e6\u7406\u958b\u59cb', true],
            ['emoji', '\u2705 done', true],
        ])('decides the scan for %s', (_label, text, expected) => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                renderedText: svgWith(text),
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.loadSystemFonts).toBe(expected);
        });

        it('keeps the fast path when no text was passed at all', () => {
            const result = resolvePngFontOptions({ platform: 'linux', ...hostWithLiberation() });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('overrides the fast path even when explicit fontFiles resolved', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                renderedText: svgWith('\u51e6\u7406'),
                fileExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('is still overridden by an explicit loadSystemFonts', () => {
            const result = resolvePngFontOptions({
                loadSystemFonts: false,
                platform: 'linux',
                renderedText: svgWith('\u51e6\u7406'),
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
        });
    });

    describe('font family stacks', () => {
        // resvg's defaultFontFamily matches one name and does not split a list,
        // so the whole stack matches nothing - indistinguishable from the option
        // having no effect.
        it('narrows an explicit fontFamily stack to its first family', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Inter, Helvetica, sans-serif',
                fileExists: () => true,
            });

            expect(result.defaultFontFamily).toBe('Inter');
            expect(result.sansSerifFamily).toBe('Inter');
        });

        it('narrows SFN_DIAGRAM_PNG_FONT_FAMILY the same way, quotes included', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', '"Env Sans", sans-serif');

            const result = resolvePngFontOptions({ fileExists: () => true });

            expect(result.sansSerifFamily).toBe('Env Sans');
        });

        it('narrows a preferredFamily stack', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: "'MyBrand Sans', Helvetica, sans-serif",
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.sansSerifFamily).toBe('MyBrand Sans');
        });

        it('treats a stack that names nothing as no family at all', () => {
            const result = resolvePngFontOptions({
                fontDirs: ['/exists'],
                fontFamily: ' , ',
                fileExists: () => true,
            });

            expect(result.defaultFontFamily).toBeUndefined();
        });
    });

    describe('loadSystemFonts', () => {
        it('is off when a probe resolved an exact font file', () => {
            const result = resolvePngFontOptions({ platform: 'linux', ...hostWithLiberation() });

            expect(result.loadSystemFonts).toBe(false);
        });

        // existsSync is true for a directory and for a file this process cannot
        // read, neither of which resvg loads a glyph from or complains about.
        it('stays on when the probed path exists but is not a readable file', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                fileExists: () => true,
                isFile: () => false,
            });

            expect(result.fontFiles).toBeUndefined();
            expect(result.loadSystemFonts).toBe(true);
        });

        it('is off for an explicit fontFile that exists', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                fileExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        // resvg does not error on a fontFiles entry it cannot read - it renders a
        // valid, blank PNG. Keeping the scan on is what stops a typo there being
        // silent, now that it is no longer on unconditionally.
        it('stays on for fontFiles that do not exist, but still passes them through', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/typo/Arial.ttf'],
                fileExists: () => false,
                isFile: () => false,
            });

            expect(result.fontFiles).toEqual(['/typo/Arial.ttf']);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('is off when only one of several fontFiles exists', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/typo/Arial.ttf', '/my/fonts/custom.ttf'],
                fileExists: () => false,
                isFile: (path) => path === '/my/fonts/custom.ttf',
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        // A directory that exists may hold no font fontdb can parse - an empty
        // mount renders every label blank with the scan off.
        // [] is truthy, so this used to take the explicit branch and shadow both
        // the env vars and the probe table - which, forced off, then threw.
        it('ignores empty fontFiles and fontDirs arrays entirely', () => {
            const result = resolvePngFontOptions({
                fontDirs: [],
                fontFiles: [],
                loadSystemFonts: false,
                platform: 'linux',
                ...hostWithLiberation(),
            });

            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
            expect(result.loadSystemFonts).toBe(false);
        });

        it('stays on for explicit fontDirs, which prove no loadable font', () => {
            const result = resolvePngFontOptions({ fontDirs: ['/exists'], fileExists: () => true });

            expect(result.fontDirs).toEqual(['/exists']);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on when every explicit fontDir was pruned as non-existent', () => {
            const result = resolvePngFontOptions({ fontDirs: ['/gone'], fileExists: () => false });

            expect(result.fontDirs).toEqual([]);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for a fontFamily alone, which has no search path to resolve against', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Custom Sans',
                fileExists: () => true,
            });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for SFN_DIAGRAM_PNG_FONT_DIRS, for the same reason', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', '/env/fonts');

            const result = resolvePngFontOptions({ fileExists: () => true });

            expect(result.fontDirs).toEqual(['/env/fonts']);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for SFN_DIAGRAM_PNG_FONT_FAMILY alone', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Env Sans');

            const result = resolvePngFontOptions({ fileExists: () => true });

            expect(result.sansSerifFamily).toBe('Env Sans');
            expect(result.loadSystemFonts).toBe(true);
        });

        it('forced on, restores the search-path shape the probe branch used to return', () => {
            const result = resolvePngFontOptions({
                loadSystemFonts: true,
                platform: 'linux',
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.loadSystemFonts).toBe(true);
            expect(result.fontDirs).toContain('/usr/share/fonts');
            expect(result.fontFiles).toBeUndefined();
            expect(result.sansSerifFamily).toBe('Liberation Sans');
        });

        // Honouring this would render every label blank and report nothing, which
        // is the failure mode #336 is about.
        it('refuses to be forced off when no font resolved at all', () => {
            expect(() =>
                resolvePngFontOptions({
                    loadSystemFonts: false,
                    platform: 'linux',
                    fileExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/no font resolved on linux.*no text would render/);
        });

        it('names the fontFiles it could not read when it refuses', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontFiles: ['/typo/Arial.ttf', '/also/missing.ttf'],
                    loadSystemFonts: false,
                    fileExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/could not read any of \/typo\/Arial.ttf, \/also\/missing.ttf/);
        });

        it('refuses to be forced off for a fontFamily with no search path', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontFamily: 'Custom Sans',
                    loadSystemFonts: false,
                    fileExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/no text would render/);
        });

        it('honours being forced off once a fontDir resolved', () => {
            const result = resolvePngFontOptions({
                fontDirs: ['/exists'],
                loadSystemFonts: false,
                fileExists: () => true,
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        // These three use the real filesystem on purpose: the default predicate is
        // what is under test. resvg reports none of these cases - it renders a
        // valid, entirely blank PNG - so each one must keep the scan on.
        it('stays on for a fontFiles entry that is a directory, not a file', () => {
            const result = resolvePngFontOptions({ fontFiles: [process.cwd()] });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for a readable file that is not a font resvg can parse', () => {
            // Verified against the engine: rendering with this as the only font
            // paints 0 pixels, where the system scan paints 581.
            const result = resolvePngFontOptions({ fontFiles: [import.meta.filename] });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('is off for a file whose magic number is a font resvg parses', () => {
            const sfnt = join(mkdtempSync(join(tmpdir(), 'sfn-font-')), 'fake.ttf');
            // Only the leading bytes are read, so a stub is enough here; a real
            // face is exercised end to end in tests/resvgEngine.test.ts.
            writeFileSync(sfnt, Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));

            const result = resolvePngFontOptions({ fontFiles: [sfnt] });

            expect(result.loadSystemFonts).toBe(false);
        });

        it.each(['wOFF', 'wOF2'])('stays on for a %s web font, which fontdb cannot parse', (magic) => {
            const woff = join(mkdtempSync(join(tmpdir(), 'sfn-font-')), 'fake.woff');
            writeFileSync(woff, Buffer.from(`${magic}\u0000\u0000`, 'latin1'));

            const result = resolvePngFontOptions({ fontFiles: [woff] });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for a file too short to carry a magic number', () => {
            const stub = join(mkdtempSync(join(tmpdir(), 'sfn-font-')), 'fake.ttf');
            writeFileSync(stub, Buffer.from([0x00, 0x01]));

            const result = resolvePngFontOptions({ fontFiles: [stub] });

            expect(result.loadSystemFonts).toBe(true);
        });

        it.each([
            ['1', true],
            ['true', true],
            ['TRUE', true],
            ['  yes  ', true],
            ['on', true],
            ['0', false],
            ['false', false],
            ['no', false],
            ['off', false],
        ])('reads the env var set to %j as %s', (value, expected) => {
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, value);

            // Each case runs against inputs whose own default is the opposite of
            // the expectation, so a case cannot pass without the env var having
            // been read. The `false` cases need a font source too, or the
            // unsatisfiable-off guard throws instead.
            const result = resolvePngFontOptions({ ...inputsDefaultingTo(!expected) });

            expect(result.loadSystemFonts).toBe(expected);
        });

        it('ignores the env var when it is empty', () => {
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, '  ');

            const result = resolvePngFontOptions({ platform: 'linux', ...hostWithLiberation() });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('stays on for a preferredFamily, which one font file cannot satisfy', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Georgia',
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.loadSystemFonts).toBe(true);
            expect(result.sansSerifFamily).toBe('Georgia');
            expect(result.fontDirs).toContain('/usr/share/fonts');
        });

        it('honours being forced off with a preferredFamily, rather than refusing', () => {
            const result = resolvePngFontOptions({
                loadSystemFonts: false,
                platform: 'linux',
                preferredFamily: 'Georgia',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
        });

        it('throws on an env value that is not a recognized boolean', () => {
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, 'flase');

            expect(() =>
                resolvePngFontOptions({ platform: 'linux', fileExists: () => true })
            ).toThrow(/SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS must be one of .*got 'flase'/);
        });

        it('lets an explicit param win over the env var', () => {
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, 'true');

            const result = resolvePngFontOptions({
                loadSystemFonts: false,
                platform: 'linux',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
        });
    });
});
