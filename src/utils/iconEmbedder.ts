/** Default timeout for icon fetch operations in milliseconds */
const DEFAULT_FETCH_TIMEOUT_MS = 5000;

/** How many icon fetches may be in flight at once */
const MAX_CONCURRENT_FETCHES = 6;

/**
 * Bytes handed to `String.fromCharCode` per call while encoding. Each chunk is
 * spread into the call's arguments, so it has to stay well under the engine's
 * argument-count ceiling.
 */
const BASE64_CHUNK_SIZE = 8192;

interface EmbedIconsParams {
    svg: string;
    /** Timeout in milliseconds for each icon fetch (default: 5000) */
    timeoutMs?: number;
}

/** Parameters for {@link embedIconsBatch}. */
export interface EmbedIconsBatchParams {
    /** SVG strings that may reference external icons, in the order results come back. */
    svgs: string[];
    /** Timeout in milliseconds for each icon fetch (default: 5000) */
    timeoutMs?: number;
}

interface FetchAsDataUriParams {
    /** Timeout in milliseconds (default: 5000) */
    timeoutMs?: number;
    /** URL to fetch */
    url: string;
}

interface MapWithConcurrencyParams<Item, Result> {
    /** Maximum number of `mapper` calls in flight at once */
    concurrency: number;
    /** Items to map */
    items: Item[];
    /** Async transform applied to each item */
    mapper: (item: Item) => Promise<Result>;
}

/**
 * Convert an ArrayBuffer to a base64 string without relying on Node's `Buffer`,
 * so icon embedding works in Node, browsers, and edge runtimes alike.
 *
 * The bytes are turned into a binary string a chunk at a time rather than one
 * character per iteration, which keeps large icons from degrading into
 * quadratic string building.
 *
 * @param buffer - Binary data to encode
 * @returns Base64-encoded string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const pieces: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
        pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
    }
    return btoa(pieces.join(''));
}

/**
 * Run an async mapper over `items` with at most `concurrency` calls in flight,
 * preserving input order in the result.
 */
async function mapWithConcurrency<Item, Result>(
    params: MapWithConcurrencyParams<Item, Result>,
): Promise<Result[]> {
    const { concurrency, items, mapper } = params;
    const results: Result[] = new Array(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index]);
        }
    };

    const workerCount = Math.min(concurrency, items.length);
    const workers: Promise<void>[] = [];
    for (let count = 0; count < workerCount; count++) {
        workers.push(worker());
    }
    // allSettled so one rejecting mapper cannot leave its sibling workers'
    // later rejections unhandled; the first failure is rethrown once all drain.
    const outcomes = await Promise.allSettled(workers);
    const failure = outcomes.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (failure) {
        throw failure.reason;
    }

    return results;
}

/**
 * Fetch a remote resource and convert it to a base64 data URI
 *
 * @param params - Parameters containing the URL and optional timeout
 * @returns Base64 data URI string, or original URL on failure
 */
async function fetchAsDataUri(params: FetchAsDataUriParams): Promise<string> {
    const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, url } = params;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);

        // Determine MIME type from URL extension
        const mimeType = url.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        clearTimeout(timeoutId);
        const errorMessage = error instanceof Error && error.name === 'AbortError'
            ? `Timeout after ${timeoutMs}ms`
            : error;
        console.warn(`Failed to embed icon from ${url}:`, errorMessage);
        return url; // Fall back to original URL
    }
}

/**
 * Embed external icon URLs in SVG as base64 data URIs
 *
 * This function scans the SVG for external image references (href attributes)
 * and replaces them with inline base64-encoded data URIs. This ensures icons
 * display correctly in standalone SVG files, PNG exports, and contexts where
 * external resources are blocked by security policies.
 *
 * Each distinct URL is fetched once, with at most six fetches in flight at a
 * time, and every occurrence is rewritten in a single pass over the SVG.
 *
 * @param params - Parameters for icon embedding
 * @param params.svg - SVG string containing external icon URLs
 * @returns Promise resolving to SVG string with embedded icons
 *
 * @example
 * const svgWithExternalIcons = generateSvg({ aslDefinition, showIcons: true });
 * const svgWithEmbeddedIcons = await embedIcons({ svg: svgWithExternalIcons.svg });
 * writeFileSync('diagram.svg', svgWithEmbeddedIcons);
 *
 * @example
 * // Chain with PNG export
 * const { svg } = generateSvg({ aslDefinition, showIcons: true });
 * const embeddedSvg = await embedIcons({ svg });
 * const png = await exportPng({ svg: embeddedSvg });
 */
