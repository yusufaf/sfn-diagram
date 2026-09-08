import { resolvePngFontOptions } from './pngFonts';

/** Minimal signature of the `@resvg/resvg-js` module used here. */
interface ResvgModule {
    renderAsync: (
        svg: string,
        options?: {
            background?: string;
            fitTo?: { mode: 'width'; value: number };
            font?: {
                defaultFontFamily?: string;
                fontDirs?: string[];
                fontFiles?: string[];
                loadSystemFonts: boolean;
                sansSerifFamily?: string;
            };
        }
    ) => Promise<{ asPng: () => Buffer; height: number; width: number }>;
}

/**
 * Lazily load `@resvg/resvg-js`, which is an optional peer dependency. Keeping
 * it out of the static import graph means SVG/Mermaid-only consumers never
 * pull in the native rasterizer, and the runtime error is actionable when it
 * is genuinely missing.
 */
async function loadResvg(): Promise<ResvgModule> {
    try {
        return (await import('@resvg/resvg-js')) as unknown as ResvgModule;
    } catch {
        throw new Error(
            "PNG export requires the optional peer dependency '@resvg/resvg-js'. " +
                'Install it with: npm install @resvg/resvg-js ' +
                "(or pass engine: 'html-to-image' to use the Puppeteer-based fallback instead)."
        );
    }
}

/** Parameters for {@link renderResvgPng}. */
export interface RenderResvgPngParams {
    /** Background color, or 'transparent' (the default) to omit a background entirely. */
    backgroundColor?: string;

    /** Directories to search for font files. */
    fontDirs?: string[];

    /** Font family to use, overriding automatic detection. */
    fontFamily?: string;

    /** Explicit font files to load. */
    fontFiles?: string[];

    /** Multiplier applied to the diagram's rendered size. @default 1 */
    scale?: number;

    /** SVG markup string. */
    svg: string;

    /** Intrinsic width of the SVG in pixels (the root `<svg>` has no width/height attribute, only a viewBox). */
    width: number;
}

/**
 * Rasterize an SVG string to PNG using the native, browser-free `resvg` engine.
 *
 * Unlike the `html-to-image` engine's lenient browser HTML parser, resvg's
 * XML parser requires the SVG root element to declare `xmlns`. Every SVG this
 * package generates already does, but a hand-rolled SVG string passed
 * directly to {@link PngExporter} must too.
 *
 * @param params - The SVG markup, its intrinsic width, and rendering options.
 * @returns The PNG buffer along with the actual rendered dimensions.
 */
export async function renderResvgPng(
    params: RenderResvgPngParams
): Promise<{ buffer: Buffer; height: number; width: number }> {
    const { backgroundColor, fontDirs, fontFamily, fontFiles, scale = 1, svg, width } = params;
    const { renderAsync } = await loadResvg();

    const font = resolvePngFontOptions({ fontDirs, fontFamily, fontFiles });
    const background =
        backgroundColor && backgroundColor !== 'transparent' ? backgroundColor : undefined;

    const rendered = await renderAsync(svg, {
        ...(background === undefined ? {} : { background }),
        fitTo: { mode: 'width', value: Math.round(width * scale) },
        font,
    });

    return {
        buffer: rendered.asPng(),
        height: rendered.height,
        width: rendered.width,
    };
}
