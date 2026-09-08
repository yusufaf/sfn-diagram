import type { PngExporterOptions, PngOutput } from '../types';
import { renderHtmlToImagePng } from './htmlToImageEngine';
import { renderResvgPng } from './resvgEngine';

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
