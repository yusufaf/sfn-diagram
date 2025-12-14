interface EmbedIconsParams {
    svg: string;
}

/**
 * Fetch a remote resource and convert it to a base64 data URI
 *
 * @param params - Parameters containing the URL to fetch
 * @returns Base64 data URI string
 */
async function fetchAsDataUri(params: { url: string }): Promise<string> {
    const { url } = params;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        // Determine MIME type from URL extension
        const mimeType = url.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        console.warn(`Failed to embed icon from ${url}:`, error);
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
    const { svg } = params;

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
            const dataUri = await fetchAsDataUri({ url });
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
