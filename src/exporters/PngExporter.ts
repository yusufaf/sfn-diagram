import type { DiagramOptions, PngOutput } from '../types';

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
    try {
        const mod = (await import('node-html-to-image')) as
            | { default: NodeHtmlToImage }
            | NodeHtmlToImage;
        return (typeof mod === 'function' ? mod : mod.default) as NodeHtmlToImage;
    } catch {
        throw new Error(
            "PNG export requires the optional peer dependency 'node-html-to-image'. " +
                'Install it with: npm install node-html-to-image'
        );
    }
}

/** Parameters for converting SVG to PNG */
export interface ConvertParams {
    /** Height of the SVG in pixels */
    height: number;
    /** SVG markup string */
    svg: string;
    /** Width of the SVG in pixels */
    width: number;
}

/** Parameters for wrapping SVG in HTML */
interface WrapSvgParams {
    /** Height of the SVG in pixels */
    height: number;
    /** SVG markup string */
    svg: string;
    /** Width of the SVG in pixels */
    width: number;
}

/**
 * PngExporter - Converts SVG to PNG using headless rendering
 */
export class PngExporter {
    private options: DiagramOptions;

    constructor(options: DiagramOptions) {
        this.options = options;
    }

    /**
     * Convert SVG string to PNG buffer
     *
     * Note: External images (like AWS service icons from CDN) may not render in PNG export
     * due to limitations with headless browser rendering. Use SVG output for best results
     * when showIcons is enabled.
     */
    async convert(params: ConvertParams): Promise<PngOutput> {
        const { svg, width, height } = params;
        const html = this.wrapSvgInHtml({ svg, width, height });

        const nodeHtmlToImage = await loadRenderer();
        const buffer = await nodeHtmlToImage({
            html,
            puppeteerArgs: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
            quality: this.options.pngQuality || 90,
            transparent: this.options.backgroundColor === 'transparent',
            type: 'png',
        });

        return {
            buffer: buffer as Buffer,
            height,
            metadata: {
                format: 'png',
            },
            width,
        };
    }

    /**
     * Wrap SVG in HTML for rendering
     */
    private wrapSvgInHtml(params: WrapSvgParams): string {
        const { svg, width, height } = params;
        const backgroundColor = this.options.backgroundColor || 'transparent';

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
}
