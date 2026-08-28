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

async function isMinimapCollapsed(): Promise<boolean> {
    return page.$eval('#sfn-minimap', (element) => element.classList.contains('sfn-minimap-collapsed'));
}

async function rectOf(
    selector: string,
): Promise<{ height: number; width: number; x: number; y: number }> {
    return page.$eval(selector, (element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    });
}

describe('minimap', () => {
    // This fixture has 3 states, well under the auto-visible threshold, so the
    // markup assertion in tests/HtmlViewer.test.ts (not runtime) covers the
    // collapsed-by-default class; this confirms it reads the same way at runtime.
    it('starts collapsed for a small diagram', async () => {
        expect(await isMinimapCollapsed()).toBe(true);
    });

    it('opens via the toolbar toggle, with text stripped from the thumbnail', async () => {
        await page.click('[data-sfn-minimap-toggle]');

        expect(await isMinimapCollapsed()).toBe(false);
        expect(
            await page.$eval('#sfn-minimap-thumb', (element) => !!element.querySelector('svg')),
        ).toBe(true);
        // Labels are illegible at thumbnail size — stripped rather than rendered.
        expect(await page.$$eval('#sfn-minimap-thumb text', (elements) => elements.length)).toBe(0);
    });

    it('clones the SVG without duplicating ids', async () => {
        // The fixture's Alpha->Beta edge uses the retry marker, so its <defs> id
        // would collide with the main diagram's if the clone kept it uncloned.
        const duplicates = await page.evaluate(() => {
            const counts = new Map<string, number>();
            document.querySelectorAll('[id]').forEach((element) => {
                counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
            });
            return Array.from(counts.entries()).filter(([, count]) => count > 1);
        });
        expect(duplicates).toEqual([]);
        // The original diagram's own marker-end references must still resolve.
        expect(
            await page.$eval('.edges path', (element) => element.getAttribute('marker-end')),
        ).toMatch(/^url\(#arrowhead-/);
    });

    it('tracks the viewport rectangle across a pan', async () => {
        const before = await rectOf('#sfn-minimap-viewport');
        const target = await centerOf('Beta');

        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await page.mouse.move(target.x - 100, target.y - 60, { steps: 10 });
        await page.mouse.up();

        expect(await rectOf('#sfn-minimap-viewport')).not.toEqual(before);
    });

    it('jumps the stage when the minimap thumbnail is clicked, without opening the panel', async () => {
        const before = await page.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );
        const thumb = await rectOf('#sfn-minimap-thumb');

        await clickAt(thumb.x + 5, thumb.y + 5);

        const after = await page.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );
        expect(after).not.toBe(before);
        // The minimap is a DOM descendant of the stage, so a click here also
        // reaches the stage's own click handler unless stopPropagation held.
        expect(await isPanelOpen()).toBe(false);
    });

    it('toggles via the "m" keyboard shortcut', async () => {
        await page.keyboard.press('KeyM');
        expect(await isMinimapCollapsed()).toBe(true);

        await page.keyboard.press('KeyM');
        expect(await isMinimapCollapsed()).toBe(false);
    });
});

describe('minimap on a large diagram', () => {
    let largePage: Page;

    beforeAll(async () => {
        const states: AslDefinition['States'] = {};
        for (let index = 0; index < 30; index++) {
            const isLast = index === 29;
            states[`Step${index}`] = {
                Type: 'Task',
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:worker',
                Next: isLast ? 'Done' : `Step${index + 1}`,
            };
        }
        states.Done = { Type: 'Succeed' };

        const { html } = generateHtml({ aslDefinition: { StartAt: 'Step0', States: states } });
        largePage = await browser.newPage();
        await largePage.setViewport({ width: 1280, height: 800 });
        await largePage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await largePage?.close();
    });

    it('starts open once the diagram is large enough to need it', async () => {
        expect(
            await largePage.$eval('#sfn-minimap', (element) =>
                element.classList.contains('sfn-minimap-collapsed'),
            ),
        ).toBe(false);
    });
});
