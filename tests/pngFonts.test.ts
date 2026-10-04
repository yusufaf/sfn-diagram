import { afterEach, describe, it, expect, vi } from 'vitest';
import { LOAD_SYSTEM_FONTS_ENV_VAR, resolvePngFontOptions } from '../src/exporters/pngFonts';

const LINUX_LIBERATION = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

afterEach(() => {
    vi.unstubAllEnvs();
});

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
            fileExists: (path) => path === LINUX_LIBERATION || path === '/usr/share/fonts',
        });

        expect(result.sansSerifFamily).toBe('Liberation Sans');
        expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
    });

    it('probes for Arial on win32', () => {
        const result = resolvePngFontOptions({
            platform: 'win32',
            fileExists: (path) => path.toLowerCase().endsWith('arial.ttf'),
        });

        expect(result.defaultFontFamily).toBe('Arial');
    });

    it('falls back to loadSystemFonts alone when nothing probed exists', () => {
        const result = resolvePngFontOptions({ platform: 'linux', fileExists: () => false });

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

    describe('loadSystemFonts', () => {
        it('is off when a probe resolved an exact font file', () => {
            const result = resolvePngFontOptions({
                platform: 'linux',
                fileExists: (path) => path === LINUX_LIBERATION,
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('is off for explicit fontFiles', () => {
            const result = resolvePngFontOptions({
                fontFiles: ['/my/fonts/custom.ttf'],
                fileExists: () => true,
            });

            expect(result.loadSystemFonts).toBe(false);
        });

        it('is off for explicit fontDirs that exist', () => {
            const result = resolvePngFontOptions({ fontDirs: ['/exists'], fileExists: () => true });

            expect(result.loadSystemFonts).toBe(false);
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

        it('is off for SFN_DIAGRAM_PNG_FONT_DIRS that exist', () => {
            vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', '/env/fonts');

            const result = resolvePngFontOptions({ fileExists: () => true });

            expect(result.fontDirs).toEqual(['/env/fonts']);
            expect(result.loadSystemFonts).toBe(false);
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
                fileExists: (path) => path === LINUX_LIBERATION || path === '/usr/share/fonts',
            });

            expect(result.loadSystemFonts).toBe(true);
            expect(result.fontDirs).toContain('/usr/share/fonts');
            expect(result.fontFiles).toBeUndefined();
            expect(result.sansSerifFamily).toBe('Liberation Sans');
        });

        it('forced off, stays off even when nothing resolved at all', () => {
            const result = resolvePngFontOptions({
                loadSystemFonts: false,
                platform: 'linux',
                fileExists: () => false,
            });

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

            // fileExists is inverted against the expectation so a branch default
            // of the same value cannot make the assertion pass on its own.
            const result = resolvePngFontOptions({
                platform: 'linux',
                fileExists: () => !expected,
            });

            expect(result.loadSystemFonts).toBe(expected);
        });

        it('ignores the env var when it is empty', () => {
            vi.stubEnv(LOAD_SYSTEM_FONTS_ENV_VAR, '  ');

            const result = resolvePngFontOptions({
                platform: 'linux',
                fileExists: (path) => path === LINUX_LIBERATION,
            });

            expect(result.loadSystemFonts).toBe(false);
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
                fileExists: (path) => path === LINUX_LIBERATION,
            });

            expect(result.loadSystemFonts).toBe(false);
            expect(result.fontFiles).toEqual([LINUX_LIBERATION]);
        });
    });
});
