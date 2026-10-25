import { afterEach, describe, it, expect, vi } from 'vitest';
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

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-positive or non-finite scale (%s)', async (scale) => {
        await expect(renderResvgPng({ svg: textSvg(true), width: 200, scale })).rejects.toThrow(
            /scale.*positive/i
        );
    });

    it('names the scale when it is too small to leave a single pixel', async () => {
        // resvg's own error for a zero target width talks about width/height/zoom
        // options a caller of exportPng never set.
        await expect(
            renderResvgPng({ svg: textSvg(true), width: 200, scale: 0.001 })
        ).rejects.toThrow(/'scale' 0\.001 is too small/);
    });

    // resvg derives the height from the rounded target width and rounds it again, so
    // these use SVGs whose own size has the problem shape rather than predicting it.
    const sizedSvg = (width: number, height: number): string =>
        `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#000"/></svg>`;

    it('names the scale when a wide, short diagram would round to 0 pixels tall', async () => {
        // 4000 x 0.005 = 20px wide, so 60px tall becomes 60 * 20 / 4000 = 0.3, which rounds to 0.
        await expect(
            renderResvgPng({ svg: sizedSvg(4000, 60), width: 4000, scale: 0.005 })
        ).rejects.toThrow(/'scale' 0\.005 is too small/);
    });

    it('renders a scale that rounds up to a one-pixel image', async () => {
        // 100 x 0.005 = 0.5 rounds up to a 1px target width, and 60 * 1 / 100 rounds to 1.
        const { height, width } = await renderResvgPng({
            svg: sizedSvg(100, 60),
            width: 100,
            scale: 0.005,
        });
        expect({ height, width }).toEqual({ height: 1, width: 1 });
    });

    // resvg aborts the process, uncatchably, when it cannot allocate the pixmap (#445).
    // These reject before it tries, so a failing check would kill the test runner
    // rather than fail a test: keep every refused size far beyond any machine's memory,
    // or bound the memory with a mocked container limit.
    describe('refusing an image too large for memory (#445)', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        /** An SVG sized only by its viewBox, the way resvg reads a hand-rolled one. */
        const viewBoxSvg = (width: number, height: number): string =>
            `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#000"/></svg>`;

        it('rejects with a catchable error naming the scale and the image size', async () => {
            // 200 x 100 at scale 10000 is 2,000,000 x about 1,000,000 pixels: 7.3 TiB of RGBA.
            await expect(renderResvgPng({ svg: textSvg(true), width: 200, scale: 10_000 })).rejects.toThrow(
                /^PNG export is too large: at scale 10000 the image would be 2000000 x 100\d{4} pixels, which needs 7\d{3}\.\d GiB of memory, more than the [\d.]+ GiB available\. Use a smaller scale\.$/
            );
        });

        it("takes the height from the SVG's own aspect ratio", async () => {
            // A 1 MiB limit leaves room for a 400 x 200 render (312.5 KiB) but not for a
            // 100 x 10000 one (3.8 MiB), which only the SVG's aspect ratio reveals.
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 20);

            await expect(
                renderResvgPng({ svg: sizedSvg(10, 1000), width: 10, scale: 10 })
            ).rejects.toThrow(/the image would be 100 x 10\d{3} pixels/);
            await expect(renderResvgPng({ svg: sizedSvg(200, 100), width: 200, scale: 2 })).resolves.toMatchObject({
                height: 200,
                width: 400,
            });
        });

        it("bounds the image by a container's memory limit, not the host's", async () => {
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 20);

            await expect(renderResvgPng({ svg: sizedSvg(200, 100), width: 200, scale: 4 })).rejects.toThrow(
                /at scale 4 the image would be 800 x 40\d pixels/
            );
        });

        it('does not underestimate an SVG whose size resvg rounds to whole pixels', async () => {
            // resvg reports a 0.5 x 2 viewBox as 1 x 2, half its true aspect ratio. At
            // width 300 the true image is 300 x 1200 (1.4 MiB), over a 1 MiB limit, while
            // the rounded size suggests 300 x 600 (0.7 MiB).
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 20);

            await expect(renderResvgPng({ svg: viewBoxSvg(0.5, 2), width: 300 })).rejects.toThrow(
                /the image would be 300 x \d+ pixels/
            );
        });

        it('still checks an SVG less than half a pixel wide, whose width resvg rounds to 0', async () => {
            // 0.4 x 1000 rendered 20 wide is 20 x 50000 pixels (3.8 MiB).
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 20);

            await expect(renderResvgPng({ svg: viewBoxSvg(0.4, 1000), width: 20 })).rejects.toThrow(
                /the image would be 20 x 50000 pixels/
            );
        });

        it('suggests a smaller scale only when the scale is above 1', async () => {
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 20);

            const error = await renderResvgPng({ svg: sizedSvg(1000, 1000), width: 1000 }).catch(
                (caught: unknown) => caught
            );
            expect(String(error)).toMatch(/at scale 1 the image would be 1000 x 100\d pixels/);
            expect(String(error)).not.toContain('smaller scale');
        });
    });
});
