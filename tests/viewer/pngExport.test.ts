import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page, type PuppeteerLifeCycleEvent } from 'puppeteer';
import { generateHtml, generateViewerUpdate } from '../../src';
import { ICON_TIMEOUT_MS } from '../../src/renderers/viewer/controller/rasterize';
import type { AslDefinition } from '../../src/types';

/**
 * The toolbar's PNG button, driven in a real Chromium: the SVG on screen drawn
 * through a canvas, remote icons inlined first, and a ladder of canvas sizes to fall
 * back on. The markup half is in `exportActions.test.ts`.
 */

const definition: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Next: 'Beta' },
        Beta: { Type: 'Pass', Next: 'Omega' },
        Omega: { Type: 'Succeed' },
    },
};

/** A solid red stand-in for every CDN icon, so a drawn icon is unmistakable. */
const RED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff0000"/></svg>';

/** The same, twice as wide as it is tall. */
const WIDE_RED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#ff0000"/></svg>';

/** Square but sized only by its viewBox, like the real aws-icons files. */
const VIEWBOX_RED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ff0000"/></svg>';

type IconMode = 'abort' | 'red' | 'stall' | 'viewBox' | 'wide';

interface PngStore {
    sfnPngs: Array<{ blob: Blob; name: string }>;
}

interface OpenViewerParams {
    html: string;
    /** How to answer requests to the icon CDN; omit to leave them alone. */
    icons?: IconMode;
    waitUntil?: PuppeteerLifeCycleEvent;
}

let browser: Browser;

beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
});

/** Route requests to the icon CDN: a red icon with CORS, a failure, or no answer at all. */
async function interceptIcons(target: Page, mode: IconMode): Promise<void> {
    await target.setRequestInterception(true);
    target.on('request', (request) => {
        if (!request.url().startsWith('https://cdn.jsdelivr.net/')) {
            void request.continue();
            return;
        }
        if (mode === 'abort') {
            void request.abort();
            return;
        }
        // 'stall': never answered, so the icon load neither succeeds nor fails.
        if (mode === 'stall') return;
        void request.respond({
            body: { red: RED_ICON, viewBox: VIEWBOX_RED_ICON, wide: WIDE_RED_ICON }[mode],
            contentType: 'image/svg+xml',
            headers: { 'Access-Control-Allow-Origin': '*' },
            status: 200,
        });
    });
}

/** Capture `<a download>` Blobs in page instead of letting Chromium write them to disk. */
async function captureDownloads(target: Page): Promise<void> {
    await target.evaluate(() => {
        const store = window as unknown as PngStore;
        store.sfnPngs = [];
        const realCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob: Blob) => {
            store.sfnPngs.push({ blob, name: '' });
            return realCreate(blob);
        };
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
            if (this.download) {
                store.sfnPngs[store.sfnPngs.length - 1].name = this.download;
                return;
            }
            realClick.call(this);
        };
    });
}

async function openViewer(params: OpenViewerParams): Promise<Page> {
    const { html, icons, waitUntil = 'load' } = params;
    const target = await browser.newPage();
    await target.setViewport({ width: 1280, height: 800 });
    if (icons) await interceptIcons(target, icons);
    await target.setContent(html, { waitUntil });
    await target.waitForSelector('[data-sfn="export-png"]');
    await captureDownloads(target);
    return target;
}

/** Click the PNG button without moving the mouse, which could pan the stage. */
const clickPng = (target: Page): Promise<void> =>
    target.evaluate(() => {
        (document.querySelector('[data-sfn="export-png"]') as HTMLElement).click();
    });

const downloadCount = (target: Page): Promise<number> =>
    target.evaluate(() => (window as unknown as PngStore).sfnPngs.filter((entry) => entry.name).length);

const waitForDownload = (target: Page, timeout = 5_000): Promise<unknown> =>
    target.waitForFunction(
        () => (window as unknown as PngStore).sfnPngs.some((entry) => entry.name),
        { polling: 20, timeout },
    );

const buttonLabel = (target: Page): Promise<string | null> =>
    target.$eval('[data-sfn="export-png"]', (element) => element.textContent);

/** The centre of `selector`'s box in the live SVG's own pixel space. */
const svgCentre = (target: Page, selector: string): Promise<{ x: number; y: number }> =>
    target.evaluate((query) => {
        const element = document.querySelector(query) as SVGGraphicsElement;
        const box = element.getBBox();
        const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
            element.getCTM()!,
        );
        return { x: point.x, y: point.y };
    }, selector);

interface PngReading {
    height: number;
    name: string;
    pixels: number[][];
    type: string;
    width: number;
}

/**
 * Decode the last downloaded PNG and read the pixels at `points`, given in the live
 * SVG's pixel space and scaled to the PNG.
 */
