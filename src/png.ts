/**
 * @module
 *
 * Node-only PNG export for `sfn-diagram` (the `sfn-diagram/png` subpath).
 *
 * This module renders an ASL definition to SVG and rasterizes it to PNG,
 * defaulting to the native, browser-free `resvg` engine. Pass
 * `engine: 'html-to-image'` to opt into the Puppeteer-based fallback engine
 * instead (an optional peer dependency loaded lazily). It is isolated from
 * the core entry so importing `sfn-diagram` never pulls in either rasterizer.
 *
 * @example
 * ```typescript
 * import { exportPng } from 'sfn-diagram/png';
 * import { writeFileSync } from 'node:fs';
 *
 * const { buffer } = await exportPng({ aslDefinition: asl });
 * writeFileSync('diagram.png', buffer);
 * ```
 */
import { generateSvg } from './index';
import { PngExporter } from './exporters';
import { embedIcons } from './utils/iconEmbedder';
import type { ExportPngParams, PngOutput } from './types';

export { PngExporter } from './exporters';
export type { ExportPngParams, PngOutput } from './types';

/**
 * Render an ASL definition directly to a PNG image.
 *
 * Generates an SVG from the definition, then rasterizes it to PNG using the
 * native `resvg` engine by default. Runs on Node only.
 *
 * @param params - ASL definition plus diagram, background, PNG engine, and font options.
 * @returns The PNG buffer along with its dimensions and format metadata.
 *
 * @example
 * ```typescript
 * const { buffer, width, height } = await exportPng({
 *   aslDefinition: asl,
 *   backgroundColor: '#ffffff',
 *   scale: 2,
 * });
 * ```
 */
export async function exportPng(params: ExportPngParams): Promise<PngOutput> {
    const {
        aslDefinition,
        backgroundColor,
        engine,
        fontDirs,
        fontFamily,
        fontFiles,
        pngQuality,
        scale,
        ...svgOptions
    } = params;
    const svgOutput = generateSvg({ aslDefinition, ...svgOptions });

    // resvg (the default engine) does not fetch remote <image href> icons the
    // way the html-to-image engine's headless Chromium did - inline them as
    // data URIs first so showIcons keeps working after the engine switch.
    const svg =
        svgOptions.showIcons && (engine ?? 'resvg') === 'resvg'
            ? await embedIcons({ svg: svgOutput.svg })
            : svgOutput.svg;

    const exporter = new PngExporter({
        backgroundColor,
        engine,
        fontDirs,
        fontFamily,
        fontFiles,
        pngQuality,
        scale,
    });
    return exporter.convert({
        height: svgOutput.height,
        svg,
        width: svgOutput.width,
    });
}
