import { totalmem } from 'node:os';
import { loadOptionalPeer } from './loadOptionalPeer';
import { resolvePngFontOptions } from './pngFonts';

/** Bytes per pixel in resvg's RGBA output pixmap. */
const PIXMAP_BYTES_PER_PIXEL = 4;

/** Bytes in a GiB, for error messages. */
const GIB = 2 ** 30;

/** Minimal signature of the `@resvg/resvg-js` module used here. */
interface ResvgModule {
    /** Parses the SVG; `width` and `height` are its intrinsic size. Renders nothing until asked. */
    Resvg: new (
        svg: string,
        options?: { font?: { loadSystemFonts: boolean } }
    ) => { height: number; width: number };
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
    return loadOptionalPeer({
        hint: " (or pass engine: 'html-to-image' to use the deprecated Puppeteer-based fallback until it is removed in 2.0).",
        load: async () => (await import('@resvg/resvg-js')) as unknown as ResvgModule,
        packageName: '@resvg/resvg-js',
    });
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

    /** Whether resvg should also parse every installed system font. */
    loadSystemFonts?: boolean;

    /**
     * Font family the SVG asks for, which names the family without selecting
     * where fonts are loaded from. See `resolvePngFontOptions`.
     */
    preferredFamily?: string;

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
    const {
        backgroundColor,
        fontDirs,
        fontFamily,
        fontFiles,
        loadSystemFonts,
        preferredFamily,
        scale = 1,
        svg,
        width,
    } = params;
    // NaN and Infinity pass a plain `<= 0` check and resvg then ignores the target
    // width, silently rendering at 1x.
    if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`PNG export 'scale' must be a positive finite number, got ${scale}.`);
    }
    const { Resvg, renderAsync } = await loadResvg();

    // resvg allocates the whole output pixmap at once and, when that fails, aborts the
    // process natively with nothing a caller can catch. So refuse a pixmap that could
    // never fit, one larger than the memory the process can have, before resvg tries.
    // A fixed pixel limit would also refuse large renders that succeed today. In a
    // container, totalmem() reports the host and constrainedMemory() the cgroup limit
    // (0 when there is none, and absent on some runtimes).
    //
    // The intrinsic size comes from resvg's own parser, which costs a fraction of the
    // render, rather than from a height a PngExporter caller may have passed
    // inconsistently. Rounding up overestimates rather than predicting resvg's rounding.
    const intrinsic = new Resvg(svg, { font: { loadSystemFonts: false } });
    if (intrinsic.width > 0) {
        const targetWidth = Math.round(width * scale);
        const targetHeight = Math.ceil((targetWidth * intrinsic.height) / intrinsic.width);
        const pixmapBytes = targetWidth * targetHeight * PIXMAP_BYTES_PER_PIXEL;
        const constrained = process.constrainedMemory?.() ?? 0;
        const memoryBytes = constrained > 0 ? Math.min(constrained, totalmem()) : totalmem();
        if (pixmapBytes > memoryBytes) {
            throw new Error(
                `PNG export 'scale' ${scale} is too large: the ${targetWidth} x ${targetHeight} pixel image needs ` +
                    `${(pixmapBytes / GIB).toFixed(1)} GiB of memory, more than the ` +
                    `${(memoryBytes / GIB).toFixed(1)} GiB available. Use a smaller scale.`
            );
        }
    }

    const font = resolvePngFontOptions({
        fontDirs,
        fontFamily,
        fontFiles,
        loadSystemFonts,
        preferredFamily,
        renderedText: svg,
    });
    const background =
        backgroundColor && backgroundColor !== 'transparent' ? backgroundColor : undefined;

    let rendered: Awaited<ReturnType<typeof renderAsync>>;
    try {
        rendered = await renderAsync(svg, {
            ...(background === undefined ? {} : { background }),
            fitTo: { mode: 'width', value: Math.round(width * scale) },
            font,
        });
    } catch (error) {
        // resvg rounds the width, derives the height from it and rounds again, and its
        // error for a 0 result names width/height/zoom options exportPng never exposes.
        // Renaming its error, rather than predicting its rounding, stays exact.
        if (error instanceof Error && error.message.includes('Target size is zero')) {
            throw new Error(
                `PNG export 'scale' ${scale} is too small: the diagram would round to 0 pixels wide or tall.`,
                { cause: error }
            );
        }
        throw error;
    }

    return {
        buffer: rendered.asPng(),
        height: rendered.height,
        width: rendered.width,
    };
}
