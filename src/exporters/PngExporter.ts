import type { PngExporterOptions, PngOutput } from '../types';
import { renderHtmlToImagePng } from './htmlToImageEngine';
import { renderResvgPng } from './resvgEngine';

/** Parameters for converting SVG to PNG */
export interface ConvertParams {
    /** Height of the SVG in pixels */
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
 * Note: External images (like AWS service icons from CDN) are not fetched by
 * either engine. Use `embedIcons` to inline them as data URIs first, or use
 * SVG output for best results when showIcons is enabled.
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
        const { backgroundColor, engine = 'resvg', fontDirs, fontFamily, fontFiles, pngQuality, scale } =
            this.options;

        const rendered =
            engine === 'resvg'
                ? await renderResvgPng({ backgroundColor, fontDirs, fontFamily, fontFiles, scale, svg, width })
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
