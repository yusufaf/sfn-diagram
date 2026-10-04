import { describe, it, expect } from 'vitest';
import { renderResvgPng } from '../src/exporters/resvgEngine';
import { countOpaquePixels, decodePng } from './decodePng';
import { REAL_PNG_EXPORT_TIMEOUT_MS } from './pngExportTimeout';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const rectSvg = `
    <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="200" height="100" fill="#ff0000" />
    </svg>
`;

const textSvg = (includeText: boolean): string => `
    <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        ${includeText ? '<text x="10" y="50" font-family="Arial, sans-serif" font-size="32">Test</text>' : ''}
    </svg>
`;

describe('renderResvgPng', { timeout: REAL_PNG_EXPORT_TIMEOUT_MS }, () => {
    it('produces a buffer starting with the PNG magic bytes', async () => {
        const { buffer } = await renderResvgPng({ svg: textSvg(true), width: 200 });

        expect(buffer.subarray(0, 8)).toEqual(PNG_MAGIC);
    });

    it('returns the SVG intrinsic size at scale 1', async () => {
        const { width, height } = await renderResvgPng({ svg: textSvg(true), width: 200 });

        expect(width).toBe(200);
        expect(height).toBe(100);
    });

    it('doubles both dimensions at scale 2', async () => {
        const { width, height } = await renderResvgPng({ svg: textSvg(true), width: 200, scale: 2 });

        expect(width).toBe(400);
        expect(height).toBe(200);
    });

    it('renders text (buffer differs from the same SVG with no text)', async () => {
        const withText = await renderResvgPng({ svg: textSvg(true), width: 200 });
        const withoutText = await renderResvgPng({ svg: textSvg(false), width: 200 });

        expect(withText.buffer.equals(withoutText.buffer)).toBe(false);
    });

    // The default font path hands resvg one specific file instead of scanning
    // every installed font (#336). A font it cannot then resolve still renders a
    // perfectly valid PNG - just an empty one - so assert on painted pixels,
    // which is the thing that regresses, rather than on the buffer existing.
    it('paints glyph pixels with the default font resolution', async () => {
        const { buffer } = await renderResvgPng({ svg: textSvg(true), width: 200 });

        expect(countOpaquePixels(decodePng(buffer))).toBeGreaterThan(100);
    });

    it('paints nothing for the same SVG with its text removed', async () => {
        const { buffer } = await renderResvgPng({ svg: textSvg(false), width: 200 });

        expect(countOpaquePixels(decodePng(buffer))).toBe(0);
    });

    it('decodes every pixel of a fully covered image, so a blank count means blank', async () => {
        const { buffer } = await renderResvgPng({ svg: rectSvg, width: 200 });

        expect(countOpaquePixels(decodePng(buffer))).toBe(200 * 100);
    });

    it('still paints glyphs with the system font scan forced back on', async () => {
        const { buffer } = await renderResvgPng({
            loadSystemFonts: true,
            svg: textSvg(true),
            width: 200,
        });

        expect(countOpaquePixels(decodePng(buffer))).toBeGreaterThan(100);
    });

    it('produces different bytes for white vs transparent backgrounds', async () => {
        const white = await renderResvgPng({ svg: textSvg(true), width: 200, backgroundColor: 'white' });
        const transparent = await renderResvgPng({
            svg: textSvg(true),
            width: 200,
            backgroundColor: 'transparent',
        });

        expect(white.buffer.equals(transparent.buffer)).toBe(false);
    });

    it.each([0, -1])('rejects a non-positive scale (%s)', async (scale) => {
        await expect(renderResvgPng({ svg: textSvg(true), width: 200, scale })).rejects.toThrow(
            /scale.*positive/i
        );
    });
});
