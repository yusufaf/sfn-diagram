import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateSvg } from '../src';
import { generateHtmlAsync } from '../src/html';
import { exportPng } from '../src/png';
import type { AslDefinition } from '../src/types';
import {
    arrayBufferToBase64,
    collectIconUrls,
    embedIcons,
    replaceIconUrls,
} from '../src/utils/iconEmbedder';

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

describe('icon URLs come only from rendered <image> elements', () => {
    const injected = 'href="http://127.0.0.1:1/x"';

    it('ignores an href written as text', () => {
        const svg = `<text>${injected}</text><image x="0" href="https://a/b.svg"/>`;
        expect(collectIconUrls({ svgs: [svg] })).toEqual(['https://a/b.svg']);
    });

    it('still matches xlink:href on an image', () => {
        const svg = '<image width="16" xlink:href="https://a/c.svg"/>';
        expect(collectIconUrls({ svgs: [svg] })).toEqual(['https://a/c.svg']);
        expect(
            replaceIconUrls({ svg, urlToDataUri: new Map([['https://a/c.svg', 'data:x']]) }),
        ).toBe('<image width="16" xlink:href="data:x"/>');
    });

    it('rewrites only the image href and leaves the text byte-identical', () => {
        const svg = `<text>${injected}</text><image x="0" href="https://a/b.svg"/>`;
        const urlToDataUri = new Map([
            ['https://a/b.svg', 'data:image/svg+xml;base64,AAAA'],
            ['http://127.0.0.1:1/x', 'data:text/plain;base64,BBBB'],
        ]);
        expect(replaceIconUrls({ svg, urlToDataUri })).toBe(
            `<text>${injected}</text><image x="0" href="data:image/svg+xml;base64,AAAA"/>`,
        );
    });
});

describe('icon hrefs are read as attribute values', () => {
    it('decodes entities and numeric references before collecting', () => {
        const svg = '<image href="https://a/x.svg?a=1&amp;b=2&#160;&quot;&lt;&gt;"/>';
        expect(collectIconUrls({ svgs: [svg] })).toEqual(['https://a/x.svg?a=1&b=2 "<>']);
    });

    it('decodes in a single pass', () => {
        const svg = '<image href="https://a/x?q=&amp;lt;"/>';
        expect(collectIconUrls({ svgs: [svg] })).toEqual(['https://a/x?q=&lt;']);
    });

    it('treats named and numeric spellings of one URL as the same URL', () => {
        const svg = [
            '<image href="https://a/x?a=1&amp;b=2"/>',
            '<image href="https://a/x?a=1&#38;b=2"/>',
            '<image href="https://a/x?a=1&#x26;b=2"/>',
        ].join('');
        expect(collectIconUrls({ svgs: [svg] })).toEqual(['https://a/x?a=1&b=2']);
    });

    it('looks the decoded URL up in the map', () => {
        const svg = '<image href="https://a/x.svg?a=1&amp;b=2"/>';
        const urlToDataUri = new Map([['https://a/x.svg?a=1&b=2', 'data:image/svg+xml;base64,AAAA']]);
        expect(replaceIconUrls({ svg, urlToDataUri })).toBe('<image href="data:image/svg+xml;base64,AAAA"/>');
    });

    it('escapes the data URI it writes back', () => {
        const svg = '<image href="https://a/x.svg"/>';
        const urlToDataUri = new Map([['https://a/x.svg', 'data:text/plain,a&b"c']]);
        expect(replaceIconUrls({ svg, urlToDataUri })).toBe('<image href="data:text/plain,a&amp;b&quot;c"/>');
    });

    it('leaves the href byte-identical when its fetch failed', () => {
        // The numeric reference matters: re-escaping the decoded URL would write `&amp;`.
        const svg = '<image href="https://a/x.svg?a=1&#38;b=2"/>';
        const urlToDataUri = new Map([['https://a/x.svg?a=1&b=2', 'https://a/x.svg?a=1&b=2']]);
        expect(replaceIconUrls({ svg, urlToDataUri })).toBe(svg);
    });

    it('labels an .svg URL with a query string as SVG', async () => {
        installFakeFetch({ bodies: new Map([['https://icons.example/x.svg?a=1', new TextEncoder().encode('<svg/>')]]) });
        const embedded = await embedIcons({ svg: '<image href="https://icons.example/x.svg?a=1"/>' });
        expect(embedded).toContain('data:image/svg+xml;base64,');
    });

    describe('with a custom iconResolver returning a query-string URL', () => {
        const icon = 'https://icons.example/x.svg?a=1&b=2';
        const iconResolver = (): string => icon;
        const expectedUri = `data:image/svg+xml;base64,${Buffer.from('<svg>q</svg>').toString('base64')}`;
        const lambdaInvokeState = {
            End: true,
            Resource: 'arn:aws:states:::lambda:invoke',
            Type: 'Task',
        } as const;
        const lambdaTask: AslDefinition = { StartAt: 'Invoke', States: { Invoke: lambdaInvokeState } };

        function installIcon(): void {
            installFakeFetch({ bodies: new Map([[icon, new TextEncoder().encode('<svg>q</svg>')]]) });
        }

        it('embeds the icon in the SVG', async () => {
            installIcon();
            const { svg } = generateSvg({ aslDefinition: lambdaTask, iconResolver, showIcons: true });
            expect(svg).toContain('x.svg?a=1&amp;b=2');

            const embedded = await embedIcons({ svg });

            expect(embedded).toContain(expectedUri);
            expect(embedded).not.toContain('icons.example');
            expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetch).mock.calls[0][0]).toBe(icon);
        });

        it('embeds it in the HTML views and the relayout model', async () => {
            installIcon();
            const { html } = await generateHtmlAsync({
                aslDefinition: {
                    StartAt: 'Fan',
                    States: {
                        Fan: {
                            Branches: [{ StartAt: 'Invoke', States: { Invoke: lambdaInvokeState } }],
                            End: true,
                            Type: 'Parallel',
                        },
                    },
                },
                iconResolver,
                showIcons: true,
            });

            expect(html).not.toContain('icons.example');
            expect(html).toContain(expectedUri);
            const modelJson = html.match(
                /<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/,
            )?.[1];
            expect(modelJson).toBeDefined();
            const model = JSON.parse(modelJson as string) as { nodes: { iconUrl?: string }[] };
            const iconUrls = model.nodes.flatMap((node) => (node.iconUrl === undefined ? [] : [node.iconUrl]));
            expect(iconUrls.length).toBeGreaterThan(0);
            expect(iconUrls.every((iconUrl) => iconUrl === expectedUri)).toBe(true);
        });
    });
});