const readPng = (target: Page, points: Array<{ x: number; y: number }> = []): Promise<PngReading> =>
    target.evaluate(async (wanted) => {
        const entries = (window as unknown as PngStore).sfnPngs.filter((entry) => entry.name);
        const { blob, name } = entries[entries.length - 1];
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);

        const svg = document.querySelector('[data-sfn="content"] svg')!;
        const ratio = bitmap.width / parseFloat(svg.getAttribute('width')!);
        const pixels = wanted.map((point) =>
            Array.from(context.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data),
        );
        return { height: bitmap.height, name, pixels, type: blob.type, width: bitmap.width };
    }, points);

/** The live SVG's own `width`/`height` attributes. */
const svgSize = (target: Page): Promise<{ height: number; width: number }> =>
    target.$eval('[data-sfn="content"] svg', (svg) => ({
        height: parseFloat(svg.getAttribute('height')!),
        width: parseFloat(svg.getAttribute('width')!),
    }));

/** `#rrggbb` as the `[r, g, b, 255]` a canvas reads back. */
function rgba(hex: string): number[] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

describe('toolbar PNG export', () => {
    it("downloads diagram.png at twice the diagram's size", async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await clickPng(target);
        await waitForDownload(target);

        const size = await svgSize(target);
        const png = await readPng(target);
        expect(png.name).toBe('diagram.png');
        expect(png.type).toBe('image/png');
        expect(png.width).toBe(Math.floor(size.width * 2));
        expect(png.height).toBe(Math.floor(size.height * 2));
        await target.close();
    }, 20_000);

    it('draws the diagram rather than a blank image', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await clickPng(target);
        await waitForDownload(target);

        const node = await svgCentre(target, '[data-state-id="Alpha"] rect');
        const png = await readPng(target, [node, { x: 1, y: 1 }]);
        expect(png.pixels[0]).not.toEqual(png.pixels[1]);
        await target.close();
    }, 20_000);

    it('leaves search dimming out of the rasterised markup', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await target.evaluate(() => {
            const real = XMLSerializer.prototype.serializeToString;
            XMLSerializer.prototype.serializeToString = function captured(this: XMLSerializer, node: Node) {
                const markup = real.call(this, node);
                (window as unknown as { sfnLastRasterMarkup?: string }).sfnLastRasterMarkup = markup;
                return markup;
            };
        });
        await target.type('[data-sfn="search"]', 'Beta');
        await target.waitForFunction(
            () => document.querySelector('[data-sfn="search-count"]')!.textContent === '1 / 1',
            { polling: 20, timeout: 5_000 },
        );
        // The live SVG really is dimmed, so the assertion below is not vacuous.
        expect(
            await target.$eval('[data-state-id="Alpha"]', (element) => element.classList.contains('sfn-dim')),
        ).toBe(true);

        await clickPng(target);
        await waitForDownload(target);
        const markup = await target.evaluate(
            () => (window as unknown as { sfnLastRasterMarkup: string }).sfnLastRasterMarkup,
        );
        // Checked on the markup, not the pixels: `.sfn-dim` is styled only by the page's
        // stylesheet, which an SVG loaded as an image never sees.
        expect(markup).toContain('data-state-id="Alpha"');
        expect(markup).not.toContain('sfn-dim');
        expect(markup).not.toContain('sfn-hit');
        await target.close();
    }, 20_000);

    it('draws a remote icon instead of a broken-image glyph', async () => {
        const target = await openViewer({
            html: generateHtml({ aslDefinition: definition, showIcons: true }).html,
            icons: 'red',
        });
        await clickPng(target);
        await waitForDownload(target);

        const icon = await svgCentre(target, '[data-state-id="Alpha"] image');
        const png = await readPng(target, [icon]);
        expect(png.pixels[0]).toEqual([255, 0, 0, 255]);
        expect(await buttonLabel(target)).toBe('PNG');
        await target.close();
    }, 20_000);

    it('saves without an unreachable icon and says so', async () => {
        const target = await openViewer({
            html: generateHtml({ aslDefinition: definition, showIcons: true }).html,
            icons: 'abort',
        });
        await clickPng(target);
        await waitForDownload(target);
        await target.waitForFunction(
            () => document.querySelector('[data-sfn="export-png"]')!.textContent === 'No icons',
            { polling: 20, timeout: 5_000 },
        );

        const icon = await svgCentre(target, '[data-state-id="Alpha"] image');
        const fill = await target.$eval('[data-state-id="Alpha"] rect', (rect) => rect.getAttribute('fill')!);
        const png = await readPng(target, [icon]);
        // The node's own fill shows through where the icon was, not a broken glyph.
        expect(png.pixels[0]).toEqual(rgba(fill));
        await target.close();
    }, 20_000);

    it('steps down to a smaller canvas when the first is unusable', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await target.evaluate(() => {
            const store = window as unknown as { sfnToBlobCalls: number };
            store.sfnToBlobCalls = 0;
            const real = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function patched(
                this: HTMLCanvasElement,
                callback: BlobCallback,
                ...rest: unknown[]
            ) {
                store.sfnToBlobCalls += 1;
                if (store.sfnToBlobCalls === 1) {
                    callback(null);
                    return;
                }
                real.call(this, callback, ...(rest as [string?, number?]));
            };
        });
        await clickPng(target);
        await waitForDownload(target);

        expect(await target.evaluate(() => (window as unknown as { sfnToBlobCalls: number }).sfnToBlobCalls)).toBe(
            2,
        );
        expect((await readPng(target)).type).toBe('image/png');
        await target.close();
    }, 20_000);

    it('says Failed when no canvas works', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await target.evaluate(() => {
            HTMLCanvasElement.prototype.toBlob = function patched(callback: BlobCallback) {
                callback(null);
            };
        });
        await clickPng(target);
        await target.waitForFunction(
            () => document.querySelector('[data-sfn="export-png"]')!.textContent === 'Failed',
            { polling: 20, timeout: 5_000 },
        );
        expect(await downloadCount(target)).toBe(0);
        await target.close();
    }, 20_000);

    it('ignores a second click while the first is in flight', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await target.evaluate(() => {
            const button = document.querySelector('[data-sfn="export-png"]') as HTMLButtonElement;
            button.click();
            button.click();
        });
        await waitForDownload(target);
        // Long enough for a second rasterisation of this small diagram to have landed.
        await target.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
        expect(await downloadCount(target)).toBe(1);
        await target.close();
    }, 20_000);

    it('exports the swapped-in diagram after sfn-set-content', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        const bigger: AslDefinition = {
            StartAt: 'One',
            States: {
                One: { Type: 'Pass', Next: 'Two' },
                Two: { Type: 'Pass', Next: 'Three' },
                Three: { Type: 'Pass', Next: 'Four' },
                Four: { Type: 'Pass', Next: 'Five' },
                Five: { Type: 'Succeed' },
            },
        };
        const before = await svgSize(target);
        const update = generateViewerUpdate({ aslDefinition: bigger });
        await target.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);
        await target.waitForSelector('[data-state-id="Five"]');

        const after = await svgSize(target);
        expect(after.height).not.toBe(before.height);
        await clickPng(target);
        await waitForDownload(target);
        const png = await readPng(target);
        expect(png.width).toBe(Math.floor(after.width * 2));
        expect(png.height).toBe(Math.floor(after.height * 2));
        await target.close();
    }, 20_000);

    it('treats a stalled icon as unreachable', async () => {
        // The stalled request also holds the page's own <image>, so `load` never fires;
        // the controller is an inline script and does not wait for it.
        const target = await openViewer({
            html: generateHtml({ aslDefinition: definition, showIcons: true }).html,
            icons: 'stall',
            waitUntil: 'domcontentloaded',
        });
        await clickPng(target);
        await target.waitForFunction(
            () =>
                (window as unknown as PngStore).sfnPngs.some((entry) => entry.name) &&
                document.querySelector('[data-sfn="export-png"]')!.textContent === 'No icons',
            { polling: 20, timeout: ICON_TIMEOUT_MS + 2_000 },
        );
        // Free for another export once this one is over.
        expect(await target.$eval('[data-sfn="export-png"]', (button) => button.getAttribute('aria-disabled'))).toBe(
            null,
        );
        await target.close();
    }, 20_000);

    it('keeps keyboard focus on the button while it works', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        await target.focus('[data-sfn="export-png"]');
        await target.keyboard.press('Enter');
        await waitForDownload(target);
        expect(await target.evaluate(() => document.activeElement?.getAttribute('data-sfn'))).toBe('export-png');
        await target.close();
    }, 20_000);

    it('keeps a non-square icon at its own aspect ratio', async () => {
        // 64x32: on screen the square <image> box letterboxes it; stretched to fill the
        // box, it would come out red top to bottom.
        const target = await openViewer({
            html: generateHtml({ aslDefinition: definition, showIcons: true }).html,
            icons: 'wide',
        });
        await clickPng(target);
        await waitForDownload(target);

        const icon = await svgCentre(target, '[data-state-id="Alpha"] image');
        const box = await target.$eval('[data-state-id="Alpha"] image', (image) =>
            parseFloat(image.getAttribute('height')!),
        );
        const png = await readPng(target, [icon, { x: icon.x, y: icon.y - box * 0.4 }]);
        expect(png.pixels[0]).toEqual([255, 0, 0, 255]);
        expect(png.pixels[1]).not.toEqual([255, 0, 0, 255]);
        await target.close();
    }, 20_000);

    it('fills the box with a square icon that has only a viewBox', async () => {
        // The real aws-icons files declare no width or height, and an <img> may report
        // a 300x150 default size for them - an aspect ratio the icon does not have.
        const target = await openViewer({
            html: generateHtml({ aslDefinition: definition, showIcons: true }).html,
            icons: 'viewBox',
        });
        await clickPng(target);
        await waitForDownload(target);

        const icon = await svgCentre(target, '[data-state-id="Alpha"] image');
        const box = await target.$eval('[data-state-id="Alpha"] image', (image) =>
            parseFloat(image.getAttribute('height')!),
        );
        const png = await readPng(target, [icon, { x: icon.x, y: icon.y - box * 0.4 }]);
        expect(png.pixels[0]).toEqual([255, 0, 0, 255]);
        expect(png.pixels[1]).toEqual([255, 0, 0, 255]);
        await target.close();
    }, 20_000);

    it('sizes the PNG from the viewBox when width and height are not pixel lengths', async () => {
        const target = await openViewer({ html: generateHtml({ aslDefinition: definition }).html });
        const viewBox = await target.$eval('[data-sfn="content"] svg', (svg) => {
            const [, , width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            return { height, width };
        });
        await clickPng(target);
        await waitForDownload(target);

        const png = await target.evaluate(async () => {
            const entries = (window as unknown as PngStore).sfnPngs.filter((entry) => entry.name);
            const bitmap = await createImageBitmap(entries[entries.length - 1].blob);
            return { height: bitmap.height, width: bitmap.width };
        });
        expect(png).toEqual({ height: Math.floor(viewBox.height * 2), width: Math.floor(viewBox.width * 2) });
        await target.close();
    }, 20_000);

    it("follows the page's colour scheme with the auto theme", async () => {
        const backgroundIn = async (scheme: 'dark' | 'light'): Promise<number[]> => {
            const target = await browser.newPage();
            await target.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
            await target.setContent(generateHtml({ aslDefinition: definition, theme: 'auto' }).html, {
                waitUntil: 'load',
            });
            await captureDownloads(target);
            await clickPng(target);
            await waitForDownload(target);
            const png = await readPng(target, [{ x: 1, y: 1 }]);
            await target.close();
            return png.pixels[0];
        };

        const light = await backgroundIn('light');
        const dark = await backgroundIn('dark');
        expect(light).not.toEqual(dark);
        expect(dark[0] + dark[1] + dark[2]).toBeLessThan(light[0] + light[1] + light[2]);
    }, 20_000);

    it('downloads for real from a sandboxed iframe', async () => {
        // A smoke test of the whole async path in an opaque-origin frame, the React
        // wrapper's context. It says nothing about user-activation timing: headless
        // Chromium lets a sandboxed download through even with no gesture at all.
        const downloadPath = mkdtempSync(join(tmpdir(), 'sfn-png-'));
        const target = await browser.newPage();
        try {
            await target.setViewport({ width: 1280, height: 800 });
            await interceptIcons(target, 'red');
            const session = await target.createCDPSession();
            await session.send('Browser.setDownloadBehavior', {
                behavior: 'allowAndName',
                downloadPath,
                eventsEnabled: true,
            });

            const { html } = generateHtml({ aslDefinition: definition, showIcons: true });
            const srcdoc = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            await target.setContent(
                `<iframe sandbox="allow-downloads allow-scripts" style="width:1280px;height:800px;border:0" srcdoc="${srcdoc}"></iframe>`,
                { waitUntil: 'load' },
            );
            const frame = target.frames().find((candidate) => candidate !== target.mainFrame())!;
            await frame.waitForSelector('[data-sfn="export-png"]');

            const began = new Promise<{ guid: string; suggestedFilename: string }>((resolve) => {
                session.on('Browser.downloadWillBegin', (event) => resolve(event));
            });
            const completed = new Promise<string>((resolve) => {
                session.on('Browser.downloadProgress', (event) => {
                    if (event.state === 'completed') resolve(event.guid);
                });
            });
            await frame.click('[data-sfn="export-png"]');

            const { guid, suggestedFilename } = await began;
            expect(suggestedFilename).toBe('diagram.png');
            expect(await completed).toBe(guid);
            const signature = readFileSync(join(downloadPath, guid)).subarray(0, 4);
            expect(Array.from(signature)).toEqual([0x89, 0x50, 0x4e, 0x47]);
        } finally {
            await target.close();
            rmSync(downloadPath, { force: true, recursive: true });
        }
    }, 20_000);
});
