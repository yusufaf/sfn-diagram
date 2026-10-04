import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderAsync = vi.fn(async () => ({
    asPng: () => Buffer.from('fake-png'),
    height: 100,
    width: 200,
}));
vi.mock('@resvg/resvg-js', () => ({ renderAsync }));

import { PngExporter } from '../src/png';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>';

/** The font options the mocked engine was handed on the last call. */
const lastFont = () => renderAsync.mock.calls.at(-1)?.[1]?.font;

/**
 * `SvgRenderer` writes `theme.fontFamily` onto every `<text>`, and the default
 * font path loads one probed file that resvg then uses for whatever family the
 * SVG asks for. So a custom `theme.fontFamily` has to reach the font resolution
 * too, or it renders as the probe family with nothing reported (#336 review).
 */
describe('PNG font resolution against the theme', () => {
    beforeEach(() => {
        renderAsync.mockClear();
    });

    it('keeps the fast single-file path for the built-in theme', async () => {
        await new PngExporter({}).convert({ height: 100, svg, width: 200 });

        // The probe table's own file and family, not anything theme-derived.
        expect(lastFont()?.fontFiles).toHaveLength(1);
        expect(lastFont()?.loadSystemFonts).toBe(false);
    });

    it.each(['light', 'dark'] as const)('keeps it for the %s theme by name', async (theme) => {
        await new PngExporter({ theme }).convert({ height: 100, svg, width: 200 });

        expect(lastFont()?.loadSystemFonts).toBe(false);
    });

    it('asks resvg for a custom theme font family, and keeps system fonts searchable', async () => {
        await new PngExporter({ theme: { fontFamily: 'Georgia' } }).convert({
            height: 100,
            svg,
            width: 200,
        });

        expect(lastFont()?.defaultFontFamily).toBe('Georgia');
        expect(lastFont()?.sansSerifFamily).toBe('Georgia');
        expect(lastFont()?.loadSystemFonts).toBe(true);
    });

    it('keeps the fast path for a custom theme that changes something else', async () => {
        await new PngExporter({ theme: { fontSize: 18 } }).convert({ height: 100, svg, width: 200 });

        expect(lastFont()?.loadSystemFonts).toBe(false);
    });

    it('lets an explicit fontFamily option win over the theme', async () => {
        await new PngExporter({ fontFamily: 'Courier New', theme: { fontFamily: 'Georgia' } }).convert(
            { height: 100, svg, width: 200 }
        );

        expect(lastFont()?.defaultFontFamily).toBe('Courier New');
    });
});
