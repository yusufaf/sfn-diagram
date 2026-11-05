import type { PngExporterOptions, PngOutput } from '../types';
import { getTheme } from '../config/themes';
import { renderResvgPng } from './resvgEngine';

/** Parameters for converting SVG to PNG */
export interface ConvertParams {
    /** SVG markup string */
    svg: string;
    /**
     * Intrinsic width of the SVG in pixels. The PNG's height follows from the
     * SVG's own aspect ratio.
     */
    width: number;
}

/**
 * PngExporter - Converts SVG to PNG with `resvg`, a native, browser-free
 * rasterizer.
 *
 * Note: resvg does not fetch external images (like AWS service icons from a
 * CDN). `exportPng` (the `sfn-diagram/png` subpath) inlines them as data URIs
 * first via `embedIcons` when `showIcons` is set; a caller using `PngExporter`
 * directly must do the same.
 */
export class PngExporter {
    private options: PngExporterOptions;

    /**
     * @param options - Background, font, scale and theme options for the PNG.
     * @throws {Error} When `engine` is set to anything other than `'resvg'`.
     */
    constructor(options: PngExporterOptions) {
        const engine: unknown = options.engine;
        if (engine !== undefined && engine !== 'resvg') {
            throw new Error(
                `PNG export 'engine' must be 'resvg', got '${String(engine)}'. ` +
                    "The 'html-to-image' engine was removed in sfn-diagram 2.0; omit `engine` to use resvg."
            );
        }
        this.options = options;
    }

    /**
     * Convert SVG string to PNG buffer
     */
    async convert(params: ConvertParams): Promise<PngOutput> {
        const { svg, width } = params;
        const {
            backgroundColor,
            fontDirs,
            fontFamily,
            fontFiles,
            loadSystemFonts,
            scale,
            theme,
        } = this.options;

        // SvgRenderer writes theme.fontFamily onto every <text>, and the default
        // font path loads exactly one probed file - which resvg then uses for
        // whatever family the SVG asks for, so a custom theme.fontFamily would
        // silently render as the probed font. It goes in as preferredFamily, not
        // fontFamily: it has to name the family without also claiming to be the
        // font source, which would skip the font dirs a caller configured.
        // resolvePngFontOptions narrows the stack and recognises the built-in
        // one, so the whole value goes over as it is.
        const preferredFamily = getTheme(theme).fontFamily;

        const rendered = await renderResvgPng({
            backgroundColor,
            fontDirs,
            fontFamily,
            fontFiles,
            loadSystemFonts,
            preferredFamily,
            scale,
            svg,
            width,
        });

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
