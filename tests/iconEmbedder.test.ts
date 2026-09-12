import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrayBufferToBase64, embedIcons } from '../src/utils/iconEmbedder';

interface FakeFetchParams {
    /** Bytes returned for every URL, keyed by URL; unknown URLs get a 404 */
    bodies: Map<string, Uint8Array>;
    /** Called when a request starts and again when it settles, so tests can watch in-flight counts */
    onInFlightChange?: (inFlight: number) => void;
}

function installFakeFetch(params: FakeFetchParams): void {
    const { bodies, onInFlightChange } = params;
    let inFlight = 0;

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        inFlight += 1;
        onInFlightChange?.(inFlight);
        // Yield across two macrotask turns so overlapping requests genuinely overlap.
        await new Promise((resolve) => setTimeout(resolve, 1));
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        onInFlightChange?.(inFlight);

        const body = bodies.get(url);
        if (!body) {
            return new Response(null, { status: 404, statusText: 'Not Found' });
        }
        return new Response(body, { status: 200 });
    }));
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('arrayBufferToBase64', () => {
    it('matches Buffer encoding for inputs larger than one chunk', () => {
        // 3 chunks plus a remainder that is not a multiple of 3, exercising both the
        // chunk boundaries and base64 padding. Every byte value appears, including
        // the >0x7f range that would break a text-based conversion.
        const length = 8192 * 3 + 1000;
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index++) {
            bytes[index] = (index * 7 + 13) % 256;
        }

        const encoded = arrayBufferToBase64(bytes.buffer);

        expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
        expect(encoded.length).toBe(Math.ceil(length / 3) * 4);
    });

    it('encodes lengths on either side of a chunk boundary', () => {
        for (const length of [0, 1, 2, 3, 8191, 8192, 8193]) {
            const bytes = new Uint8Array(length).map((_, index) => index % 256);
            expect(arrayBufferToBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString('base64'));
        }
    });
});

describe('embedIcons', () => {
    it('replaces every occurrence of every URL in a single pass', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const bodies = new Map<string, Uint8Array>([
            ['https://icons.example/lambda.svg', new TextEncoder().encode('<svg>lambda</svg>')],
            ['https://icons.example/sqs.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
        ]);
        installFakeFetch({ bodies });

        const svg = [
            '<svg>',
            '<image href="https://icons.example/lambda.svg"/>',
            '<image href="https://icons.example/sqs.png"/>',
            '<image href="https://icons.example/lambda.svg"/>',
            '<image href="https://icons.example/missing.png"/>',
            '<image href="data:image/png;base64,AAAA"/>',
            '</svg>',
        ].join('');

        const embedded = await embedIcons({ svg });

        const lambdaUri = `data:image/svg+xml;base64,${Buffer.from('<svg>lambda</svg>').toString('base64')}`;
        const sqsUri = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;
        expect(embedded).toBe(
            [
                '<svg>',
                `<image href="${lambdaUri}"/>`,
                `<image href="${sqsUri}"/>`,
                `<image href="${lambdaUri}"/>`,
                '<image href="https://icons.example/missing.png"/>',
                '<image href="data:image/png;base64,AAAA"/>',
                '</svg>',
            ].join(''),
        );
        // Each distinct URL is fetched exactly once, even when it appears several times.
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    });

    it('keeps at most six fetches in flight', async () => {
        const urls = Array.from({ length: 20 }, (_, index) => `https://icons.example/icon-${index}.svg`);
        const bodies = new Map(urls.map((url) => [url, new TextEncoder().encode(url)]));
        let peakInFlight = 0;
        installFakeFetch({
            bodies,
            onInFlightChange: (inFlight) => {
                peakInFlight = Math.max(peakInFlight, inFlight);
            },
        });

        const svg = urls.map((url) => `<image href="${url}"/>`).join('');
        const embedded = await embedIcons({ svg });

        expect(peakInFlight).toBe(6);
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(urls.length);
        for (const url of urls) {
            expect(embedded).toContain(`data:image/svg+xml;base64,${Buffer.from(url).toString('base64')}`);
        }
        expect(embedded).not.toContain('https://');
    });

    it('returns the input untouched when there is nothing to embed', async () => {
        installFakeFetch({ bodies: new Map() });
        const svg = '<svg><image href="data:image/png;base64,AAAA"/></svg>';
        expect(await embedIcons({ svg })).toBe(svg);
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
});
