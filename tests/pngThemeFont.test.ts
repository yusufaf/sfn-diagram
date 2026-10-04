import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const render = async (options: ConstructorParameters<typeof PngExporter>[0]) => {
    await new PngExporter(options).convert({ height: 100, svg, width: 200 });
    return lastFont();
};

/**
 * `SvgRenderer` writes `theme.fontFamily` onto every `<text>`, and the default
 * font path loads one probed file that resvg then uses for whatever family the
 * SVG asks for. So a custom `theme.fontFamily` has to reach the font resolution
 * too, or it renders as the probe family with nothing reported (#336 review).
 *
 * These assert the family that is asked for, not which source resolved: the
 * latter depends on what fonts the host has, which is covered with an injected
 * platform in `tests/pngFonts.test.ts`. The font env vars are cleared for the
 * same reason - a developer with one exported should not fail the suite.
 */
describe('PNG font resolution against the theme', () => {
    beforeEach(() => {
        renderAsync.mockClear();
        for (const name of [
            'SFN_DIAGRAM_PNG_FONT_DIRS',
            'SFN_DIAGRAM_PNG_FONT_FAMILY',
            'SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS',
        ]) {
            vi.stubEnv(name, '');
        }
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('asks for no particular family under the built-in theme', async () => {
        const font = await render({});

        expect(font?.defaultFontFamily).not.toBe('Georgia');
    });

    it.each(['light', 'dark'] as const)(
        'keeps the fast single-file path for the %s theme',
        async (theme) => {
            const font = await render({ theme });

            expect(font?.loadSystemFonts).toBe(false);
            expect(font?.fontFiles).toHaveLength(1);
        }
    );

    it('asks resvg for a custom theme font family, and keeps system fonts searchable', async () => {
        const font = await render({ theme: { fontFamily: 'Georgia' } });

        expect(font?.defaultFontFamily).toBe('Georgia');
        expect(font?.sansSerifFamily).toBe('Georgia');
        expect(font?.loadSystemFonts).toBe(true);
    });

    // theme.fontFamily is a CSS stack; resvg's defaultFontFamily takes one name
    // and does not split a list, so the whole stack would match nothing.
    it('takes the first family out of a stack, unquoted', async () => {
        const font = await render({ theme: { fontFamily: "'MyBrand Sans', Helvetica, sans-serif" } });

        expect(font?.defaultFontFamily).toBe('MyBrand Sans');
    });

    it('keeps the fast path for a custom theme that changes something else', async () => {
        const font = await render({ theme: { fontSize: 18 } });

        expect(font?.loadSystemFonts).toBe(false);
    });

    it('still honours an explicit fontFamily option alongside a theme family', async () => {
        const font = await render({ fontFamily: 'Courier New', theme: { fontFamily: 'Georgia' } });

        expect(font?.defaultFontFamily).toBe('Courier New');
    });

    it('still searches configured fontDirs when the theme names a family', async () => {
        vi.stubEnv('SFN_DIAGRAM_PNG_FONT_DIRS', process.cwd());

        const font = await render({ theme: { fontFamily: 'Georgia' } });

        expect(font?.fontDirs).toEqual([process.cwd()]);
        expect(font?.defaultFontFamily).toBe('Georgia');
    });
});
