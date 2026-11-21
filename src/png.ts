/**
 * @module
 *
 * Node-only PNG export for `sfn-diagram` (the `sfn-diagram/png` subpath).
 *
 * This module renders an ASL definition to SVG and rasterizes it to PNG with
 * the native, browser-free `resvg` engine (an optional peer dependency loaded
 * lazily). It is isolated from the core entry so importing `sfn-diagram` never
 * pulls in the rasterizer.
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
import { renderPng } from './exporters';
import type { ExportPngParams, PngOutput } from './types';

export { PngExporter } from './exporters';
export type { ExportPngParams, PngOutput } from './types';

/**
 * Render an ASL definition directly to a PNG image.
 *
 * Generates an SVG from the definition, then rasterizes it to PNG using the
 * native `resvg` engine. Runs on Node only.
 *
 * `theme: 'auto'` renders as `'light'`: a raster has no colour scheme to follow.
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
    // The pixel ceiling is internal, so an untyped caller's maxPixels key is dropped.
    return renderPng({ ...params, maxPixels: undefined });
}
