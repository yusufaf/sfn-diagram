import { describe, it, expect } from 'vitest';
import { resolvePngFontOptions } from '../src/exporters/pngFonts';

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
            fileExists: (path) =>
                path === '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' ||
                path === '/usr/share/fonts',
        });

        expect(result.sansSerifFamily).toBe('Liberation Sans');
        expect(result.fontDirs).toContain('/usr/share/fonts');
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
});
