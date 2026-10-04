import type { PngExporterOptions, PngOutput } from '../types';
import { AWS_DARK_THEME, AWS_LIGHT_THEME, getTheme } from '../config/themes';
import { renderHtmlToImagePng } from './htmlToImageEngine';
import { renderResvgPng } from './resvgEngine';

/**
 * The font families the built-in themes use, and so the only ones the probe
 * table's single font file can be assumed to satisfy.
 */
const BUILT_IN_FONT_FAMILIES = new Set([AWS_LIGHT_THEME.fontFamily, AWS_DARK_THEME.fontFamily]);

/** Parameters for converting SVG to PNG */
export interface ConvertParams {
    /**
     * Height of the SVG in pixels.
     *
     * Only enforced on the `html-to-image` engine, which lays the SVG out in a
     * fixed-size HTML page. The `resvg` engine (the default) computes height
     * itself from the SVG's own aspect ratio at the requested `width`, so the
     * returned {@link PngOutput.height} can differ from this value if the two
     * disagree - pass a `height` consistent with the SVG's intrinsic aspect
     * ratio when it matters.
     */
    height: number;
    /** SVG markup string */
    svg: string;
    /** Width of the SVG in pixels */
    width: number;
}

/**
 * PngExporter - Converts SVG to PNG.
 *
 * Defaults to `resvg`, a native, browser-free rasterizer. Pass
 * `engine: 'html-to-image'` to opt into the Puppeteer-based fallback engine
 * instead.
 *
 * Note: neither engine fetches external images (like AWS service icons from
 * a CDN) itself - `exportPng` (the `sfn-diagram/png` subpath) inlines them as
 * data URIs first via `embedIcons` when `showIcons` is set and the engine is
 * `resvg`. A caller using `PngExporter` directly must do the same.
 */
export class PngExporter {
    private options: PngExporterOptions;

    constructor(options: PngExporterOptions) {
        this.options = options;
    }

    /**
     * Convert SVG string to PNG buffer
     */
    async convert(params: ConvertParams): Promise<PngOutput> {
        const { svg, width, height } = params;
        const {
            backgroundColor,
            engine = 'resvg',
            fontDirs,
            fontFamily,
            fontFiles,
            loadSystemFonts,
            pngQuality,
            scale,
            theme,
        } = this.options;

        // SvgRenderer writes theme.fontFamily onto every <text>, and the default
        // font path loads exactly one probed file - which resvg then uses for
        // whatever family the SVG asks for, so a custom theme.fontFamily would
        // silently render as the probed font. It goes in as preferredFamily, not
        // fontFamily: it has to name the family without also claiming to be the
        // font source, which would skip the font dirs a caller configured.
        const themeFontFamily = getTheme(theme).fontFamily;
        const preferredFamily = BUILT_IN_FONT_FAMILIES.has(themeFontFamily)
            ? undefined
            : themeFontFamily;

        const rendered =
            engine === 'resvg'
                ? await renderResvgPng({
                      backgroundColor,
                      fontDirs,
                      fontFamily,
                      fontFiles,
                      loadSystemFonts,
                      preferredFamily,
                      scale,
                      svg,
                      width,
                  })
                : await renderHtmlToImagePng({ backgroundColor, height, pngQuality, svg, width });

        return {
            buffer: rendered.buffer,
            height: rendered.height,
            metadata: {
                format: 'png',
            },
            width: rendered.width,
        };
    }
}