describe('text in a definition cannot make the renderer fetch a URL', () => {
    const secret = 'TOP-SECRET';
    let bait: Server;
    let hits = 0;
    let baitHref = '';

    beforeAll(async () => {
        bait = createServer((_request, response) => {
            hits += 1;
            response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            response.end(secret);
        });
        await new Promise<void>((resolve) => bait.listen(0, '127.0.0.1', resolve));
        const { port } = bait.address() as AddressInfo;
        baitHref = `href="http://127.0.0.1:${port}/secret"`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => bait.close(() => resolve()));
    });

    afterEach(() => {
        hits = 0;
    });

    function poisoned(): AslDefinition {
        const stateName = `Step ${baitHref}`;
        return {
            Comment: `See ${baitHref}`,
            StartAt: stateName,
            States: {
                [stateName]: { Comment: `Note ${baitHref}`, End: true, Type: 'Pass' },
            },
        };
    }

    const secretBase64 = Buffer.from(secret).toString('base64');

    it.each([false, true])('html with showIcons=%s', async (showIcons) => {
        const { html } = await generateHtmlAsync({
            aslDefinition: poisoned(),
            diagramTitle: `Title ${baitHref}`,
            showIcons,
        });
        expect(hits).toBe(0);
        expect(html).not.toContain(secretBase64);
    });

    it('png with showIcons', async () => {
        await exportPng({ aslDefinition: poisoned(), diagramTitle: `Title ${baitHref}`, showIcons: true });
        expect(hits).toBe(0);
    });

    it('still embeds the icon the renderer drew for a Lambda task', async () => {
        const iconBytes = new TextEncoder().encode('<svg>lambda</svg>');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(iconBytes, { status: 200 })),
        );
        const { html } = await generateHtmlAsync({
            aslDefinition: {
                StartAt: 'Invoke',
                States: {
                    Invoke: {
                        End: true,
                        Resource: 'arn:aws:states:::lambda:invoke',
                        Type: 'Task',
                    },
                },
            },
            showIcons: true,
        });
        expect(vi.mocked(fetch)).toHaveBeenCalled();
        expect(html).toContain(`data:image/svg+xml;base64,${Buffer.from(iconBytes).toString('base64')}`);
    });
});
