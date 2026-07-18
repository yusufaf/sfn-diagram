/**
 * @module
 *
 * Node-only PNG export for `sfn-diagram` (the `sfn-diagram/png` subpath).
 *
 * This module renders an ASL definition to SVG and rasterizes it to PNG via
 * `node-html-to-image` (an optional peer dependency loaded lazily). It is
 * isolated from the core entry so importing `sfn-diagram` never pulls in a
 * headless-browser dependency.
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
import type { ExportPngParams, PngOutput } from './types';

export { PngExporter } from './exporters';
export type { ExportPngParams, PngOutput } from './types';

/**
 * Render an ASL definition directly to a PNG image.
 *
 * Generates an SVG from the definition, then rasterizes it to PNG. Requires the
 * optional `node-html-to-image` peer dependency and runs on Node only.
 *
 * @param params - ASL definition plus diagram, background, and PNG-quality options.
 * @returns The PNG buffer along with its dimensions and format metadata.
 *
 * @example
 * ```typescript
 * const { buffer, width, height } = await exportPng({
 *   aslDefinition: asl,
 *   backgroundColor: '#ffffff',
 *   pngQuality: 90,
 * });
 * ```
 */
export async function exportPng(params: ExportPngParams): Promise<PngOutput> {
    const { aslDefinition, backgroundColor, pngQuality, ...svgOptions } = params;
    const svgOutput = generateSvg({ aslDefinition, ...svgOptions });

    const exporter = new PngExporter({ backgroundColor, pngQuality });
    return exporter.convert({
        height: svgOutput.height,
        svg: svgOutput.svg,
        width: svgOutput.width,
    });
}
