/**
 * Turning the SVG on screen into a PNG, in the browser.
 *
 * The library's `exportPng` rasterises with `@resvg/resvg-js`, which is native and
 * Node-only, so the toolbar goes through the page's own canvas instead: serialise,
 * load as an image, draw, `toBlob`. Two things stand between that and a usable PNG.
 * An SVG loaded as an image never fetches what it references, so a remote AWS icon
 * would come out as a broken-image glyph - those are inlined first. And every
 * browser caps how big a canvas may be, some of them silently - so the drawing steps
 * down a ladder of limits until one canvas actually holds pixels.
 */

/** How much larger than the diagram's own size the PNG is drawn; 1x is unreadable pasted anywhere. */
export const RASTER_SCALE = 2;

/** How long one icon may take to load before it counts as unreachable. */
export const ICON_TIMEOUT_MS = 3000;

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Fallback edge length for an icon `<image>` that has no width or height. */
const DEFAULT_ICON_SIZE = 64;

/** The largest canvas a browser is expected to hand back usable. */
export interface CanvasLimit {
    /** Most pixels in total. */
    maxArea: number;
    /** Longest side, in pixels. */
    maxDimension: number;
}

/**
 * Canvas limits to try in order, largest first. Each rung is checked for real before
 * it is trusted, so a browser that allows more than its rung loses nothing beyond
 * resolution. Areas follow the canvas-size test results (jhildenbiddle/canvas-size):
 * desktop browsers and Chrome on Android 8+, then older Firefox and Android, then
 * iOS - whose cap is on area, not on either side.
 */
export const CANVAS_LIMITS: ReadonlyArray<CanvasLimit> = [
    { maxArea: 268_435_456, maxDimension: 32_767 },
    { maxArea: 117_418_896, maxDimension: 32_767 },
    { maxArea: 16_777_216, maxDimension: 32_767 },
];

/** Parameters for {@link fitRasterScale}. */
export interface FitRasterScaleParams {
    /** Diagram height in CSS pixels. */
    height: number;
    /** The canvas limit to stay inside. */
    limit: CanvasLimit;
    /** The scale wanted, before any limit applies. */
    scale: number;
    /** Diagram width in CSS pixels. */
    width: number;
}

/**
 * The largest scale at or below `scale` at which a `width` x `height` diagram fits
 * inside `limit`.
 *
 * Size the canvas with `Math.max(1, Math.floor(width * fitted))` (and the same for
 * height): flooring keeps both sides and the area at or under the limit.
 *
 * @param params - Fit parameters
 * @param params.height - Diagram height in CSS pixels
 * @param params.limit - The canvas limit to stay inside
 * @param params.scale - The scale wanted
 * @param params.width - Diagram width in CSS pixels
 * @returns The scale to draw at
 *
 * @example
 * ```typescript
 * fitRasterScale({ height: 600, limit: CANVAS_LIMITS[0], scale: 2, width: 800 }); // 2
 * ```
 */
export function fitRasterScale(params: FitRasterScaleParams): number {
    const { height, limit, scale, width } = params;
    return Math.min(
        scale,
        limit.maxDimension / width,
        limit.maxDimension / height,
        Math.sqrt(limit.maxArea / (width * height)),
    );
}

/** A `width`/`height` attribute that is a plain pixel length, not a percentage or other unit. */
const PIXEL_LENGTH = /^\s*\+?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?\s*$/i;

/** `value` as pixels when it is a positive plain pixel length, otherwise null. */
function pixelLength(params: { value: string | null }): number | null {
    const match = PIXEL_LENGTH.exec(params.value ?? '');
    const pixels = match ? parseFloat(match[1]) : NaN;
    return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
}

/** Parameters for {@link diagramSize}. */
export interface DiagramSizeParams {
    /** The SVG to measure. */
    svg: Element;
}

/** A diagram's size in its own pixels. */
export interface DiagramSize {
    /** Height in pixels. */
    height: number;
    /** Width in pixels. */
    width: number;
}

/**
 * The size an SVG draws at in its own pixels: its `width`/`height` attributes when
 * both are plain pixel lengths, otherwise its `viewBox`.
 *
 * Every diagram the renderer produces has numeric attributes, but the viewer wraps
 * caller-supplied SVG too, and `width="100%"` would otherwise read as 100 pixels.
 *
 * @param params - Size parameters
 * @param params.svg - The SVG to measure
 * @returns The size, or null when neither source gives a positive one
 *
 * @example
 * ```typescript
 * diagramSize({ svg }); // { height: 210, width: 160 }
 * ```
 */
