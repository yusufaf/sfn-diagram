/** Default timeout for icon fetch operations in milliseconds */
const DEFAULT_FETCH_TIMEOUT_MS = 5000;

interface EmbedIconsParams {
    svg: string;
    /** Timeout in milliseconds for each icon fetch (default: 5000) */
    timeoutMs?: number;
}

interface FetchAsDataUriParams {
    /** Timeout in milliseconds (default: 5000) */
    timeoutMs?: number;
    /** URL to fetch */
    url: string;
}

/**
 * Convert an ArrayBuffer to a base64 string without relying on Node's `Buffer`,
 * so icon embedding works in Node, browsers, and edge runtimes alike.
 *
 * @param buffer - Binary data to encode
 * @returns Base64-encoded string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
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

    // Find all image href attributes with URLs (not data URIs)
    const hrefPattern = /href="(https?:\/\/[^"]+)"/g;
    const matches = Array.from(svg.matchAll(hrefPattern));

    if (matches.length === 0) {
        return svg; // No external icons to embed
    }

    // Fetch all unique URLs
    const uniqueUrls = [...new Set(matches.map(match => match[1]))];
    const urlToDataUri = new Map<string, string>();

    await Promise.all(
        uniqueUrls.map(async (url) => {
            const dataUri = await fetchAsDataUri({ timeoutMs, url });
            urlToDataUri.set(url, dataUri);
        })
    );

    // Replace all URLs with data URIs
    let embeddedSvg = svg;
    urlToDataUri.forEach((dataUri, url) => {
        embeddedSvg = embeddedSvg.replaceAll(`href="${url}"`, `href="${dataUri}"`);
    });

    return embeddedSvg;
}
