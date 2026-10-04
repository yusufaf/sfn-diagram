import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    FONT_SEARCH_LIMITS,
    LOAD_SYSTEM_FONTS_ENV_VAR,
    resolvePngFontOptions,
} from '../src/exporters/pngFonts';

const LINUX_LIBERATION = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

/**
 * Path checks for a host where the Liberation Sans probe is a readable font and
 * the given directories exist. Both predicates matter: the probe table is
 * matched with `isFile`, while `fontDirs` are pruned with `dirExists`.
 *
 * @param dirs - Directories to report as existing.
 * @returns `dirExists`/`isFile` params to spread in.
 */
const hostWithLiberation = (...dirs: string[]) => ({
    dirExists: (path: string) => path === LINUX_LIBERATION || dirs.includes(path),
    isFile: (path: string) => path === LINUX_LIBERATION,
});

/** Temp directories made by the real-filesystem cases, removed after each one. */
const scratchDirs: string[] = [];

/**
 * A file with the given leading bytes, in a directory cleaned up afterwards.
 *
 * @param params - The file's name and its first bytes.
 * @returns The path written.
 */
const scratchFile = (params: { bytes: number[] | Buffer; name: string }): string => {
    const directory = mkdtempSync(join(tmpdir(), 'sfn-font-'));
    scratchDirs.push(directory);
    const path = join(directory, params.name);
    writeFileSync(path, Buffer.from(params.bytes));
    return path;
};

/** Leading bytes of a TrueType font, which is all the magic check reads. */
const SFNT_MAGIC = [0x00, 0x01, 0x00, 0x00, 0x00, 0x00];

/**
 * A real directory holding one parseable stub font. The forced-off guard walks
 * the configured directories now, so a fake path no longer stands in for one.
 *
 * @returns The directory's path.
 */
const scratchDirWithFont = (): string =>
    dirname(scratchFile({ bytes: SFNT_MAGIC, name: 'stub.ttf' }));

/** A real directory with nothing in it that resvg could load. */
const scratchDirWithoutFont = (): string =>
    dirname(scratchFile({ bytes: [0x00], name: 'notes.txt' }));

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
    while (scratchDirs.length) {
        rmSync(scratchDirs.pop() as string, { force: true, recursive: true });
    }
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
        ? // A real directory: with the scan forced off, the guard walks it.
          { dirExists: () => true, fontDirs: [scratchDirWithFont()] }
        : { dirExists: () => true, fontFiles: ['/exists/font.ttf'], isFile: () => true };

