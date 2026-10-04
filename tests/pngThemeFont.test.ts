import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvePngFontOptionsParams } from '../src/exporters/pngFonts';

// vi.hoisted, because the factory runs while `../src/png` is being imported -
// before a plain top-level const would have been initialised.
const { resolvePngFontOptions } = vi.hoisted(() => ({
    resolvePngFontOptions: vi.fn(
        (params: ResolvePngFontOptionsParams): { loadSystemFonts: boolean } => ({
            loadSystemFonts: params.loadSystemFonts ?? false,
        })
    ),
}));
vi.mock('../src/exporters/pngFonts', () => ({ resolvePngFontOptions }));
vi.mock('@resvg/resvg-js', () => ({
    renderAsync: async () => ({ asPng: () => Buffer.from('fake-png'), height: 100, width: 200 }),
}));

import { PngExporter } from '../src/png';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>';

/** The font params the resolver was handed on the last call. */
const lastParams = () => resolvePngFontOptions.mock.calls.at(-1)?.[0];

const render = async (options: ConstructorParameters<typeof PngExporter>[0]) => {
    await new PngExporter(options).convert({ height: 100, svg, width: 200 });
    return lastParams();
};

/**
 * `SvgRenderer` writes `theme.fontFamily` onto every `<text>`, and the default
 * font path loads one probed file that resvg then uses for whatever family the
 * SVG asks for. So a custom `theme.fontFamily` has to reach the font resolution
 * too, or it renders as the probe family with nothing reported (#336 review).
 *
 * The resolver is mocked on purpose: what the exporter owns is deciding which
 * family the SVG is asking for. What the resolver then does with it depends on
 * which fonts the host has, and is tested with an injected platform in
 * `tests/pngFonts.test.ts` instead - these cases would otherwise fail on any
 * machine with no font at a probed path.
 */
describe('PNG font resolution against the theme', () => {
    beforeEach(() => {
        resolvePngFontOptions.mockClear();
    });

    // The whole stack goes over, built-in or not: resolvePngFontOptions narrows
    // it and recognises the themes' own, so a restated built-in stack like
    // 'Arial,sans-serif' is not mistaken for a custom family here.
    it('passes the built-in stack when no theme is given', async () => {
        expect(await render({})).toMatchObject({
            fontFamily: undefined,
            preferredFamily: 'Arial, sans-serif',
        });
    });

    it.each(['light', 'dark'] as const)('passes the %s theme stack', async (theme) => {
        expect(await render({ theme })).toMatchObject({ preferredFamily: 'Arial, sans-serif' });
    });

    it('passes the inherited stack when a custom theme changes something else', async () => {
        const params = await render({ theme: { fontSize: 18 } });

        expect(params?.preferredFamily).toBe('Arial, sans-serif');
    });

    it('passes a custom theme font family as the preferred one', async () => {
        const params = await render({ theme: { fontFamily: 'Georgia' } });

        expect(params?.preferredFamily).toBe('Georgia');
        // Not as fontFamily: that is a font *source*, and claiming to be one
        // would skip the font dirs a caller configured.
        expect(params?.fontFamily).toBeUndefined();
    });

    it('passes the stack verbatim, leaving the resolver to narrow it', async () => {
        const params = await render({ theme: { fontFamily: "'MyBrand Sans', Helvetica, sans-serif" } });

        expect(params?.preferredFamily).toBe("'MyBrand Sans', Helvetica, sans-serif");
    });

    it('still passes an explicit fontFamily option alongside a theme family', async () => {
        const params = await render({ fontFamily: 'Courier New', theme: { fontFamily: 'Georgia' } });

        expect(params?.fontFamily).toBe('Courier New');
    });

    it('passes a custom theme family through a dark base too', async () => {
        const params = await render({ theme: { base: 'dark', fontFamily: 'Georgia' } });

        expect(params?.preferredFamily).toBe('Georgia');
    });

    it('leaves the other font options untouched', async () => {
        const params = await render({
            fontDirs: ['/mounted/fonts'],
            loadSystemFonts: true,
            theme: { fontFamily: 'Georgia' },
        });

        expect(params).toMatchObject({
            fontDirs: ['/mounted/fonts'],
            loadSystemFonts: true,
            preferredFamily: 'Georgia',
        });
    });
});
