import { generateSvg } from './index';
import { PngExporter } from './exporters';
import type { ExportPngParams, PngOutput } from './types';

export { PngExporter } from './exporters';
export type { ExportPngParams, PngOutput } from './types';

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