describe('resolvePngFontOptions', () => {
    it('passes explicit fontFiles and fontDirs through verbatim', () => {
        const result = resolvePngFontOptions({
            fontDirs: ['/my/fonts'],
            fontFiles: ['/my/fonts/custom.ttf'],
            dirExists: () => true,
        });

        expect(result.fontFiles).toEqual(['/my/fonts/custom.ttf']);
        expect(result.fontDirs).toEqual(['/my/fonts']);
    });

    // The generic mapping stays the probed face: it is the one that is certain
    // to resolve, and pointing it at a family that may not exist only loses that.
    it('names an explicit fontFamily as the default family', () => {
        const result = resolvePngFontOptions({
            fontFamily: 'Custom Sans',
            platform: 'linux',
            ...hostWithLiberation(),
        });

        expect(result.sansSerifFamily).toBe('Liberation Sans');

        expect(result.defaultFontFamily).toBe('Custom Sans');
        expect(result.defaultFontFamily).toBe('Custom Sans');
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
            dirExists: () => false,
            isFile: (path) => path.toLowerCase().endsWith('arial.ttf'),
        });

        expect(result.defaultFontFamily).toBe('Arial');
    });

    it('falls back to loadSystemFonts alone when nothing probed exists', () => {
        // isFile too: the probe table is matched with that one, and a CI runner
        // really does have a font at the probed path.
        const result = resolvePngFontOptions({
            platform: 'linux',
            dirExists: () => false,
            isFile: () => false,
        });

        expect(result.loadSystemFonts).toBe(true);
        expect(result.fontDirs).toBeUndefined();
        expect(result.sansSerifFamily).toBeUndefined();
    });

    it('filters out non-existent directories', () => {
        const result = resolvePngFontOptions({
            fontDirs: ['/exists', '/does-not-exist'],
            dirExists: (path) => path === '/exists',
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
                dirExists: () => true,
                preferredFamily: 'Georgia',
            });

            expect(result.fontDirs).toEqual(['/mounted/fonts']);
            expect(result.sansSerifFamily).toBe('Georgia');
        });

        it('loses to SFN_DIAGRAM_PNG_FONT_FAMILY', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Env Sans');

            const result = resolvePngFontOptions({
                dirExists: () => true,
                preferredFamily: 'Georgia',
            });

            expect(result.defaultFontFamily).toBe('Env Sans');
        });

        // fontFamily does not override what the markup asks for - resvg applies
        // it only to text naming no family - so it cannot stand in for the
        // theme family either. Measured: exportPng is byte-identical with and
        // without it.
        it('survives an explicit fontFamily, which overrides nothing in the markup', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Inter',
                fontFiles: ['/opt/fonts/Inter.ttf'],
                preferredFamily: 'Georgia',
                dirExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(true);
            expect(result.sansSerifFamily).toBe('Inter');
        });

        it('is no preference at all when it is the themes own stack', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Arial,sans-serif',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('survives the markup escaping its quotes', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: '"Arial", sans-serif',
                renderedText:
                    '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="&quot;Arial&quot;, sans-serif">x</text></svg>',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('loses to an explicit fontFamily', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Explicit Sans',
                preferredFamily: 'Georgia',
                dirExists: () => true,
                isFile: () => true,
            });

            expect(result.defaultFontFamily).toBe('Explicit Sans');
        });

        it('keeps the scan on even when explicit fontFiles resolved', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                preferredFamily: 'Georgia',
                dirExists: () => true,
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

            expect(result.defaultFontFamily).toBe('Georgia');
            // The probed face reached the result, so the blank value did not
            // shadow the table.
            expect(result.sansSerifFamily).toBe('Liberation Sans');
        });

        it('still names the family when no probe matched at all', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Georgia',
                dirExists: () => false,
                isFile: () => false,
            });

            expect(result.defaultFontFamily).toBe('Georgia');
            expect(result.sansSerifFamily).toBe('Georgia');
            expect(result.loadSystemFonts).toBe(true);
        });
    });

    describe('renderedText coverage', () => {
        const svgWith = (text: string) =>
            `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`;

        // The single-file fast path gives up resvg's fallback, so a glyph the
        // probed face lacks renders as a tofu box with nothing reported.
        // Measured on Windows against the real engine: CJK paints 272 pixels
        // against 1833 with the scan on, and U+21BB paints 68 - a tofu box -
        // against 180.
        it.each([
            ['plain ASCII', 'Order Received', false],
            ['the middot and ellipsis this package emits', 'Map \u00b7 items\u2026', false],
            ['dashes and curly quotes, measured as covered', '\u2018a\u2019 \u2013 \u201cb\u201d \u2014 c \u2022', false],
            ['U+2010 HYPHEN, which Arial has no glyph for', 'co\u2010operate', true],
            ['U+203B REFERENCE MARK', 'note \u203b', true],
            ['the U+2264 this package writes in Map batch labels', '\u2264 100KB', false],
            ['U+2265', '\u2265 1', false],
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
                dirExists: () => true,
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

    describe('families named in the markup', () => {
        const svgAsking = (family: string) =>
            `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="${family}">x</text></svg>`;

        // resvg resolves a family it cannot find to whatever face did load, so
        // the family is silently ignored rather than failing. A hand-authored
        // SVG passed to PngExporter is the case that has no theme behind it.
        it.each([
            ['the themes own stack, whatever the probe is called', 'Arial, sans-serif', false],
            ['a generic family alone', 'monospace', false],
            ['the resolved probe family itself', 'Liberation Sans', false],
            ['a quoted family that is the probe', "'Liberation Sans', sans-serif", false],
            ['a family nothing loaded has', 'Courier New, monospace', true],
            ['an unquoted custom family', 'Comic Sans MS', true],
        ])('decides the scan for %s', (_label, family, expected) => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                renderedText: svgAsking(family),
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.loadSystemFonts).toBe(expected);
        });

        it('reads a family out of a style declaration too', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                renderedText:
                    '<svg xmlns="http://www.w3.org/2000/svg"><text style="font-family: Courier New">x</text></svg>',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('keeps the fast path when a custom theme names the probe font itself', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: 'Liberation Sans',
                renderedText: svgAsking('Liberation Sans, sans-serif'),
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
        });
    });

    describe('a font file the caller supplied', () => {
        // WIDELY_COVERED_RANGES was measured against the probe table; a caller's
        // font may be Latin-only or script-specific, so only ASCII is assumed.
        // Measured: a Cyrillic state name with a Cyrillic-less font paints tofu.
        it.each([
            ['ASCII text', 'Order Received', false],
            ['Cyrillic, which the probed fonts cover but this one may not', '\u041d\u0430\u0447\u0430\u043b\u043e', true],
            ['an accented Latin name', 'Cr\u00e9ation', true],
        ])('decides the scan for %s', (_label, text, expected) => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                renderedText: `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`,
                dirExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(expected);
        });
    });

    describe('a hand-authored SVG passed with the caller own fonts', () => {
        const svgAsking = (family: string) =>
            `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="${family}">x</text></svg>`;

        // There is no face name to compare against for a file the caller
        // supplied, so only the themes' own stack can be assumed satisfied.
        // Anything else was silently rendered in whatever they supplied.
        it.each([
            ['the themes own stack', 'Arial, sans-serif', false],
            ['a generic alone', 'monospace', false],
            ['a family the file may not be', 'Georgia', true],
        ])('decides the scan for %s', (_label, family, expected) => {
            const result = resolvePngFontOptions({
                fontFiles: ['/opt/fonts/Inter.ttf'],
                renderedText: svgAsking(family),
                dirExists: () => true,
                isFile: () => true,
            });

            expect(result.loadSystemFonts).toBe(expected);
        });
    });

    describe('font family stacks', () => {
        // resvg's defaultFontFamily matches one name and does not split a list,
        // so the whole stack matches nothing - indistinguishable from the option
        // having no effect.
        it('narrows an explicit fontFamily stack to its first family', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Inter, Helvetica, sans-serif',
                dirExists: () => true,
            });

            expect(result.defaultFontFamily).toBe('Inter');
            expect(result.defaultFontFamily).toBe('Inter');
        });

        it('narrows SFN_DIAGRAM_PNG_FONT_FAMILY the same way, quotes included', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', '"Env Sans", sans-serif');

            const result = resolvePngFontOptions({ dirExists: () => true });

            expect(result.defaultFontFamily).toBe('Env Sans');
        });

        it('narrows a preferredFamily stack', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                preferredFamily: "'MyBrand Sans', Helvetica, sans-serif",
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.defaultFontFamily).toBe('MyBrand Sans');
        });

        it('treats a stack that names nothing as no family at all', () => {
            const result = resolvePngFontOptions({
                fontDirs: ['/exists'],
                fontFamily: ' , ',
                dirExists: () => true,
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
                dirExists: () => true,
                isFile: () => false,
            });

            expect(result.fontFiles).toBeUndefined();
            expect(result.loadSystemFonts).toBe(true);
        });

        it('is off for an explicit fontFile that exists', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                dirExists: () => true,
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
                dirExists: () => false,
                isFile: () => false,
            });

            expect(result.fontFiles).toEqual(['/typo/Arial.ttf']);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('is off when only one of several fontFiles exists', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/typo/Arial.ttf', '/my/fonts/custom.ttf'],
                dirExists: () => false,
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
            const result = resolvePngFontOptions({ fontDirs: ['/exists'], dirExists: () => true });

            expect(result.fontDirs).toEqual(['/exists']);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on when every explicit fontDir was pruned as non-existent', () => {
            const result = resolvePngFontOptions({ fontDirs: ['/gone'], dirExists: () => false });

            expect(result.fontDirs).toEqual([]);
            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for a fontFamily alone, which has no search path to resolve against', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Custom Sans',
                dirExists: () => true,
            });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for SFN_DIAGRAM_PNG_FONT_DIRS, for the same reason', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', '/env/fonts');

            const result = resolvePngFontOptions({ dirExists: () => true });

            expect(result.fontDirs).toEqual(['/env/fonts']);
            expect(result.loadSystemFonts).toBe(true);
        });

        // The family names a font; it is not a source. Letting it select the env
        // branch skipped the probe table, so the two documented env vars
        // together threw on an image that ships a probed font.
        it('still reaches the probe table for SFN_DIAGRAM_PNG_FONT_FAMILY alone', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Liberation Sans');

            const result = resolvePngFontOptions({ platform: 'linux', ...hostWithLiberation() });

            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
            expect(result.sansSerifFamily).toBe('Liberation Sans');
        });

        it('honours the two env vars together instead of refusing', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Liberation Sans');
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, 'false');

            const result = resolvePngFontOptions({ platform: 'linux', ...hostWithLiberation() });

            expect(result.loadSystemFonts).toBe(false);
            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
        });

        it('lets an explicit fontFamily win over the env family', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Env Sans');

            const result = resolvePngFontOptions({
                fontFamily: 'Param Sans',
                platform: 'linux',
                ...hostWithLiberation(),
            });

            expect(result.defaultFontFamily).toBe('Param Sans');
        });

        it('stays on for SFN_DIAGRAM_PNG_FONT_FAMILY alone', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_FAMILY', 'Env Sans');

            const result = resolvePngFontOptions({ dirExists: () => true });

            expect(result.defaultFontFamily).toBe('Env Sans');
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
                    dirExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/no font resolved on linux.*no text would render/);
        });

        it('names a fontDirs entry it pruned when it refuses', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontDirs: ['/not/a/directory'],
                    loadSystemFonts: false,
                    dirExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/could not load a font from \/not\/a\/directory/);
        });

        it('says a fontDir exists but holds nothing loadable, not just that it pruned one', () => {
            const empty = scratchDirWithoutFont();

            expect(() =>
                resolvePngFontOptions({
                    fontDirs: [empty],
                    loadSystemFonts: false,
                    dirExists: () => true,
                })
            ).toThrow(/no font resvg can parse/);
        });

        // A truncated search cannot be read as a find: that would honour the
        // request against a tree whose fonts are past the budget and render
        // blank, which is the failure the guard exists to stop.
        it('says so when the search ran out of budget rather than claiming a find', () => {
            const directory = scratchDirWithoutFont();
            const entries = FONT_SEARCH_LIMITS.entries;
            FONT_SEARCH_LIMITS.entries = 0;

            try {
                expect(() =>
                    resolvePngFontOptions({
                        fontDirs: [directory],
                        loadSystemFonts: false,
                        dirExists: () => true,
                    })
                ).toThrow(/no font in its first 0 entries/);
            } finally {
                FONT_SEARCH_LIMITS.entries = entries;
            }
        });

        it('names the fontFiles it could not read when it refuses', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontFiles: ['/typo/Arial.ttf', '/also/missing.ttf'],
                    loadSystemFonts: false,
                    dirExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/could not load a font from \/typo\/Arial.ttf, \/also\/missing.ttf/);
        });

        it('refuses to be forced off for a fontFamily with nothing to load from', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontFamily: 'Custom Sans',
                    loadSystemFonts: false,
                    platform: 'linux',
                    dirExists: () => false,
                    isFile: () => false,
                })
            ).toThrow(/no text would render/);
        });

        // fontFamily names a family; it is not a source. Letting it select the
        // explicit branch skipped the probe table, handed back the full scan,
        // and threw over a font the table would have found.
        it('still reaches the probe table when only a fontFamily was given', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Liberation Sans',
                platform: 'linux',
                ...hostWithLiberation(),
            });

            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
            expect(result.loadSystemFonts).toBe(false);
        });

        it('honours being forced off for a fontFamily the probe table satisfies', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Liberation Sans',
                loadSystemFonts: false,
                platform: 'linux',
                ...hostWithLiberation(),
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('scans for a fontFamily the probed face is not', () => {
            const result = resolvePngFontOptions({
                fontFamily: 'Georgia',
                platform: 'linux',
                ...hostWithLiberation('/usr/share/fonts'),
            });

            expect(result.defaultFontFamily).toBe('Georgia');
            expect(result.loadSystemFonts).toBe(true);
        });

        it('honours being forced off for a fontDir that holds a font', () => {
            const directory = scratchDirWithFont();

            const result = resolvePngFontOptions({
                fontDirs: [directory],
                loadSystemFonts: false,
                dirExists: () => true,
            });

            expect(result.fontDirs).toEqual([directory]);
            expect(result.loadSystemFonts).toBe(false);
        });

        // The empty `-v ./myfonts:/fonts` mount: a directory that exists is not
        // proof a font will load, and this is the one case the guard is for.
        it('refuses to be forced off for a fontDir with no loadable font in it', () => {
            expect(() =>
                resolvePngFontOptions({
                    fontDirs: [scratchDirWithoutFont()],
                    loadSystemFonts: false,
                    dirExists: () => true,
                })
            ).toThrow(/no text would render/);
        });

        it('finds a font nested below the fontDir it was given', () => {
            const nested = join(scratchDirWithFont(), 'nested');
            mkdirSync(nested);
            writeFileSync(join(nested, 'deep.ttf'), Buffer.from(SFNT_MAGIC));

            const result = resolvePngFontOptions({
                fontDirs: [dirname(nested)],
                loadSystemFonts: false,
                dirExists: () => true,
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
            // Only the leading bytes are read, so a stub is enough here; a real
            // face is exercised end to end in tests/resvgEngine.test.ts.
            const sfnt = scratchFile({ bytes: [0x00, 0x01, 0x00, 0x00, 0x00, 0x00], name: 'fake.ttf' });

            const result = resolvePngFontOptions({ fontFiles: [sfnt] });

            expect(result.loadSystemFonts).toBe(false);
        });

        it.each(['wOFF', 'wOF2'])('stays on for a %s web font, which fontdb cannot parse', (magic) => {
            const woff = scratchFile({ bytes: Buffer.from(`${magic}..`, 'latin1'), name: 'fake.woff' });

            const result = resolvePngFontOptions({ fontFiles: [woff] });

            expect(result.loadSystemFonts).toBe(true);
        });

        it('stays on for a file too short to carry a magic number', () => {
            const stub = scratchFile({ bytes: [0x00, 0x01], name: 'fake.ttf' });

            const result = resolvePngFontOptions({ fontFiles: [stub] });

            expect(result.loadSystemFonts).toBe(true);
        });

        // existsSync is equally true for a regular file, which resvg cannot
        // search - so honouring `false` against one renders every label blank.
        it('refuses to be forced off when a fontDirs entry is a file, not a directory', () => {
            const notADirectory = scratchFile({ bytes: [0x00], name: 'hostname' });

            expect(() =>
                resolvePngFontOptions({
                    fontDirs: [notADirectory],
                    loadSystemFonts: false,
                })
            ).toThrow(/no text would render/);
        });

        it('honours being forced off for a fontDirs entry that is a real directory', () => {
            const directory = scratchDirWithFont();

            const result = resolvePngFontOptions({ fontDirs: [directory], loadSystemFonts: false });

            expect(result.fontDirs).toEqual([directory]);
            expect(result.loadSystemFonts).toBe(false);
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
            expect(result.defaultFontFamily).toBe('Georgia');
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
                resolvePngFontOptions({ platform: 'linux', dirExists: () => true })
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