export function diagramSize(params: DiagramSizeParams): DiagramSize | null {
    const { svg } = params;
    const width = pixelLength({ value: svg.getAttribute('width') });
    const height = pixelLength({ value: svg.getAttribute('height') });
    if (width !== null && height !== null) return { height, width };

    const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        return { height: viewBox[3], width: viewBox[2] };
    }
    return null;
}

/** Resolve once `img` has loaded `src`; reject if it fails to. */
function loadImage(params: { img: HTMLImageElement; src: string; timeoutMs?: number }): Promise<void> {
    const { img, src, timeoutMs } = params;
    return new Promise((resolve, reject) => {
        const timer =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      // Abandon the request too, so a stalled host is not left holding it.
                      img.onload = null;
                      img.onerror = null;
                      img.removeAttribute('src');
                      reject(new Error('Image timed out: ' + src.slice(0, 64)));
                  }, timeoutMs);
        img.onload = () => {
            clearTimeout(timer);
            resolve();
        };
        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Image failed to load: ' + src.slice(0, 64)));
        };
        img.src = src;
    });
}

/**
 * The size an `<img>` reports when the image gives it nothing better: an SVG sized only
 * by its viewBox can come back as this in some engines, an aspect ratio it does not have.
 * Only SVG URLs are second-guessed; a bitmap that size really is 2:1.
 */
const DEFAULT_REPLACED_SIZE = { height: 150, width: 300 };

