import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { generateHtml } from '../../src';
import type { AslDefinition } from '../../src/types';

/**
 * Runtime tests for the inline viewer controller.
 *
 * The markup assertions in `tests/HtmlViewer.test.ts` cannot catch behavioural
 * bugs in the embedded script — the click-to-open panel once broke because
 * `setPointerCapture` retargets `pointerup` to the stage, which no string check
 * would have noticed. These drive the real document in Chromium instead.
 */

const definition: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:alpha',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 3 }],
            Next: 'Beta',
        },
        Beta: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage', Next: 'Gamma' },
        Gamma: { Type: 'Succeed' },
    },
};

let browser: Browser;
let page: Page;

/** Centre of a node group in viewport coordinates. */
async function centerOf(stateId: string): Promise<{ x: number; y: number }> {
    return page.evaluate((id) => {
        const element = document.querySelector(`[data-state-id="${id}"]`);
        const rect = element!.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, stateId);
}

async function clickAt(x: number, y: number): Promise<void> {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
}

const isPanelOpen = (): Promise<boolean> =>
    page.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'));

beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
});

beforeAll(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const { html } = generateHtml({ aslDefinition: definition });
    await page.setContent(html, { waitUntil: 'load' });
}, 60_000);

describe('interactive viewer runtime', () => {
    it('loads and fits without script errors', async () => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));

        const zoom = await page.$eval('#sfn-zoom-label', (element) => element.textContent);
        const transform = await page.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );

        expect(errors).toEqual([]);
        expect(zoom).toMatch(/^\d+%$/);
        // fit() ran, so a scale was applied rather than left at the initial identity.
        expect(transform).toContain('scale(');
    });

    it('filters and counts matches as you search', async () => {
        await page.focus('#sfn-search');
        await page.type('#sfn-search', 'alpha');

        expect(await page.$eval('#sfn-search-count', (element) => element.textContent)).toBe(
            '1 / 1',
        );
        expect(await page.$$eval('.sfn-hit', (elements) => elements.length)).toBe(1);
        expect(
            await page.$eval('.sfn-hit', (element) => element.getAttribute('data-state-id')),
        ).toBe('Alpha');
        // The two non-matching states are dimmed.
        expect(await page.$$eval('.sfn-dim', (elements) => elements.length)).toBe(2);
    });

    it('clears the search on Escape', async () => {
        await page.keyboard.press('Escape');

        expect(await page.$$eval('.sfn-dim', (elements) => elements.length)).toBe(0);
        expect(await page.$eval('#sfn-search-count', (element) => element.textContent)).toBe('');
        expect(await page.$eval('#sfn-search', (element) => element.value)).toBe('');
    });

    it('focuses the search box on "/"', async () => {
        await page.keyboard.press('Slash');

        expect(await page.evaluate(() => document.activeElement?.id)).toBe('sfn-search');
        // The shortcut must not type the slash into the field.
        expect(await page.$eval('#sfn-search', (element) => element.value)).toBe('');
        await page.keyboard.press('Escape');
    });

    it('opens the detail panel for the clicked state', async () => {
        const target = await centerOf('Alpha');
        await clickAt(target.x, target.y);

        expect(await isPanelOpen()).toBe(true);
        expect(await page.$eval('#sfn-panel-title', (element) => element.textContent)).toBe(
            'Alpha',
        );
        expect(await page.$$eval('.sfn-field dt', (els) => els.map((el) => el.textContent))).toEqual(
            ['Type', 'Resource', 'Next', 'Retry'],
        );
        expect(
            await page.$eval('#sfn-panel-json', (element) =>
                element.textContent?.includes('arn:aws:lambda'),
            ),
        ).toBe(true);
    });

    it('closes the panel when the empty stage is clicked', async () => {
        await clickAt(60, 750);
        expect(await isPanelOpen()).toBe(false);
    });

    it('pans on drag without opening the panel', async () => {
        const before = await page.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );
        const target = await centerOf('Beta');

        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await page.mouse.move(target.x + 120, target.y + 60, { steps: 12 });
        await page.mouse.up();

        const after = await page.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );

        expect(after).not.toBe(before);
        expect(await isPanelOpen()).toBe(false);
    });

    it('still opens the panel on a click after a drag', async () => {
        const target = await centerOf('Beta');
        await clickAt(target.x, target.y);

        expect(await isPanelOpen()).toBe(true);
        expect(await page.$eval('#sfn-panel-title', (element) => element.textContent)).toBe('Beta');
    });

    it('closes the panel on Escape', async () => {
        await page.keyboard.press('Escape');
        expect(await isPanelOpen()).toBe(false);
    });
});
