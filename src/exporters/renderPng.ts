import { generateSvg } from '../index';
import type { ExportPngParams, PngOutput } from '../types';
import { embedIcons } from '../utils/iconEmbedder';
import { PngExporter } from './PngExporter';

/** Parameters for {@link renderPng}. */
export interface RenderPngParams extends ExportPngParams {
    /**
     * The largest image to rasterize, in pixels: the diagram's width and height after
     * `scale`, each rounded up, multiplied. Over it, `renderPng` throws before any icon
     * is fetched or the rasterizer loads. Omitted, there is no limit.
     */
    maxPixels?: number;
}

/**
 * Render an ASL definition to a PNG, optionally refusing one larger than `maxPixels`.
 *
 * This is the implementation behind the public `exportPng` (`sfn-diagram/png`), which
 * never passes `maxPixels`. The pixel ceiling is internal: `sfn-diagram serve` uses it,
 * through the render service, to refuse an oversized request after the one SVG render
 * it needs anyway rather than rendering a separate probe first.
 *
 * `theme: 'auto'` renders as `'light'`: a raster has no colour scheme to follow.
 *
 * @param params - The `exportPng` options plus the optional pixel ceiling.
 *
 * @returns The PNG buffer along with its dimensions and format metadata.
 *
 * @throws When the image would exceed `maxPixels` (a size that cannot be measured
 *   counts as exceeding it), and whatever `exportPng` throws.
 *
 * @example
 * ```typescript
 * const { buffer } = await renderPng({ aslDefinition: asl, maxPixels: 40_000_000 });
 * ```
 */
export async function renderPng(params: RenderPngParams): Promise<PngOutput> {
    const {
        aslDefinition,
        backgroundColor,
        cache,
        engine,
        fontDirs,
        fontFamily,
        fontFiles,
        loadSystemFonts,
        maxPixels,
        scale,
        ...svgOptions
    } = params;
    const theme = svgOptions.theme === 'auto' ? 'light' : svgOptions.theme;
    const svgOutput = generateSvg({ aslDefinition, cache, ...svgOptions, theme });

    if (maxPixels !== undefined) {
        const factor = scale ?? 1;
        const width = Math.ceil(svgOutput.width * factor);
        const height = Math.ceil(svgOutput.height * factor);
        // Negated so a NaN size fails closed.
        if (!(width * height <= maxPixels)) {
            throw new Error(
                `PNG would be ${width} x ${height} pixels, above the limit of ` +
                    `${maxPixels.toLocaleString('en-US')} pixels; use a smaller scale or sizes, or svg output`,
            );
        }
    }

    // Built before embedIcons so an invalid engine throws before any icon fetch.
    const exporter = new PngExporter({
        backgroundColor,
        engine,
        fontDirs,
        fontFamily,
        fontFiles,
        loadSystemFonts,
        scale,
        theme,
    });

    // resvg does not fetch remote <image href> icons, so inline them as data URIs first.
    const svg = svgOptions.showIcons ? await embedIcons({ svg: svgOutput.svg }) : svgOutput.svg;

    return exporter.convert({ svg, width: svgOutput.width });
}