/** Whether `url` names an SVG file, ignoring any query or fragment. */
function isSvgUrl(url: string): boolean {
    return /\.svg$/i.test(url.split(/[?#]/)[0]);
}

/** Parameters for {@link inlineRemoteImages}. */
export interface InlineRemoteImagesParams {
    /** The detached SVG clone to rewrite in place. */
    clone: SVGSVGElement;
    /** The document to create the loading `<img>` and canvas in. */
    ownerDoc: Document;
    /** Scale the icons will be drawn at, so their data URIs are not blurry. */
    scale: number;
}

/**
 * Replace every remote `<image>` href in `clone` with a PNG data URI, so the SVG
 * draws its icons once it is loaded as an image.
 *
 * Loaded through `<img crossOrigin="anonymous">` rather than `fetch`: a strict host
 * CSP (VS Code's webview) blocks `connect-src` but already allows the icon in
 * `img-src`, since it is on screen. An icon that fails, or takes longer than
 * {@link ICON_TIMEOUT_MS}, is removed rather than left to draw as a broken glyph.
 *
 * @param params - Inline parameters
 * @param params.clone - The detached SVG clone to rewrite in place
 * @param params.ownerDoc - The document to load the icons in
 * @param params.scale - Scale the icons will be drawn at
 * @returns How many `<image>` elements could not be inlined and were removed
 *
 * @example
 * ```typescript
 * const missing = await inlineRemoteImages({ clone, ownerDoc: document, scale: 2 });
 * ```
 */
export async function inlineRemoteImages(params: InlineRemoteImagesParams): Promise<number> {
    const { clone, ownerDoc, scale } = params;

    /** One load per URL, however many sizes it is drawn at; null when it fails or stalls. */
    const loads = new Map<string, Promise<HTMLImageElement | null>>();
    const load = (loadParams: { url: string }): Promise<HTMLImageElement | null> => {
        const { url } = loadParams;
        let pending = loads.get(url);
        if (!pending) {
            const img = ownerDoc.createElement('img');
            img.crossOrigin = 'anonymous';
            pending = loadImage({ img, src: url, timeoutMs: ICON_TIMEOUT_MS }).then(
                () => img,
                () => null,
            );
            loads.set(url, pending);
        }
        return pending;
    };

    const toDataUri = async (iconParams: {
        boxHeight: number;
        boxWidth: number;
        url: string;
    }): Promise<string | null> => {
        const { boxHeight, boxWidth, url } = iconParams;
        const img = await load({ url });
        if (!img) return null;
        try {
            // Kept at the icon's own aspect ratio, fitted inside the box: the <image>'s
            // preserveAspectRatio then places it exactly as it did the original. A size
            // that is missing, or is only the 300x150 default, says nothing about the
            // icon's shape, so the box's shape stands in for it.
            const defaultSize =
                img.naturalWidth === DEFAULT_REPLACED_SIZE.width && img.naturalHeight === DEFAULT_REPLACED_SIZE.height;
            const reported = img.naturalWidth > 0 && img.naturalHeight > 0 && !(defaultSize && isSvgUrl(url));
            const naturalWidth = reported ? img.naturalWidth : boxWidth;
            const naturalHeight = reported ? img.naturalHeight : boxHeight;
            const fit = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight) * scale;
            const canvas = ownerDoc.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(naturalWidth * fit));
            canvas.height = Math.max(1, Math.ceil(naturalHeight * fit));
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        } catch {
            return null;
        }
    };

    // A bitmap per size, so the same icon drawn at two sizes is sharp at both.
    const bitmaps = new Map<string, Promise<string | null>>();
    const remote: Array<{ element: Element; key: string }> = [];
    for (const element of Array.from(clone.querySelectorAll('image'))) {
        const url = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href');
        if (!url || url.startsWith('data:')) continue;
        const boxWidth = pixelLength({ value: element.getAttribute('width') }) ?? DEFAULT_ICON_SIZE;
        const boxHeight = pixelLength({ value: element.getAttribute('height') }) ?? DEFAULT_ICON_SIZE;
        const key = `${boxWidth}x${boxHeight} ${url}`;
        remote.push({ element, key });
        if (!bitmaps.has(key)) bitmaps.set(key, toDataUri({ boxHeight, boxWidth, url }));
    }

    const results = await Promise.all(remote.map(({ key }) => bitmaps.get(key)!));
    let missing = 0;
    remote.forEach(({ element }, index) => {
        const dataUri = results[index];
        if (dataUri) {
            element.setAttribute('href', dataUri);
            element.removeAttributeNS(XLINK_NS, 'href');
        } else {
            element.remove();
            missing += 1;
        }
    });
    return missing;
}

/** Draw `img` into `canvas` at its current size; null when the canvas proves unusable. */
async function drawRung(params: {
    canvas: HTMLCanvasElement;
    img: HTMLImageElement;
}): Promise<Blob | null> {
    const { canvas, img } = params;
    const context = canvas.getContext('2d');
    if (!context) return null;

    // An oversized canvas can fail silently - drawing does nothing and toBlob still
    // answers - so prove it holds a pixel before drawing the diagram into it.
    context.fillStyle = '#000';
    context.fillRect(0, 0, 1, 1);
    if (context.getImageData(0, 0, 1, 1).data[3] === 0) return null;
    context.clearRect(0, 0, 1, 1);

    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Parameters for {@link rasterizeSvg}. */
export interface RasterizeSvgParams {
    /** Diagram height in CSS pixels. */
    height: number;
    /** Standalone SVG markup, XML-serialised. */
    markup: string;
    /** The document to create the image and canvas in. */
    ownerDoc: Document;
    /** The scale wanted, before any canvas limit applies. */
    scale: number;
    /** Diagram width in CSS pixels. */
    width: number;
}

/**
 * Rasterise SVG markup to a PNG Blob, stepping down {@link CANVAS_LIMITS} until a
 * canvas works.
 *
 * Loaded from a `data:` URL rather than a `blob:` one, since a strict host CSP
 * (VS Code's) allows `data:` in `img-src` but not `blob:`. The markup must come from
 * `XMLSerializer`: `outerHTML` writes `&nbsp;`, which XML does not define, and the
 * image then fails to load.
 *
 * @param params - Rasterise parameters
 * @param params.height - Diagram height in CSS pixels
 * @param params.markup - Standalone SVG markup
 * @param params.ownerDoc - The document to draw in
 * @param params.scale - The scale wanted
 * @param params.width - Diagram width in CSS pixels
 * @returns The PNG, or null when no canvas size worked
 * @throws When the markup does not load as an image
 *
 * @example
 * ```typescript
 * const png = await rasterizeSvg({ height: 600, markup, ownerDoc: document, scale: 2, width: 800 });
 * ```
 */
export async function rasterizeSvg(params: RasterizeSvgParams): Promise<Blob | null> {
    const { height, markup, ownerDoc, scale, width } = params;
    const img = ownerDoc.createElement('img');
    await loadImage({ img, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup) });

    for (const limit of CANVAS_LIMITS) {
        const fitted = fitRasterScale({ height, limit, scale, width });
        const canvas = ownerDoc.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(width * fitted));
        canvas.height = Math.max(1, Math.floor(height * fitted));
        try {
            const blob = await drawRung({ canvas, img });
            if (blob) return blob;
        } catch (error) {
            // Some engines throw on a canvas they cannot back, rather than failing
            // quietly; that is a reason to try the next rung. A tainted canvas is not -
            // every smaller one would taint the same way.
            if ((error as { name?: string } | null)?.name === 'SecurityError') {
                canvas.width = 0;
                canvas.height = 0;
                return null;
            }
        }
        // Release the backing store before the next rung allocates its own.
        canvas.width = 0;
        canvas.height = 0;
    }
    return null;
}
