import { loadOptionalPeer } from './loadOptionalPeer';

/** Minimal signature of the node-html-to-image default export used here. */
type NodeHtmlToImage = (options: {
    html: string;
    puppeteerArgs?: { args?: string[] };
    quality?: number;
    transparent?: boolean;
    type?: 'png' | 'jpeg';
}) => Promise<Buffer | Buffer[]>;

/**
 * Lazily load node-html-to-image, which is an optional peer dependency.
 * Keeping it out of the static import graph means SVG/Mermaid-only consumers
 * never pull Puppeteer/Chromium, and the runtime error is actionable when it is
 * genuinely missing.
 */
async function loadRenderer(): Promise<NodeHtmlToImage> {
    return loadOptionalPeer({
        load: async () => {
            const mod = (await import('node-html-to-image')) as
                | { default: NodeHtmlToImage }
                | NodeHtmlToImage;
            return (typeof mod === 'function' ? mod : mod.default) as NodeHtmlToImage;
        },
        packageName: 'node-html-to-image',
    });
}

/** Parameters for {@link renderHtmlToImagePng}. */
export interface RenderHtmlToImagePngParams {
    /** Background color, or 'transparent' to render on a transparent background. */
    backgroundColor?: string;

    /** Height of the SVG in pixels. */
    height: number;

    /** JPEG-only quality knob forwarded to Puppeteer; PNG output ignores it. */
    pngQuality?: number;

    /** SVG markup string. */
    svg: string;

    /** Width of the SVG in pixels. */
    width: number;
}

function wrapSvgInHtml(params: { backgroundColor: string; height: number; svg: string; width: number }): string {
    const { svg, width, height, backgroundColor } = params;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            width: ${width}px;
            height: ${height}px;
            background: ${backgroundColor};
            display: flex;
            align-items: center;
            justify-content: center;
        }
        svg {
            max-width: 100%;
            max-height: 100%;
        }
    </style>
</head>
<body>
    ${svg}
</body>
</html>
        `.trim();
}

/**
 * Rasterize an SVG string to PNG via headless Chromium (Puppeteer), the
 * opt-in fallback PNG engine. Kept byte-identical to the historical default
 * engine's rendering behavior.
 *
 * @param params - The SVG markup, its dimensions, and rendering options.
 * @returns The PNG buffer, at the requested dimensions.
 */
export async function renderHtmlToImagePng(
    params: RenderHtmlToImagePngParams
): Promise<{ buffer: Buffer; height: number; width: number }> {
    const { svg, width, height, backgroundColor, pngQuality = 90 } = params;
    const html = wrapSvgInHtml({ svg, width, height, backgroundColor: backgroundColor || 'transparent' });

    const nodeHtmlToImage = await loadRenderer();
    const buffer = await nodeHtmlToImage({
        html,
        puppeteerArgs: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        quality: pngQuality,
        transparent: backgroundColor === 'transparent',
        type: 'png',
    });

    return { buffer: buffer as Buffer, height, width };
}