export async function embedIcons(params: EmbedIconsParams): Promise<string> {
    const { svg, timeoutMs } = params;
    const [embedded] = await embedIconsBatch({ svgs: [svg], timeoutMs });
    return embedded;
}

/**
 * Embed external icon URLs in several SVGs at once, sharing one fetch per distinct
 * URL across all of them. {@link embedIcons} is the single-SVG case; this is for
 * callers holding several renderings of the same diagram — an expanded and a
 * collapsed view, say — that reference the same icons.
 *
 * @param params - Parameters for icon embedding
 * @param params.svgs - SVG strings to embed icons into
 * @returns Promise resolving to the SVGs with embedded icons, in input order
 *
 * @example
 * ```typescript
 * const [expanded, collapsed] = await embedIconsBatch({ svgs: [expandedSvg, collapsedSvg] });
 * ```
 */
export async function embedIconsBatch(params: EmbedIconsBatchParams): Promise<string[]> {
    const { svgs, timeoutMs } = params;
    const urls = collectIconUrls({ svgs });
    if (urls.length === 0) {
        return svgs; // No external icons to embed
    }
    const urlToDataUri = await resolveIconDataUris({ timeoutMs, urls });
    return svgs.map((svg) => replaceIconUrls({ svg, urlToDataUri }));
}

/** Matches an image `href` pointing at a remote URL (never a data URI). */
const ICON_HREF_PATTERN = /href="(https?:\/\/[^"]+)"/g;

/** Parameters for {@link collectIconUrls}. */
export interface CollectIconUrlsParams {
    /** SVG strings to scan. */
    svgs: string[];
}

/**
 * Every distinct remote icon URL referenced by any of the SVGs, in first-seen order.
 *
 * @param params - The SVGs to scan
 * @returns The unique remote `href` URLs
 */
export function collectIconUrls(params: CollectIconUrlsParams): string[] {
    const { svgs } = params;
    return [
        ...new Set(
            svgs.flatMap((svg) => Array.from(svg.matchAll(ICON_HREF_PATTERN), (match) => match[1])),
        ),
    ];
}

/** Parameters for {@link resolveIconDataUris}. */
export interface ResolveIconDataUrisParams {
    /** Timeout in milliseconds for each icon fetch (default: 5000) */
    timeoutMs?: number;
    /** Distinct remote URLs to fetch. */
    urls: string[];
}

/**
 * Fetch each URL once (at most six in flight) and map it to its base64 data URI. A
 * URL that fails to fetch maps to itself, so a caller substituting through the map
 * leaves that reference as it was.
 *
 * @param params - The URLs to fetch and the per-fetch timeout
 * @returns Map from URL to data URI (or to the URL itself on failure)
 */
export async function resolveIconDataUris(
    params: ResolveIconDataUrisParams,
): Promise<Map<string, string>> {
    const { timeoutMs, urls } = params;
    const dataUris = await mapWithConcurrency({
        concurrency: MAX_CONCURRENT_FETCHES,
        items: urls,
        mapper: (url) => fetchAsDataUri({ timeoutMs, url }),
    });
    const urlToDataUri = new Map<string, string>();
    urls.forEach((url, index) => {
        urlToDataUri.set(url, dataUris[index]);
    });
    return urlToDataUri;
}

/** Parameters for {@link replaceIconUrls}. */
export interface ReplaceIconUrlsParams {
    /** The SVG whose remote icon `href`s to rewrite. */
    svg: string;
    /** URL → data URI, from {@link resolveIconDataUris}. */
    urlToDataUri: Map<string, string>;
}

/**
 * Rewrite every remote icon `href` the map knows about to its data URI, in one pass.
 *
 * @param params - The SVG and the resolved URLs
 * @returns The SVG with known icon URLs inlined
 */
export function replaceIconUrls(params: ReplaceIconUrlsParams): string {
    const { svg, urlToDataUri } = params;
    return svg.replace(ICON_HREF_PATTERN, (match, url: string) => {
        const dataUri = urlToDataUri.get(url);
        return dataUri === undefined ? match : `href="${dataUri}"`;
    });
}
