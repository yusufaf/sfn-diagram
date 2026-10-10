import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer';
import { generateHtml, generateViewerUpdate } from '../../src';
import type { ViewerUpdate } from '../../src';
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

/** Centre of a node group in viewport coordinates, on any page. */
async function centerOfOn(target: Page, stateId: string): Promise<{ x: number; y: number }> {
    return target.evaluate((id) => {
        const element = document.querySelector(`[data-state-id="${id}"]`);
        const rect = element!.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, stateId);
}

/**
 * A point that actually lies on an edge's stroke, in viewport coordinates.
 *
 * The bounding-box centre of a curved path can sit well off the path itself, so this
 * walks the geometry instead and maps the result through the element's screen matrix.
 */
async function pointOnEdge(edgeId: string): Promise<{ x: number; y: number }> {
    return page.evaluate((id) => {
        const path = Array.from(document.querySelectorAll('[data-edge-id]')).find(
            (element) => element.getAttribute('data-edge-id') === id,
        ) as SVGPathElement;
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const matrix = path.getScreenCTM()!;
        return {
            x: point.x * matrix.a + point.y * matrix.c + matrix.e,
            y: point.x * matrix.b + point.y * matrix.d + matrix.f,
        };
    }, edgeId);
}

async function clickAt(x: number, y: number): Promise<void> {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
}

const isPanelOpen = (): Promise<boolean> =>
    page.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'));

/** Parameters for {@link typeSearch}. */
interface TypeSearchParams {
    /** The hit count the finished search must report, e.g. `'1 / 1'`. */
    expectedCount: string;
    /** Page holding the viewer to type into. */
    target: Page;
    /** Text to type into the search box. */
    text: string;
}

/**
 * Type into the search box and wait for the debounced search pass for the whole
 * query to land.
 *
 * Waiting for a non-empty count would not be enough: a slow enough gap between two
 * keystrokes lets an intermediate prefix's pass run, and its count (for a different
 * query) would satisfy the wait. The final query's own count is the only signal that
 * cannot be produced early.
 *
 * @param params - Typing parameters
 */
async function typeSearch(params: TypeSearchParams): Promise<void> {
    const { expectedCount, target, text } = params;
    await target.type('#sfn-search', text);
    await target.waitForFunction(
        (count) => document.querySelector('#sfn-search-count')!.textContent === count,
        { polling: 20, timeout: 5_000 },
        expectedCount,
    );
}

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
        await typeSearch({ expectedCount: '1 / 1', target: page, text: 'alpha' });

        expect(await page.$eval('#sfn-search-count', (element) => element.textContent)).toBe(
            '1 / 1',
        );
        expect(await page.$$eval('.sfn-hit', (elements) => elements.length)).toBe(1);
        expect(
            await page.$eval('.sfn-hit', (element) => element.getAttribute('data-state-id')),
        ).toBe('Alpha');
        // The two non-matching states are dimmed.
        expect(await page.$$eval('.sfn-dim', (elements) => elements.length)).toBe(2);
        // The outline lands on the drawn shape, not on the (invisible) <title> that
        // now precedes it as the group's first child. `outlineWidth` alone isn't a
        // reliable signal here - Chromium reports a nonzero initial value for it even
        // when `outline-style` is `none` (unset) - so assert on the style instead.
        expect(
            await page.$eval('.sfn-hit rect', (element) => getComputedStyle(element).outlineStyle),
        ).toBe('solid');
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

    it('opens the detail panel for the clicked edge', async () => {
        const target = await pointOnEdge('Alpha->Beta#normal#0');
        await clickAt(target.x, target.y);

        expect(await isPanelOpen()).toBe(true);
        // The title is the `edgeOverrides` key, verbatim and copy-pasteable.
        expect(await page.$eval('#sfn-panel-title', (element) => element.textContent)).toBe(
            'Alpha->Beta#normal#0',
        );
        expect(await page.$$eval('.sfn-field dt', (els) => els.map((el) => el.textContent))).toEqual(
            ['From', 'To', 'Type'],
        );
    });

    it('highlights the clicked edge and both its endpoints', async () => {
        const target = await pointOnEdge('Alpha->Beta#normal#0');
        await clickAt(target.x, target.y);

        // Both the drawn path and its hit-area twin carry the class; the CSS rule
        // paints only the drawn one.
        expect(await page.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(2);
        expect(
            await page.$$eval('.sfn-edge-endpoint', (elements) =>
                elements.map((element) => element.getAttribute('data-state-id')),
            ),
        ).toEqual(['Alpha', 'Beta']);
    });

    it('clears the edge highlight when the panel is closed', async () => {
        const target = await pointOnEdge('Alpha->Beta#normal#0');
        await clickAt(target.x, target.y);
        expect(await page.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(2);

        await page.keyboard.press('Escape');

        expect(await isPanelOpen()).toBe(false);
        expect(await page.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(0);
        expect(await page.$$eval('.sfn-edge-endpoint', (elements) => elements.length)).toBe(0);
    });

    it('prefers the node when a click lands on both a node and an edge', async () => {
        const target = await centerOf('Beta');
        await clickAt(target.x, target.y);

        expect(await page.$eval('#sfn-panel-title', (element) => element.textContent)).toBe('Beta');
        expect(await page.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(0);

        // This page is shared with the tests below, which assume a closed panel.
        await page.keyboard.press('Escape');
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

    it('zooms on wheel straight away - the standalone document has no page scroll to protect', async () => {
        const result = await page.evaluate(() => {
            const stage = document.querySelector('#sfn-stage') as HTMLElement;
            const content = document.querySelector('#sfn-content') as HTMLElement;
            const before = content.style.transform;
            const notCancelled = stage.dispatchEvent(
                new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -50 }),
            );
            return {
                after: content.style.transform,
                before,
                notCancelled,
                touchAction: getComputedStyle(stage).touchAction,
            };
        });

        expect(result.after).not.toBe(result.before);
        expect(result.notCancelled).toBe(false);
        // The browser's own scroll/pinch gestures must not race the pointer-based pan.
        expect(result.touchAction).toBe('none');

        // Later tests on this shared page drag from node positions computed at fit scale.
        await page.click('[data-sfn-zoom="fit"]');
    });

    it('closes the panel on Escape', async () => {
        await page.keyboard.press('Escape');
        expect(await isPanelOpen()).toBe(false);
    });

    it('shows a visible focus ring on a keyboard-focused toolbar button', async () => {
        await page.focus('#sfn-search');
        await page.keyboard.press('Tab');

        expect(
            await page.evaluate(() =>
                document.activeElement?.hasAttribute('data-sfn-minimap-toggle'),
            ),
        ).toBe(true);
        expect(
            await page.evaluate(
                () => getComputedStyle(document.activeElement as Element).outlineStyle,
            ),
        ).toBe('solid');
    });
});

async function isMinimapCollapsed(): Promise<boolean> {
    return page.$eval('#sfn-minimap', (element) => element.classList.contains('sfn-minimap-collapsed'));
}

async function minimapToggleAriaPressed(): Promise<string | null> {
    return page.$eval('[data-sfn-minimap-toggle]', (element) => element.getAttribute('aria-pressed'));
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
        expect(await minimapToggleAriaPressed()).toBe('true');
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
        // The original diagram's own marker-end references must still resolve. Scoped
        // past the hit-area copy, which is deliberately unpainted and carries no marker.
        expect(
            await page.$eval('.edges path:not([data-edge-hit-area])', (element) =>
                element.getAttribute('marker-end'),
            ),
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
        expect(await minimapToggleAriaPressed()).toBe('false');

        await page.keyboard.press('KeyM');
        expect(await isMinimapCollapsed()).toBe(false);
        expect(await minimapToggleAriaPressed()).toBe('true');
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

describe('collapse toggle runtime', () => {
    let collapsePage: Page;

    const parallelDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                    { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        collapsePage = await browser.newPage();
        await collapsePage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: parallelDefinition });
        await collapsePage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await collapsePage.close();
    });

    const collapseToggleAriaExpanded = (): Promise<string | null> =>
        collapsePage.$eval('[data-sfn-collapse-toggle]', (element) => element.getAttribute('aria-expanded'));
    const hasState = (stateId: string): Promise<boolean> =>
        collapsePage.evaluate((id) => document.querySelector(`[data-state-id="${id}"]`) !== null, stateId);
    const controlAction = (stateId: string): Promise<string | null> =>
        collapsePage.evaluate(
            (id) =>
                document
                    .querySelector(`[data-sfn-collapse-target="${id}"]`)
                    ?.getAttribute('data-sfn-collapse-action') ?? null,
            stateId,
        );

    it('ships one expanded view with a collapse control on the container', async () => {
        const viewWrappers = await collapsePage.$$eval('[data-sfn-view]', (elements) => elements.length);
        expect(viewWrappers).toBe(0);
        expect(await hasState('Branch1')).toBe(true);
        expect(await controlAction('FanOut')).toBe('collapse');
        expect(await collapseToggleAriaExpanded()).toBe('true');
    });

    it('toggling re-renders with the container collapsed and hides the branch states', async () => {
        await collapsePage.click('[data-sfn-collapse-toggle]');

        expect(await hasState('Branch1')).toBe(false);
        expect(await hasState('Branch2')).toBe(false);
        expect(await hasState('FanOut')).toBe(true);
        expect(await controlAction('FanOut')).toBe('expand');
        expect(await collapseToggleAriaExpanded()).toBe('false');

        const buttonLabel = await collapsePage.$eval(
            '[data-sfn-collapse-toggle]',
            (element) => element.textContent,
        );
        expect(buttonLabel).toBe('Expand');
    });

    it('keeps the re-rendered view keyboard-navigable', async () => {
        // The tab stops sat on the elements the relayout replaced; they must be
        // re-applied to the new ones - the edge, the placeholder, and its control.
        const edgeTabIndexes = await collapsePage.$$eval(
            '[data-edge-id="FanOut->Done#normal#0"]',
            (elements) => elements.map((element) => element.getAttribute('tabindex')),
        );
        expect(edgeTabIndexes).toContain('0');
        const placeholderTabIndex = await collapsePage.$eval(
            '[data-state-id="FanOut"]',
            (element) => element.getAttribute('tabindex'),
        );
        expect(placeholderTabIndex).toBe('0');
        const controlTabIndex = await collapsePage.$eval(
            '[data-sfn-collapse-target="FanOut"]',
            (element) => element.getAttribute('tabindex'),
        );
        expect(controlTabIndex).toBe('0');
    });

    it('search after toggling only matches states in the now-visible view', async () => {
        await collapsePage.focus('#sfn-search');
        await typeSearch({ expectedCount: '1 / 1', target: collapsePage, text: 'FanOut' });

        expect(
            await collapsePage.$eval('#sfn-search-count', (element) => element.textContent),
        ).toBe('1 / 1');
        await collapsePage.keyboard.press('Escape');
    });

    it('toggling back restores the expanded view', async () => {
        await collapsePage.click('[data-sfn-collapse-toggle]');
        const buttonLabel = await collapsePage.$eval(
            '[data-sfn-collapse-toggle]',
            (element) => element.textContent,
        );
        expect(buttonLabel).toBe('Collapse');
        expect(await collapseToggleAriaExpanded()).toBe('true');
        expect(await hasState('Branch1')).toBe(true);
        expect(await controlAction('FanOut')).toBe('collapse');
    });
});

describe('per-container collapse runtime', () => {
    let containerPage: Page;

    const twoContainers: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                    { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
                ],
                Next: 'Second',
            },
            Second: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'BranchA', States: { BranchA: { Type: 'Task', Resource: 'arn:a', End: true } } },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        containerPage = await browser.newPage();
        await containerPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: twoContainers });
        await containerPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await containerPage.close();
    });

    const hasState = (stateId: string): Promise<boolean> =>
        containerPage.evaluate((id) => document.querySelector(`[data-state-id="${id}"]`) !== null, stateId);
    const toggleLabel = (): Promise<string | null> =>
        containerPage.$eval('[data-sfn-collapse-toggle]', (element) => element.textContent);
    const panelOpen = (): Promise<boolean> =>
        containerPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'));

    it('collapses just the clicked container from its header control', async () => {
        await containerPage.click('[data-sfn-collapse-target="FanOut"]');

        expect(await hasState('Branch1')).toBe(false);
        expect(await hasState('BranchA')).toBe(true);
        // A partial collapse leaves the toolbar offering to collapse the rest.
        expect(await toggleLabel()).toBe('Collapse');
    });

    it('does not open the detail panel for the container whose control was clicked', async () => {
        expect(await panelOpen()).toBe(false);
    });

    it('expands it again from the placeholder control', async () => {
        await containerPage.click('[data-sfn-collapse-target="FanOut"]');

        expect(await hasState('Branch1')).toBe(true);
        expect(await hasState('BranchA')).toBe(true);
    });

    it('still opens the detail panel when the container itself is clicked', async () => {
        await containerPage.click('[data-state-id="FanOut"] > title + rect');
        expect(await panelOpen()).toBe(true);
        await containerPage.keyboard.press('Escape');
        expect(await panelOpen()).toBe(false);
    });

    it('toggles from the keyboard and keeps focus on the container\'s control', async () => {
        await containerPage.evaluate(() => {
            (document.querySelector('[data-sfn-collapse-target="Second"]') as SVGElement).focus();
        });
        await containerPage.keyboard.press('Enter');

        expect(await hasState('BranchA')).toBe(false);
        expect(await hasState('Branch1')).toBe(true);
        const focused = await containerPage.evaluate(() =>
            document.activeElement?.getAttribute('data-sfn-collapse-target') ?? null,
        );
        expect(focused).toBe('Second');

        await containerPage.keyboard.press('Enter');
        expect(await hasState('BranchA')).toBe(true);
    });

    it('flips the toolbar to Expand once every container is collapsed by hand, and expands all', async () => {
        await containerPage.click('[data-sfn-collapse-target="FanOut"]');
        await containerPage.click('[data-sfn-collapse-target="Second"]');
        expect(await hasState('Branch1')).toBe(false);
        expect(await hasState('BranchA')).toBe(false);
        expect(await toggleLabel()).toBe('Expand');

        await containerPage.click('[data-sfn-collapse-toggle]');
        expect(await hasState('Branch1')).toBe(true);
        expect(await hasState('BranchA')).toBe(true);
        expect(await toggleLabel()).toBe('Collapse');
    });

    it('closes a detail panel whose state was just hidden inside a placeholder', async () => {
        await containerPage.click('[data-state-id="Branch1"] > title + rect');
        expect(await panelOpen()).toBe(true);

        await containerPage.click('[data-sfn-collapse-target="FanOut"]');
        expect(await hasState('Branch1')).toBe(false);
        expect(await panelOpen()).toBe(false);

        await containerPage.click('[data-sfn-collapse-target="FanOut"]');
        expect(await hasState('Branch1')).toBe(true);
    });

    it('keeps a hand-collapsed container collapsed when the toolbar collapses the selection', async () => {
        // A document whose `collapse` selection names only FanOut: the toolbar
        // button must add FanOut to the reader's own collapse, not replace it.
        const selectionPage = await browser.newPage();
        try {
            await selectionPage.setViewport({ width: 1280, height: 800 });
            const { html } = generateHtml({ aslDefinition: twoContainers, collapse: ['FanOut'] });
            await selectionPage.setContent(html, { waitUntil: 'load' });
            const present = (id: string): Promise<boolean> =>
                selectionPage.evaluate((stateId) => document.querySelector(`[data-state-id="${stateId}"]`) !== null, id);

            await selectionPage.click('[data-sfn-collapse-target="Second"]');
            expect(await present('BranchA')).toBe(false);
            await selectionPage.click('[data-sfn-collapse-toggle]');
            expect(await present('Branch1')).toBe(false);
            expect(await present('BranchA')).toBe(false);
            expect(
                await selectionPage.$eval('[data-sfn-collapse-toggle]', (element) => element.textContent),
            ).toBe('Expand');

            await selectionPage.click('[data-sfn-collapse-toggle]');
            expect(await present('Branch1')).toBe(true);
            expect(await present('BranchA')).toBe(true);
        } finally {
            await selectionPage.close();
        }
    });

    it('re-arms per-container collapse from a setContent update rendered with relayout', async () => {
        await containerPage.click('[data-sfn-collapse-target="FanOut"]');
        expect(await hasState('Branch1')).toBe(false);

        const edited: AslDefinition = {
            ...twoContainers,
            States: {
                ...twoContainers.States,
                Done: { Type: 'Pass', End: true },
            },
        };
        const update = generateViewerUpdate({ aslDefinition: edited, relayout: true });
        expect(update.relayoutModel).toBeDefined();
        await containerPage.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);

        // The reader's own collapse survives the edit, and the controls still work.
        expect(await hasState('Branch1')).toBe(false);
        expect(await hasState('BranchA')).toBe(true);
        expect(await hasState('Done')).toBe(true);
        await containerPage.click('[data-sfn-collapse-target="Second"]');
        expect(await hasState('BranchA')).toBe(false);
        expect(await toggleLabel()).toBe('Expand');
        await containerPage.click('[data-sfn-collapse-toggle]');
        expect(await hasState('Branch1')).toBe(true);
        expect(await hasState('BranchA')).toBe(true);
    });

    it('strips inert controls from a relayout update in a document that never shipped the bundle', async () => {
        const plainPage = await browser.newPage();
        try {
            await plainPage.setViewport({ width: 1280, height: 800 });
            const flat: AslDefinition = { StartAt: 'Solo', States: { Solo: { Type: 'Succeed' } } };
            const { html } = generateHtml({ aslDefinition: flat });
            expect(html).not.toContain('sfnRelayout');
            await plainPage.setContent(html, { waitUntil: 'load' });

            const update = generateViewerUpdate({ aslDefinition: twoContainers, relayout: true });
            await plainPage.evaluate((detail) => {
                document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
            }, update as unknown as Record<string, unknown>);

            expect(await plainPage.$$eval('[data-sfn-collapse-target]', (elements) => elements.length)).toBe(0);
            // A containerless document has no toggle to begin with, and gets none.
            expect(await plainPage.$$eval('[data-sfn-collapse-toggle]', (elements) => elements.length)).toBe(0);
        } finally {
            await plainPage.close();
        }
    });
});

describe('minimap auto-visibility across the collapse toggle', () => {
    let togglePage: Page;

    // Enough branches that the expanded view is well above the auto-visible
    // threshold (25 nodes), while the collapsed view (FanOut placeholder + Done)
    // is well under it — so the two views disagree on the minimap's default state.
    const manyBranchesDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: Array.from({ length: 15 }, (_unused, index) => ({
                    StartAt: `Branch${index}`,
                    States: {
                        [`Branch${index}`]: { Type: 'Task', Resource: `arn:b${index}`, End: true },
                    },
                })),
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        togglePage = await browser.newPage();
        await togglePage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: manyBranchesDefinition });
        await togglePage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await togglePage.close();
    });

    const minimapCollapsed = (): Promise<boolean> =>
        togglePage.$eval('#sfn-minimap', (element) => element.classList.contains('sfn-minimap-collapsed'));
    const minimapToggleAriaPressed = (): Promise<string | null> =>
        togglePage.$eval('[data-sfn-minimap-toggle]', (element) => element.getAttribute('aria-pressed'));

    it('starts open for the large expanded view', async () => {
        expect(await minimapCollapsed()).toBe(false);
        expect(await minimapToggleAriaPressed()).toBe('true');
    });

    it('auto-hides on switching to the small collapsed view, and reopens switching back', async () => {
        await togglePage.click('[data-sfn-collapse-toggle]');
        expect(await minimapCollapsed()).toBe(true);
        expect(await minimapToggleAriaPressed()).toBe('false');

        await togglePage.click('[data-sfn-collapse-toggle]');
        expect(await minimapCollapsed()).toBe(false);
        expect(await minimapToggleAriaPressed()).toBe('true');
    });

    it('leaves a manually-opened minimap open even on a later switch that would normally auto-hide it', async () => {
        await togglePage.click('[data-sfn-collapse-toggle]'); // -> collapsed view, minimap auto-hidden
        expect(await minimapCollapsed()).toBe(true);

        await togglePage.click('[data-sfn-minimap-toggle]'); // manual override: force it open
        expect(await minimapCollapsed()).toBe(false);

        await togglePage.click('[data-sfn-collapse-toggle]'); // -> expanded view (auto rule: open anyway)
        await togglePage.click('[data-sfn-collapse-toggle]'); // -> collapsed view again (auto rule wants hidden)
        expect(await minimapCollapsed()).toBe(false); // the user's manual choice still wins
    });
});

describe('minimap auto-visibility across a setContent update', () => {
    let setContentPage: Page;

    const smallParallelDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch0', States: { Branch0: { Type: 'Task', Resource: 'arn:b0', End: true } } },
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    const manyBranchesDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: Array.from({ length: 15 }, (_unused, index) => ({
                    StartAt: `Branch${index}`,
                    States: {
                        [`Branch${index}`]: { Type: 'Task', Resource: `arn:b${index}`, End: true },
                    },
                })),
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        setContentPage = await browser.newPage();
        await setContentPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: smallParallelDefinition });
        await setContentPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await setContentPage.close();
    });

    const minimapCollapsed = (): Promise<boolean> =>
        setContentPage.$eval('#sfn-minimap', (element) => element.classList.contains('sfn-minimap-collapsed'));

    it('auto-shows the minimap when an update grows the active (expanded) view past the threshold', async () => {
        expect(await minimapCollapsed()).toBe(true);

        await setContentPage.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, generateViewerUpdate({ aslDefinition: manyBranchesDefinition }) as unknown as Record<string, unknown>);

        expect(await minimapCollapsed()).toBe(false);
    });
});

describe('edge detail panel on a Choice diagram', () => {
    let choicePage: Page;

    const choiceDefinition: AslDefinition = {
        StartAt: 'Route',
        States: {
            Route: {
                Type: 'Choice',
                Choices: [{ Variable: '$.kind', StringEquals: 'work', Next: 'Work' }],
                Default: 'Skip',
            },
            Work: { Type: 'Succeed' },
            Skip: { Type: 'Succeed' },
        },
    };

    /** Midpoint of an edge's stroke on this page, in viewport coordinates. */
    async function pointOnChoiceEdge(edgeId: string): Promise<{ x: number; y: number }> {
        return choicePage.evaluate((id) => {
            const path = Array.from(document.querySelectorAll('path[data-edge-id]')).find(
                (element) => element.getAttribute('data-edge-id') === id,
            ) as SVGPathElement;
            const point = path.getPointAtLength(path.getTotalLength() / 2);
            const matrix = path.getScreenCTM()!;
            return {
                x: point.x * matrix.a + point.y * matrix.c + matrix.e,
                y: point.x * matrix.b + point.y * matrix.d + matrix.f,
            };
        }, edgeId);
    }

    beforeAll(async () => {
        choicePage = await browser.newPage();
        await choicePage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: choiceDefinition });
        await choicePage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await choicePage.close();
    });

    it('shows the condition that produced a choice edge', async () => {
        const target = await pointOnChoiceEdge('Route->Work#choice#0');
        await choicePage.mouse.move(target.x, target.y);
        await choicePage.mouse.down();
        await choicePage.mouse.up();

        expect(
            await choicePage.$eval('#sfn-panel-title', (element) => element.textContent),
        ).toBe('Route->Work#choice#0');
        expect(
            await choicePage.$$eval('.sfn-field dt', (els) => els.map((el) => el.textContent)),
        ).toEqual(['From', 'To', 'Type', 'Condition', 'Label']);
        expect(
            await choicePage.$$eval('.sfn-field dd', (els) => els.map((el) => el.textContent)),
        ).toContain('$.kind == "work"');
    });

    it('leaves the label legible when its edge is selected', async () => {
        const target = await pointOnChoiceEdge('Route->Work#choice#0');
        await choicePage.mouse.move(target.x, target.y);
        await choicePage.mouse.down();
        await choicePage.mouse.up();

        // The selection class lands on the label's rect/text too (they carry the same
        // id), but only the drawn path may be restroked - a 3px stroke on ~10px glyphs
        // is an unreadable blob.
        const strokeWidths = await choicePage.$$eval('.sfn-edge-selected', (elements) =>
            elements.map(
                (element) => element.tagName + ':' + getComputedStyle(element).strokeWidth,
            ),
        );

        expect(strokeWidths).toContain('path:3px');
        expect(strokeWidths.filter((entry) => entry.startsWith('text:'))).not.toContain(
            'text:3px',
        );
        expect(strokeWidths.filter((entry) => entry.startsWith('rect:'))).not.toContain(
            'rect:3px',
        );
    });

    it('selects the edge when its own label is clicked', async () => {
        // The label box sits over the edge midpoint, exactly where a reader aims, so it
        // must not swallow the click.
        const labelBox = await choicePage.evaluate(() => {
            const label = Array.from(document.querySelectorAll('rect[data-edge-id]')).find(
                (element) => element.getAttribute('data-edge-id') === 'Route->Skip#default#0',
            )!;
            const rect = label.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });

        await choicePage.mouse.move(labelBox.x, labelBox.y);
        await choicePage.mouse.down();
        await choicePage.mouse.up();

        expect(
            await choicePage.$eval('#sfn-panel-title', (element) => element.textContent),
        ).toBe('Route->Skip#default#0');
    });
});

describe('edge detail panel inside a Parallel container', () => {
    let containerPage: Page;

    const parallelDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    {
                        StartAt: 'Branch1',
                        States: {
                            Branch1: { Type: 'Pass', Next: 'Branch1Done' },
                            Branch1Done: { Type: 'Succeed' },
                        },
                    },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        containerPage = await browser.newPage();
        await containerPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: parallelDefinition, collapse: false });
        await containerPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await containerPage.close();
    });

    it('clicks through the container rect to an edge routed inside it', async () => {
        // The container's background rect is filled and painted after the edges, so it
        // hit-tests above them - the hit areas live in their own later group for exactly
        // this case.
        const hit = await containerPage.evaluate(() => {
            const path = Array.from(
                document.querySelectorAll('path[data-edge-id][data-edge-hit-area]'),
            ).find(
                (element) =>
                    element.getAttribute('data-edge-id') === 'Branch1->Branch1Done#normal#0',
            ) as SVGPathElement;
            const point = path.getPointAtLength(path.getTotalLength() / 2);
            const matrix = path.getScreenCTM()!;
            const x = point.x * matrix.a + point.y * matrix.c + matrix.e;
            const y = point.x * matrix.b + point.y * matrix.d + matrix.f;
            const topmost = document.elementFromPoint(x, y)!;
            return { tag: topmost.tagName, x, y };
        });

        expect(hit.tag).toBe('path');

        await containerPage.mouse.move(hit.x, hit.y);
        await containerPage.mouse.down();
        await containerPage.mouse.up();

        expect(
            await containerPage.$eval('#sfn-panel-title', (element) => element.textContent),
        ).toBe('Branch1->Branch1Done#normal#0');
    });

    it('closes the panel when a node with no ASL of its own is clicked', async () => {
        // Branch-end markers are virtual - collectStateData has no entry for them. The
        // panel must close rather than keep showing the previously-selected edge.
        const target = await containerPage.evaluate(() => {
            const marker = Array.from(document.querySelectorAll('[data-state-id]')).find(
                (element) => (element.getAttribute('data-state-id') ?? '').includes('__branch'),
            )!;
            const rect = marker.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });

        await containerPage.mouse.move(target.x, target.y);
        await containerPage.mouse.down();
        await containerPage.mouse.up();

        expect(
            await containerPage.$eval('#sfn-panel', (element) =>
                element.classList.contains('sfn-open'),
            ),
        ).toBe(false);
        expect(
            await containerPage.$$eval('.sfn-edge-selected', (elements) => elements.length),
        ).toBe(0);
    });
});

/**
 * Runtime tests for `ViewerHandle.setContent`, driven the same way a host (the VS
 * Code preview) does: dispatching `sfn-set-content` on `document` with a
 * `generateViewerUpdate` payload as its `detail`.
 */

const editedAlphaResourceDef: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:alpha-v2',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 3 }],
            Next: 'Beta',
        },
        Beta: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage', Next: 'Gamma' },
        Gamma: { Type: 'Succeed' },
    },
};

const betaRemovedDef: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:alpha',
            Next: 'Gamma',
        },
        Gamma: { Type: 'Succeed' },
    },
};

const largeDef: AslDefinition = (() => {
    const states: AslDefinition['States'] = {};
    for (let index = 0; index < 19; index++) {
        states[`Step${index}`] = { Type: 'Pass', Next: `Step${index + 1}` };
    }
    states.Step19 = { Type: 'Succeed' };
    return { StartAt: 'Step0', States: states };
})();

describe('setContent via sfn-set-content', () => {
    let contentPage: Page;

    beforeEach(async () => {
        contentPage = await browser.newPage();
        await contentPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: definition });
        await contentPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterEach(async () => {
        await contentPage.close();
    });

    async function dispatchSetContent(update: ViewerUpdate): Promise<void> {
        await contentPage.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);
    }

    async function centerOfState(stateId: string): Promise<{ x: number; y: number }> {
        return contentPage.evaluate((id) => {
            const element = document.querySelector(`[data-state-id="${id}"]`);
            const rect = element!.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, stateId);
    }

    async function pointOnEdgeInContent(edgeId: string): Promise<{ x: number; y: number }> {
        return contentPage.evaluate((id) => {
            const path = Array.from(document.querySelectorAll('[data-edge-id]')).find(
                (element) => element.getAttribute('data-edge-id') === id,
            ) as SVGPathElement;
            const point = path.getPointAtLength(path.getTotalLength() / 2);
            const matrix = path.getScreenCTM()!;
            return {
                x: point.x * matrix.a + point.y * matrix.c + matrix.e,
                y: point.x * matrix.b + point.y * matrix.d + matrix.f,
            };
        }, edgeId);
    }

    async function clickInContentAt(x: number, y: number): Promise<void> {
        await contentPage.mouse.move(x, y);
        await contentPage.mouse.down();
        await contentPage.mouse.up();
    }

    it('preserves pan/zoom across an update once the viewport has been touched', async () => {
        await contentPage.click('[data-sfn-zoom="in"]');
        const target = await centerOfState('Beta');
        await contentPage.mouse.move(target.x, target.y);
        await contentPage.mouse.down();
        await contentPage.mouse.move(target.x + 60, target.y + 40, { steps: 8 });
        await contentPage.mouse.up();

        const transformBefore = await contentPage.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );
        const zoomBefore = await contentPage.$eval('#sfn-zoom-label', (element) => element.textContent);

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: editedAlphaResourceDef }));

        expect(
            await contentPage.$eval('#sfn-content', (element) => (element as HTMLElement).style.transform),
        ).toBe(transformBefore);
        expect(await contentPage.$eval('#sfn-zoom-label', (element) => element.textContent)).toBe(zoomBefore);
    });

    it('re-fits to the new diagram when the viewport was never touched', async () => {
        const transformBefore = await contentPage.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: largeDef }));

        const transformAfter = await contentPage.$eval(
            '#sfn-content',
            (element) => (element as HTMLElement).style.transform,
        );
        expect(transformAfter).not.toBe(transformBefore);
    });

    it('preserves the search query and recomputes hits after an update', async () => {
        await contentPage.focus('#sfn-search');
        await typeSearch({ expectedCount: '1 / 1', target: contentPage, text: 'be' });
        expect(await contentPage.$eval('#sfn-search-count', (element) => element.textContent)).toBe('1 / 1');

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: editedAlphaResourceDef }));

        expect(await contentPage.$eval('#sfn-search', (element) => (element as HTMLInputElement).value)).toBe(
            'be',
        );
        expect(await contentPage.$eval('#sfn-search-count', (element) => element.textContent)).toBe('1 / 1');
        expect(
            await contentPage.$$eval('.sfn-hit', (elements) =>
                elements.map((element) => element.getAttribute('data-state-id')),
            ),
        ).toEqual(['Beta']);
        expect(await contentPage.$$eval('.sfn-dim', (elements) => elements.length)).toBe(2);
    });

    it('keeps its viewport when an update lands inside the search debounce window', async () => {
        // The keystroke and the update happen in one in-page script: a CDP round-trip
        // between them could outlast the debounce and settle the search first, which
        // is exactly the ordering this guards against.
        await contentPage.click('[data-sfn-zoom="in"]');
        const update = generateViewerUpdate({ aslDefinition: editedAlphaResourceDef });
        const result = await contentPage.evaluate(async (detail) => {
            const input = document.querySelector('#sfn-search') as HTMLInputElement;
            input.value = 'be';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
            const content = document.querySelector('#sfn-content') as HTMLElement;
            const afterUpdate = content.style.transform;
            await new Promise((resolve) => setTimeout(resolve, 200));
            return {
                afterUpdate,
                count: document.querySelector('#sfn-search-count')!.textContent,
                settled: content.style.transform,
            };
        }, update as unknown as Record<string, unknown>);

        // The queued pass would have re-centred on its first hit after the update.
        expect(result.settled).toBe(result.afterUpdate);
        // The update still applied the typed query, rather than dropping it.
        expect(result.count).toBe('1 / 1');
    });

    it('keeps the detail panel open on the same state, showing the refreshed ASL', async () => {
        const target = await centerOfState('Alpha');
        await clickInContentAt(target.x, target.y);
        expect(await contentPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            true,
        );

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: editedAlphaResourceDef }));

        expect(await contentPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            true,
        );
        expect(await contentPage.$eval('#sfn-panel-title', (element) => element.textContent)).toBe('Alpha');
        expect(
            await contentPage.$eval('#sfn-panel-json', (element) => element.textContent?.includes('alpha-v2')),
        ).toBe(true);
    });

    it('closes the detail panel when its state is removed by the update', async () => {
        const target = await centerOfState('Beta');
        await clickInContentAt(target.x, target.y);
        expect(await contentPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            true,
        );

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: betaRemovedDef }));

        expect(await contentPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            false,
        );
    });

    it('closes the edge detail panel and clears the highlight when the edge is removed', async () => {
        const target = await pointOnEdgeInContent('Alpha->Beta#normal#0');
        await clickInContentAt(target.x, target.y);
        expect(await contentPage.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(2);

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: betaRemovedDef }));

        expect(await contentPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            false,
        );
        expect(await contentPage.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBe(0);
    });

    it('still opens the panel on a click after an update, proving delegated listeners survived the swap', async () => {
        await dispatchSetContent(generateViewerUpdate({ aslDefinition: editedAlphaResourceDef }));

        const target = await centerOfState('Gamma');
        await clickInContentAt(target.x, target.y);

        expect(await contentPage.$eval('#sfn-panel-title', (element) => element.textContent)).toBe('Gamma');
    });

    it('rebuilds the minimap thumbnail and preserves its open/closed state across an update', async () => {
        expect(
            await contentPage.$eval('#sfn-minimap', (element) =>
                element.classList.contains('sfn-minimap-collapsed'),
            ),
        ).toBe(true);

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: editedAlphaResourceDef }));

        // Still auto-collapsed: a small diagram, and the minimap was never manually toggled.
        expect(
            await contentPage.$eval('#sfn-minimap', (element) =>
                element.classList.contains('sfn-minimap-collapsed'),
            ),
        ).toBe(true);

        await contentPage.click('[data-sfn-minimap-toggle]');
        expect(
            await contentPage.$eval('#sfn-minimap', (element) =>
                element.classList.contains('sfn-minimap-collapsed'),
            ),
        ).toBe(false);

        await dispatchSetContent(generateViewerUpdate({ aslDefinition: definition }));

        // The manual choice persists across the update.
        expect(
            await contentPage.$eval('#sfn-minimap', (element) =>
                element.classList.contains('sfn-minimap-collapsed'),
            ),
        ).toBe(false);
        expect(
            await contentPage.$eval('#sfn-minimap-thumb', (element) => !!element.querySelector('svg')),
        ).toBe(true);
    });

    describe('with a collapse toggle', () => {
        const parallelDefinition: AslDefinition = {
            StartAt: 'FanOut',
            States: {
                FanOut: {
                    Type: 'Parallel',
                    Branches: [
                        { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                        { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        };
        const parallelDefinitionEdited: AslDefinition = {
            StartAt: 'FanOut',
            States: {
                FanOut: {
                    Type: 'Parallel',
                    Branches: [
                        {
                            StartAt: 'Branch1',
                            States: { Branch1: { Type: 'Task', Resource: 'arn:b1-v2', End: true } },
                        },
                        { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        };
        const flatDefinition: AslDefinition = { StartAt: 'Solo', States: { Solo: { Type: 'Succeed' } } };

        let toggleContentPage: Page;

        beforeEach(async () => {
            toggleContentPage = await browser.newPage();
            await toggleContentPage.setViewport({ width: 1280, height: 800 });
            const { html } = generateHtml({ aslDefinition: parallelDefinition });
            await toggleContentPage.setContent(html, { waitUntil: 'load' });
        }, 60_000);

        afterEach(async () => {
            await toggleContentPage.close();
        });

        async function dispatchOnToggle(update: ViewerUpdate): Promise<void> {
            await toggleContentPage.evaluate((detail) => {
                document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
            }, update as unknown as Record<string, unknown>);
        }

        it('stays on the collapsed view across an update, keeping the toggle label', async () => {
            await toggleContentPage.click('[data-sfn-collapse-toggle]');
            expect(await toggleContentPage.$eval('[data-sfn-collapse-toggle]', (element) => element.textContent)).toBe(
                'Expand',
            );

            await dispatchOnToggle(generateViewerUpdate({ aslDefinition: parallelDefinitionEdited }));

            expect(
                await toggleContentPage.$eval('[data-sfn-view="collapsed"]', (element) => (element as HTMLElement).hidden),
            ).toBe(false);
            expect(
                await toggleContentPage.$eval('[data-sfn-view="expanded"]', (element) => (element as HTMLElement).hidden),
            ).toBe(true);
            expect(await toggleContentPage.$eval('[data-sfn-collapse-toggle]', (element) => element.textContent)).toBe(
                'Expand',
            );
        });

        it('hides the collapse toggle when the updated diagram has no container', async () => {
            await dispatchOnToggle(generateViewerUpdate({ aslDefinition: flatDefinition }));

            expect(
                await toggleContentPage.$eval(
                    '[data-sfn-collapse-toggle]',
                    (element) => (element as HTMLElement).hidden,
                ),
            ).toBe(true);
        });
    });
});

describe('keyboard navigation', () => {
    // Its own page: focus-moving assertions are order-dependent, and the shared
    // `page` above is reused (and left in an unpredictable focus state) by every
    // preceding test.
    let kbPage: Page;

    const kbParallelDefinition: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        kbPage = await browser.newPage();
        await kbPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: kbParallelDefinition, collapse: false });
        await kbPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await kbPage.close();
    });

    it('makes every state group with panel data a focusable, labelled button', async () => {
        // Scoped past the minimap thumbnail: it clones the whole diagram (including
        // whatever attributes are on it by the time it's built) purely for a scaled-down
        // visual overview, so its copies must not become duplicate tab stops - see the
        // dedicated minimap assertion below.
        const groups = await kbPage.$$eval('[data-sfn="content"] [data-state-id]', (elements) =>
            elements.map((element) => ({
                ariaLabel: element.getAttribute('aria-label'),
                id: element.getAttribute('data-state-id'),
                role: element.getAttribute('role'),
                tabindex: element.getAttribute('tabindex'),
                titleText: element.querySelector('title')?.textContent ?? null,
            })),
        );

        const marker = groups.find((group) => (group.id ?? '').includes('__branch'));
        expect(marker).toBeDefined();
        expect(marker!.tabindex).toBeNull();

        const real = groups.filter((group) => group !== marker);
        expect(real.length).toBeGreaterThan(0);
        for (const group of real) {
            expect(group.tabindex).toBe('0');
            expect(group.role).toBe('button');
            expect(group.ariaLabel).toBe(group.titleText);
        }
    });

    it('makes exactly one focusable element per edge, not one per hit-area/label pair', async () => {
        const counts = await kbPage.evaluate(() => {
            const byId = new Map<string, number>();
            document
                .querySelectorAll('[data-sfn="content"] [data-edge-id]')
                .forEach((element) => {
                    if (element.getAttribute('tabindex') !== '0') return;
                    const id = element.getAttribute('data-edge-id')!;
                    byId.set(id, (byId.get(id) ?? 0) + 1);
                });
            return Array.from(byId.values());
        });
        expect(counts.length).toBeGreaterThan(0);
        expect(counts.every((count) => count === 1)).toBe(true);
    });

    it('excludes the minimap thumbnail clone from the tab order entirely', async () => {
        // buildMinimapThumbnail() clones the live SVG for a scaled-down overview, so
        // by the time it runs, the clone would otherwise carry every tabindex/role/
        // aria-label this module just added to the real diagram - duplicate, invisible-
        // at-scale tab stops a keyboard user could tab into.
        const minimapFocusable = await kbPage.$$eval(
            '#sfn-minimap-thumb [tabindex], #sfn-minimap-thumb [role], #sfn-minimap-thumb [aria-label]',
            (elements) => elements.length,
        );
        expect(minimapFocusable).toBe(0);
        expect(
            await kbPage.$eval('#sfn-minimap', (element) => element.getAttribute('aria-hidden')),
        ).toBe('true');
    });

    /** Tab from the search box until focus lands on an element matching `attribute`. */
    async function tabUntil(attribute: string): Promise<string | null> {
        let value: string | null = null;
        for (let attempt = 0; attempt < 15 && value === null; attempt++) {
            await kbPage.keyboard.press('Tab');
            value = await kbPage.evaluate(
                (name) => document.activeElement?.getAttribute(name) ?? null,
                attribute,
            );
        }
        return value;
    }

    it('opens the panel via Enter on a focused node', async () => {
        await kbPage.focus('#sfn-search');
        const stateId = await tabUntil('data-state-id');
        expect(stateId).not.toBeNull();

        await kbPage.keyboard.press('Enter');

        expect(
            await kbPage.$eval('[data-sfn="panel"]', (element) =>
                element.classList.contains('sfn-open'),
            ),
        ).toBe(true);
        expect(await kbPage.$eval('[data-sfn="panel-title"]', (element) => element.textContent)).toBe(
            stateId,
        );

        await kbPage.keyboard.press('Escape');
    });

    it('opens the edge panel via Space on a focused edge, without scrolling the page', async () => {
        await kbPage.focus('#sfn-search');
        const edgeId = await tabUntil('data-edge-id');
        expect(edgeId).not.toBeNull();

        const scrollBefore = await kbPage.evaluate(() => window.scrollY);
        await kbPage.keyboard.press('Space');
        const scrollAfter = await kbPage.evaluate(() => window.scrollY);
        expect(scrollAfter).toBe(scrollBefore);

        expect(
            await kbPage.$eval('[data-sfn="panel"]', (element) =>
                element.classList.contains('sfn-open'),
            ),
        ).toBe(true);
        expect(await kbPage.$$eval('.sfn-edge-selected', (elements) => elements.length)).toBeGreaterThan(
            0,
        );

        await kbPage.keyboard.press('Escape');
    });

    it('moves focus into the panel on Enter, gives it dialog semantics, and restores focus on Escape', async () => {
        await kbPage.focus('#sfn-search');
        const stateId = await tabUntil('data-state-id');
        expect(stateId).not.toBeNull();

        await kbPage.keyboard.press('Enter');

        const focusedInPanel = await kbPage.evaluate(() => {
            const panel = document.querySelector('[data-sfn="panel"]')!;
            return panel === document.activeElement || panel.contains(document.activeElement);
        });
        expect(focusedInPanel).toBe(true);

        const dialogInfo = await kbPage.evaluate(() => {
            const panel = document.querySelector('[data-sfn="panel"]')!;
            const labelledbyId = panel.getAttribute('aria-labelledby');
            const labelElement = labelledbyId ? document.getElementById(labelledbyId) : null;
            return {
                labelText: labelElement?.textContent ?? null,
                role: panel.getAttribute('role'),
            };
        });
        expect(dialogInfo.role).toBe('dialog');
        expect(dialogInfo.labelText).toBe(stateId);

        await kbPage.keyboard.press('Escape');

        expect(
            await kbPage.evaluate(() => document.activeElement?.getAttribute('data-state-id')),
        ).toBe(stateId);
    });

    it('does not move focus into the panel on a mouse click', async () => {
        const target = await kbPage.$eval('[data-state-id="Done"]', (element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        await kbPage.mouse.move(target.x, target.y);
        await kbPage.mouse.down();
        await kbPage.mouse.up();

        expect(
            await kbPage.$eval('[data-sfn="panel"]', (element) =>
                element.classList.contains('sfn-open'),
            ),
        ).toBe(true);
        const focusedInPanel = await kbPage.evaluate(() => {
            const panel = document.querySelector('[data-sfn="panel"]')!;
            return panel === document.activeElement || panel.contains(document.activeElement);
        });
        expect(focusedInPanel).toBe(false);

        await kbPage.keyboard.press('Escape');
    });

    it('does not steal focus back to a stale trigger when Escape is pressed while typing in search', async () => {
        // Open the panel via keyboard once (so a `panelTrigger` is recorded), close it,
        // then re-focus search and press Escape there. The root keydown handler closes
        // the panel again on every Escape - unconditionally re-focusing panelTrigger
        // there (instead of restoring focus only when it was actually inside the
        // panel) would otherwise yank focus out of the search box the user is in.
        await kbPage.focus('#sfn-search');
        const stateId = await tabUntil('data-state-id');
        expect(stateId).not.toBeNull();
        await kbPage.keyboard.press('Enter');
        await kbPage.keyboard.press('Escape');

        await kbPage.focus('#sfn-search');
        await kbPage.type('#sfn-search', 'Done');
        await kbPage.keyboard.press('Escape');

        const activeStateId = await kbPage.evaluate(() =>
            document.activeElement?.getAttribute('data-state-id'),
        );
        expect(activeStateId).not.toBe(stateId);
        expect(await kbPage.$eval('#sfn-search', (element) => (element as HTMLInputElement).value)).toBe(
            '',
        );
    });

    it('keeps Tab focus inside the panel while it is open', async () => {
        await kbPage.focus('#sfn-search');
        const stateId = await tabUntil('data-state-id');
        expect(stateId).not.toBeNull();
        await kbPage.keyboard.press('Enter');

        for (let index = 0; index < 3; index++) {
            await kbPage.keyboard.press('Tab');
            const stillInPanel = await kbPage.evaluate(() => {
                const panel = document.querySelector('[data-sfn="panel"]')!;
                return panel.contains(document.activeElement);
            });
            expect(stillInPanel).toBe(true);
        }

        await kbPage.keyboard.down('Shift');
        await kbPage.keyboard.press('Tab');
        await kbPage.keyboard.up('Shift');
        const stillInPanelAfterShiftTab = await kbPage.evaluate(() => {
            const panel = document.querySelector('[data-sfn="panel"]')!;
            return panel.contains(document.activeElement);
        });
        expect(stillInPanelAfterShiftTab).toBe(true);

        await kbPage.keyboard.press('Escape');
        const stillInPanelAfterEscape = await kbPage.evaluate(() => {
            const panel = document.querySelector('[data-sfn="panel"]')!;
            return panel.contains(document.activeElement);
        });
        expect(stillInPanelAfterEscape).toBe(false);
    });

    it('recentres via the pan model instead of scrolling the stage element when focus lands off-screen', async () => {
        // The toolbar zoom-in button scales without adjusting translate (transform-origin
        // 0 0), so zooming in pushes most of the diagram out of the stage's visible area -
        // exactly the scenario a browser's native "scroll the focused element into view"
        // would otherwise fight the translate-based pan model over.
        for (let zoomClick = 0; zoomClick < 15; zoomClick++) {
            await kbPage.click('[data-sfn-zoom="in"]');
        }

        await kbPage.focus('#sfn-search');
        let recentred = false;
        for (let attempt = 0; attempt < 60 && !recentred; attempt++) {
            const before = await kbPage.$eval(
                '[data-sfn="content"]',
                (element) => (element as HTMLElement).style.transform,
            );
            await kbPage.keyboard.press('Tab');
            const after = await kbPage.$eval(
                '[data-sfn="content"]',
                (element) => (element as HTMLElement).style.transform,
            );
            recentred = after !== before;
        }
        expect(recentred).toBe(true);

        const scroll = await kbPage.$eval('[data-sfn="stage"]', (element) => ({
            left: element.scrollLeft,
            top: element.scrollTop,
        }));
        expect(scroll).toEqual({ left: 0, top: 0 });
    });

    it('recentres on an off-screen edge too, not only on nodes', async () => {
        // Edges carry no group `transform` the way nodes do (their `d` points are
        // already absolute), so a centring implementation keyed off that attribute
        // alone would silently no-op for an edge - the earlier "recentres..." test
        // can pass on a node tab stop alone and never catch that gap.
        for (let zoomClick = 0; zoomClick < 15; zoomClick++) {
            await kbPage.click('[data-sfn-zoom="in"]');
        }

        await kbPage.focus('#sfn-search');
        let recentred = false;
        for (let attempt = 0; attempt < 60 && !recentred; attempt++) {
            const before = await kbPage.$eval(
                '[data-sfn="content"]',
                (element) => (element as HTMLElement).style.transform,
            );
            await kbPage.keyboard.press('Tab');
            const isEdge = await kbPage.evaluate(() =>
                document.activeElement?.hasAttribute('data-edge-id'),
            );
            if (!isEdge) continue;
            const after = await kbPage.$eval(
                '[data-sfn="content"]',
                (element) => (element as HTMLElement).style.transform,
            );
            recentred = after !== before;
        }
        expect(recentred).toBe(true);
    });
});

describe('detail panel below the compact breakpoint', () => {
    let narrowPage: Page;

    beforeAll(async () => {
        narrowPage = await browser.newPage();
        await narrowPage.setViewport({ width: 400, height: 700 });
        const { html } = generateHtml({ aslDefinition: definition });
        await narrowPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await narrowPage.close();
    });

    it('opens as a bottom sheet over a full-width stage instead of a 360px side panel', async () => {
        await narrowPage.evaluate(() => {
            const group = document.querySelector('[data-state-id="Beta"]') as SVGElement;
            const options = { bubbles: true, pointerId: 1 };
            group.dispatchEvent(new PointerEvent('pointerdown', options));
            group.dispatchEvent(new PointerEvent('pointerup', options));
        });

        const layout = await narrowPage.evaluate(() => {
            const panel = document.querySelector('#sfn-panel')!.getBoundingClientRect();
            const stage = document.querySelector('#sfn-stage')!;
            return {
                panelBottom: panel.bottom,
                panelLeft: panel.left,
                panelOpen: document.querySelector('#sfn-panel')!.classList.contains('sfn-open'),
                panelTop: panel.top,
                panelWidth: panel.width,
                stageWidth: stage.clientWidth,
            };
        });

        expect(layout.panelOpen).toBe(true);
        // Anchored to the bottom edge and spanning the full width...
        expect(layout.panelLeft).toBe(0);
        expect(layout.panelWidth).toBe(400);
        expect(layout.panelBottom).toBe(700);
        // ...but never covering the whole stage - the diagram stays visible above it.
        expect(layout.panelTop).toBeGreaterThanOrEqual(700 * 0.4);
        // The stage is no longer shrunk by the panel's width.
        expect(layout.stageWidth).toBe(400);
    });

    it('hides the minimap while the sheet would cover it, and brings it back on close', async () => {
        const minimapDisplay = (): Promise<string> =>
            narrowPage.$eval('#sfn-minimap', (element) => getComputedStyle(element).display);

        // The panel is still open from the previous test; showing the minimap now
        // (via its shortcut) must not surface it underneath the sheet.
        await narrowPage.keyboard.press('m');
        expect(await minimapDisplay()).toBe('none');

        await narrowPage.keyboard.press('Escape');
        expect(await narrowPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            false,
        );
        expect(await minimapDisplay()).toBe('block');
    });

    /** Open the detail panel for a state without moving the mouse (which could pan). */
    async function openPanelFor(stateId: string): Promise<void> {
        await narrowPage.evaluate((id) => {
            const group = document.querySelector(`[data-state-id="${id}"]`) as SVGElement;
            const options = { bubbles: true, pointerId: 1 };
            group.dispatchEvent(new PointerEvent('pointerdown', options));
            group.dispatchEvent(new PointerEvent('pointerup', options));
        }, stateId);
    }

    it('brings the minimap back with a live viewport rect after panning under the sheet', async () => {
        // The minimap is open from the previous test. While the sheet hides it, every
        // pan would otherwise compute its viewport rect against a box that has no size.
        const viewportSize = (): Promise<{ height: number; width: number }> =>
            narrowPage.$eval('#sfn-minimap-viewport', (element) => {
                const rect = element.getBoundingClientRect();
                return { height: rect.height, width: rect.width };
            });
        const before = await viewportSize();
        expect(before.width).toBeGreaterThan(10);

        await openPanelFor('Beta');
        const sheetTop = await narrowPage.$eval('#sfn-panel', (element) => element.getBoundingClientRect().top);
        const y = Math.min(150, sheetTop / 2);
        await narrowPage.mouse.move(40, y);
        await narrowPage.mouse.down();
        await narrowPage.mouse.move(120, y + 40, { steps: 8 });
        await narrowPage.mouse.up();
        await narrowPage.keyboard.press('Escape');

        // A pan leaves the scale alone, so the rect must come back at the size it had
        // before the sheet opened - not collapsed to its bare border.
        expect(await viewportSize()).toEqual(before);
    });

    it('centres a search hit in the part of the stage the sheet leaves uncovered', async () => {
        await openPanelFor('Alpha');
        const sheetTop = await narrowPage.$eval('#sfn-panel', (element) => element.getBoundingClientRect().top);
        expect(sheetTop).toBeLessThan(700);

        await narrowPage.evaluate(() => {
            const input = document.querySelector('#sfn-search') as HTMLInputElement;
            input.value = 'gamma';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await narrowPage.waitForFunction(
            () => document.querySelector('#sfn-search-count')!.textContent === '1 / 1',
            { polling: 20, timeout: 5_000 },
        );

        const hitCenter = await narrowPage.$eval('.sfn-hit', (element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        // Midpoint of the uncovered band above the sheet, not of the whole 700px stage.
        expect(Math.abs(hitCenter.y - sheetTop / 2)).toBeLessThan(2);
        expect(Math.abs(hitCenter.x - 200)).toBeLessThan(2);

        await narrowPage.keyboard.press('Escape');
    });

    it('refreshes the minimap viewport rect when a resize reveals it past the breakpoint', async () => {
        const viewportRect = (): Promise<Record<string, number>> =>
            narrowPage.$eval('#sfn-minimap-viewport', (element) => {
                const rect = element.getBoundingClientRect();
                return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
            });
        const dragBy = async (dx: number, dy: number): Promise<void> => {
            await narrowPage.mouse.move(60, 120);
            await narrowPage.mouse.down();
            await narrowPage.mouse.move(60 + dx, 120 + dy, { steps: 4 });
            await narrowPage.mouse.up();
        };

        const minimapCollapsed = await narrowPage.$eval('#sfn-minimap', (element) =>
            element.classList.contains('sfn-minimap-collapsed'),
        );
        if (minimapCollapsed) await narrowPage.keyboard.press('m');

        // Pan while the sheet hides the minimap, then widen past the breakpoint with
        // the panel still open: the side panel now shrinks the stage and the minimap
        // is visible again, so its rect must be re-derived without any further input.
        await openPanelFor('Beta');
        await dragBy(30, 20);
        await narrowPage.setViewport({ width: 1000, height: 700 });
        await narrowPage.waitForFunction(
            () => getComputedStyle(document.querySelector('#sfn-minimap')!).display !== 'none',
            { polling: 20, timeout: 5_000 },
        );
        // ResizeObserver notifications are delivered in the rendering step after
        // layout, so the first frame's callbacks can still see the stale rect.
        await narrowPage.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const afterResize = await viewportRect();

        // A pan out and back returns to the exact same transform, so the rect the pan
        // machinery then draws is what a fresh derivation looks like.
        await dragBy(20, 10);
        await dragBy(-20, -10);
        expect(afterResize).toEqual(await viewportRect());

        await narrowPage.keyboard.press('Escape');
        await narrowPage.setViewport({ width: 400, height: 700 });
    });
});

describe('search debounce', () => {
    let debouncePage: Page;

    interface SearchSnapshot {
        count: string | null;
        dimmed: number;
        hit: string | null;
    }

    /** In-page helpers installed once by `beforeAll`, so each test reads as one script. */
    interface SearchTestHelpers {
        /** Wait comfortably past the controller's debounce window. */
        settle(): Promise<void>;
        snapshot(): SearchSnapshot;
        /** Set the search box's value and fire `input`, the way typing would. */
        type(value: string): void;
    }
    type SearchTestWindow = Window & { sfnSearchTest: SearchTestHelpers };

    beforeAll(async () => {
        debouncePage = await browser.newPage();
        await debouncePage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: definition });
        await debouncePage.setContent(html, { waitUntil: 'load' });
        await debouncePage.evaluate(() => {
            const input = document.querySelector('#sfn-search') as HTMLInputElement;
            (window as unknown as SearchTestWindow).sfnSearchTest = {
                settle: () => new Promise((resolve) => setTimeout(resolve, 200)),
                snapshot: () => ({
                    count: document.querySelector('#sfn-search-count')!.textContent,
                    dimmed: document.querySelectorAll('.sfn-dim').length,
                    hit: document.querySelector('.sfn-hit')?.getAttribute('data-state-id') ?? null,
                }),
                type: (value) => {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                },
            };
        });
    }, 60_000);

    afterAll(async () => {
        await debouncePage.close();
    });

    it('defers the highlight pass until typing pauses, then runs it once for the final query', async () => {
        // Everything happens inside one evaluate so the "not yet" snapshot is taken
        // synchronously after the keystrokes - no CDP round-trip can race the timer.
        const result = await debouncePage.evaluate(async () => {
            const { settle, snapshot, type } = (window as unknown as SearchTestWindow).sfnSearchTest;
            type('a');
            type('al');
            type('alp');
            const immediately = snapshot();
            await settle();
            return { immediately, settled: snapshot() };
        });

        expect(result.immediately).toEqual({ count: '', dimmed: 0, hit: null });
        expect(result.settled).toEqual({ count: '1 / 1', dimmed: 2, hit: 'Alpha' });
    });

    it('clears the highlights at once when the box is emptied, and drops a pending pass', async () => {
        const result = await debouncePage.evaluate(async () => {
            const { settle, snapshot, type } = (window as unknown as SearchTestWindow).sfnSearchTest;
            type('be');
            await settle();
            const withQuery = snapshot();
            type('bet');
            type('');
            const immediately = snapshot();
            await settle();
            return { immediately, settled: snapshot(), withQuery };
        });

        expect(result.withQuery).toEqual({ count: '1 / 1', dimmed: 2, hit: 'Beta' });
        expect(result.immediately).toEqual({ count: '', dimmed: 0, hit: null });
        // The 'bet' pass scheduled just before clearing must not land afterwards.
        expect(result.settled).toEqual({ count: '', dimmed: 0, hit: null });
    });

    it('settles a pending query on Enter before cycling, so Enter never acts on the previous query', async () => {
        const result = await debouncePage.evaluate(async () => {
            const { settle, snapshot, type } = (window as unknown as SearchTestWindow).sfnSearchTest;
            type('a');
            await settle();
            const before = snapshot();
            type('gam');
            document
                .querySelector('#sfn-search')!
                .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
            const onEnter = snapshot();
            await settle();
            type('');
            return { before, onEnter, settled: snapshot() };
        });

        // 'a' matches Alpha, Beta and Gamma; 'gam' only Gamma.
        expect(result.before).toEqual({ count: '1 / 3', dimmed: 0, hit: 'Alpha' });
        expect(result.onEnter).toEqual({ count: '1 / 1', dimmed: 2, hit: 'Gamma' });
        expect(result.settled).toEqual({ count: '', dimmed: 0, hit: null });
    });
});

describe('execution playback runtime', () => {
    let playbackPage: Page;

    const retryDefinition: AslDefinition = {
        StartAt: 'Submit',
        States: {
            Submit: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:submit',
                Retry: [{ ErrorEquals: ['States.Timeout'], MaxAttempts: 3 }],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };

    beforeAll(async () => {
        playbackPage = await browser.newPage();
        await playbackPage.setViewport({ width: 1280, height: 800 });
        const history = readFileSync(
            join(__dirname, '..', 'fixtures', 'execution-retry-success.json'),
            'utf-8',
        );
        const { html } = generateHtml({ aslDefinition: retryDefinition, history });
        await playbackPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await playbackPage.close();
    });

    /** The playback status class on a state, or `''` when it carries none. */
    const statusOf = (stateId: string): Promise<string> =>
        playbackPage.evaluate((id) => {
            const svg = document.querySelector('[data-sfn="content"] svg');
            const node = svg!.querySelector(`[data-state-id="${id}"]`);
            return (
                Array.from(node!.classList).find((name) => name.indexOf('sfn-exec-') === 0) ?? ''
            );
        }, stateId);

    const readout = (): Promise<string | null> =>
        playbackPage.$eval('[data-sfn="playback-entry"]', (element) => element.textContent);

    it('ships the bar and the timeline blob only for a document built from a history', async () => {
        expect(await playbackPage.$('[data-sfn="playback"]')).not.toBeNull();
        const entryCount = await playbackPage.evaluate(
            () => JSON.parse(document.getElementById('sfn-timeline-data')!.textContent!).entries.length,
        );
        // Three attempts of Submit plus Done.
        expect(entryCount).toBe(4);

        // The inlined controller bundle carries the bar's selector strings, so the
        // absence of the bar itself is checked against the markup it would emit.
        const { html } = generateHtml({ aslDefinition: retryDefinition });
        expect(html).not.toContain('id="sfn-playback"');
        expect(html).not.toContain('id="sfn-timeline-data"');
    });

    it('paints the status each state held at the playhead, not its final outcome', async () => {
        await playbackPage.click('[data-sfn-playback="next"]');

        // Submit's first attempt is running; Done has not been reached.
        expect(await statusOf('Submit')).toBe('sfn-exec-active');
        expect(await statusOf('Done')).toBe('sfn-exec-pending');
        expect(await readout()).toBe('Submit');
    });

    it('steps by timeline entry, so each retry attempt is its own stop', async () => {
        await playbackPage.click('[data-sfn-playback="next"]');
        expect(await readout()).toBe('Submit · attempt 2');

        await playbackPage.click('[data-sfn-playback="next"]');
        expect(await readout()).toBe('Submit · attempt 3');

        await playbackPage.click('[data-sfn-playback="prev"]');
        expect(await readout()).toBe('Submit · attempt 2');
    });

    it('restores the served overlay at the end of the run', async () => {
        await playbackPage.keyboard.press('End');

        const leftover = await playbackPage.evaluate(
            () => document.querySelectorAll('[class*="sfn-exec-"]').length,
        );
        expect(leftover).toBe(0);
        // The static overlay's own colours are what the document was served with.
        expect(await statusOf('Submit')).toBe('');
    });

    it('lights an edge only once the run it leads into has begun', async () => {
        await playbackPage.keyboard.press('Home');
        const beforeDone = await playbackPage.evaluate(
            () => document.querySelectorAll('.sfn-exec-taken').length,
        );
        expect(beforeDone).toBe(0);

        // Four steps reach Done, whose entry transitioned from Submit.
        for (let step = 0; step < 4; step++) {
            await playbackPage.click('[data-sfn-playback="next"]');
        }
        const taken = await playbackPage.evaluate(() =>
            Array.from(document.querySelectorAll('.sfn-exec-taken')).map((edge) =>
                edge.getAttribute('data-edge-id'),
            ),
        );
        expect(taken.some((id) => id?.indexOf('Submit->Done#') === 0)).toBe(true);
    });

    it('toggles play with Space and does not scroll the stage', async () => {
        // Space belongs to whatever has focus, so this is the nothing-focused case.
        await playbackPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await playbackPage.keyboard.press('Home');
        await playbackPage.keyboard.press('Space');
        const playingLabel = await playbackPage.$eval(
            '[data-sfn="playback-play"]',
            (element) => element.getAttribute('aria-label'),
        );
        expect(playingLabel).toBe('Pause');

        await playbackPage.keyboard.press('Space');
        const pausedLabel = await playbackPage.$eval(
            '[data-sfn="playback-play"]',
            (element) => element.getAttribute('aria-label'),
        );
        expect(pausedLabel).toBe('Play');
    });

    it('runs the instant speed to the end instead of stalling on a non-finite step', async () => {
        await playbackPage.keyboard.press('Home');
        await playbackPage.click('[data-sfn-speed="Infinity"]');
        await playbackPage.click('[data-sfn-playback="toggle"]');
        await playbackPage.waitForFunction(
            () =>
                document.querySelector('[data-sfn="playback-play"]')!.getAttribute('aria-label') ===
                'Play',
            { polling: 20, timeout: 5_000 },
        );

        const readings = await playbackPage.evaluate(() => ({
            clock: document.querySelector('[data-sfn="playback-time"]')!.textContent,
            painted: document.querySelectorAll('[class*="sfn-exec-"]').length,
            scrub: (document.querySelector('[data-sfn="playback-scrub"]') as HTMLInputElement).value,
        }));
        expect(readings.clock).not.toContain('NaN');
        expect(readings.scrub).not.toBe('NaN');
        // Reaching the end leaves the served overlay, same as playing out at 1x.
        expect(readings.painted).toBe(0);
        await playbackPage.click('[data-sfn-speed="1"]');
    });

    it('clears the paint when stepping past the last entry, not only when playing out', async () => {
        await playbackPage.keyboard.press('Home');
        for (let step = 0; step < 8; step++) {
            await playbackPage.click('[data-sfn-playback="next"]');
        }
        const painted = await playbackPage.evaluate(
            () => document.querySelectorAll('[class*="sfn-exec-"]').length,
        );
        expect(painted).toBe(0);
    });

    it('leaves Space to a focused speed button', async () => {
        await playbackPage.keyboard.press('Home');
        await playbackPage.focus('[data-sfn-speed="4"]');
        await playbackPage.keyboard.press('Space');

        const state = await playbackPage.evaluate(() => ({
            play: document.querySelector('[data-sfn="playback-play"]')!.getAttribute('aria-label'),
            pressed: document
                .querySelector('[data-sfn-speed="4"]')!
                .getAttribute('aria-pressed'),
        }));
        // The button took the key; playback did not start behind it.
        expect(state).toEqual({ play: 'Play', pressed: 'true' });
        await playbackPage.click('[data-sfn-speed="1"]');
    });

    it('keeps the right-hand controls clear of an open detail panel', async () => {
        const before = await playbackPage.$eval(
            '[data-sfn="playback"]',
            (element) => element.getBoundingClientRect().right,
        );
        await playbackPage.click('[data-state-id="Done"]');
        const withPanel = await playbackPage.$eval(
            '[data-sfn="playback"]',
            (element) => element.getBoundingClientRect().right,
        );
        expect(withPanel).toBeLessThan(before - 300);
        await playbackPage.click('[data-sfn="panel-close"]');
    });

    it('leaves Space to the search box while it has focus', async () => {
        await playbackPage.keyboard.press('Home');
        await playbackPage.focus('#sfn-search');
        await playbackPage.keyboard.press('Space');

        const label = await playbackPage.$eval(
            '[data-sfn="playback-play"]',
            (element) => element.getAttribute('aria-label'),
        );
        expect(label).toBe('Play');
        await playbackPage.$eval('#sfn-search', (element) => {
            (element as HTMLInputElement).value = '';
            element.blur();
        });
    });
});

describe('execution playback keeps arrowheads and labels with their edge', () => {
    const HIGH = 'CheckValue->HighValue#choice#0';
    let edgePage: Page;

    const loadFixture = (name: string): string =>
        readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');

    const openPlayback = async (fixture: string, history: string): Promise<Page> => {
        const opened = await browser.newPage();
        await opened.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({
            aslDefinition: JSON.parse(loadFixture(`${fixture}.asl.json`)) as AslDefinition,
            history: loadFixture(`${history}.json`),
        });
        await opened.setContent(html, { waitUntil: 'load' });
        return opened;
    };

    /** Press next until `selector` carries `className`, for at most `steps` steps. */
    const stepUntil = async (
        opened: Page,
        params: { className: string; selector: string; steps: number },
    ): Promise<void> => {
        const { className, selector, steps } = params;
        for (let step = 0; step < steps; step++) {
            await opened.click('[data-sfn-playback="next"]');
            const reached = await opened.$eval(selector, (element, name) => element.classList.contains(name), className);
            if (reached) return;
        }
        throw new Error(`${selector} never got ${className}`);
    };

    const pathSelector = (edgeId: string): string =>
        `[data-sfn="content"] svg path[data-edge-id="${edgeId}"]:not([data-edge-hit-area])`;
    const labelStyle = (opened: Page, edgeId: string) =>
        opened.evaluate((id) => {
            const svg = document.querySelector('[data-sfn="content"] svg')!;
            const rect = getComputedStyle(svg.querySelector(`rect[data-edge-id="${id}"]`)!);
            const text = getComputedStyle(svg.querySelector(`text[data-edge-id="${id}"]`)!);
            return {
                rectStrokeOpacity: rect.strokeOpacity,
                textFill: text.fill,
                textFillOpacity: text.fillOpacity,
            };
        }, edgeId);
    const pathOpacity = (opened: Page, edgeId: string): Promise<string> =>
        opened.$eval(pathSelector(edgeId), (element) => getComputedStyle(element).opacity);

    beforeAll(async () => {
        edgePage = await openPlayback('choice', 'execution-choice-highvalue');
    }, 60_000);

    afterAll(async () => {
        await edgePage.close();
    });

    it('dims the path, its arrowhead and its label together before the edge is taken', async () => {
        await edgePage.keyboard.press('Home');

        expect(await pathOpacity(edgePage, HIGH)).toBe('0.2');
        const label = await labelStyle(edgePage, HIGH);
        expect(label.rectStrokeOpacity).toBe('0.2');
        expect(label.textFillOpacity).toBe('0.2');
    });

    it('brings the path and label to full strength in the taken colour once the edge is taken', async () => {
        await stepUntil(edgePage, { className: 'sfn-exec-taken', selector: pathSelector(HIGH), steps: 3 });

        expect(await pathOpacity(edgePage, HIGH)).toBe('1');
        const label = await labelStyle(edgePage, HIGH);
        expect(label.textFill).toBe('rgb(46, 125, 50)');
        expect(label.textFillOpacity).toBe('1');
    });

    it('serves the finished overlay with a taken-colour arrowhead and label', async () => {
        await edgePage.keyboard.press('End');

        const served = await edgePage.evaluate((selector) => {
            const path = document.querySelector(selector)!;
            const markerId = /url\(#([^)]+)\)/.exec(path.getAttribute('marker-end')!)![1];
            const polygon = document.getElementById(markerId)!.querySelector('polygon')!;
            return { markerFill: polygon.getAttribute('fill') };
        }, pathSelector(HIGH));
        expect(served.markerFill).toBe('#2e7d32');
        expect((await labelStyle(edgePage, HIGH)).textFill).toBe('rgb(46, 125, 50)');
    });

    it('never paints a retry self-loop taken, matching the static overlay', async () => {
        const retryPage = await openPlayback('parallel-edges', 'execution-parallel-edges');
        try {
            await retryPage.keyboard.press('Home');
            // The timeline ends with Work re-entering itself through Next.
            await stepUntil(retryPage, {
                className: 'sfn-exec-taken',
                selector: pathSelector('Work->Work#normal#0'),
                steps: 6,
            });

            const retryClasses = await retryPage.$eval(pathSelector('Work->Work#retry#0'), (element) =>
                Array.from(element.classList),
            );
            expect(retryClasses).toContain('sfn-exec-untaken');
            expect(retryClasses).not.toContain('sfn-exec-taken');
        } finally {
            await retryPage.close();
        }
    }, 60_000);
});

describe('execution playback across a setContent update', () => {
    let updatePage: Page;

    const definitionWithHistory: AslDefinition = {
        StartAt: 'Only',
        States: { Only: { Type: 'Pass', End: true } },
    };

    beforeAll(async () => {
        updatePage = await browser.newPage();
        await updatePage.setViewport({ width: 1280, height: 800 });
        const history = readFileSync(
            join(__dirname, '..', 'fixtures', 'execution-retry-success.json'),
            'utf-8',
        );
        const { html } = generateHtml({
            aslDefinition: {
                StartAt: 'Submit',
                States: {
                    Submit: { Type: 'Task', Resource: 'arn:submit', Next: 'Done' },
                    Done: { Type: 'Succeed' },
                },
            } as AslDefinition,
            history,
        });
        await updatePage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await updatePage.close();
    });

    it('retires the controls when the host swaps in a different diagram', async () => {
        const update: ViewerUpdate = generateViewerUpdate({ aslDefinition: definitionWithHistory });
        await updatePage.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);

        // The timeline described the diagram that was just replaced. The bar's own
        // display rule is an author declaration, so `hidden` alone would not hide it.
        const barState = await updatePage.$eval('[data-sfn="playback"]', (element) => ({
            display: getComputedStyle(element).display,
            hidden: (element as HTMLElement).hidden,
        }));
        expect(barState).toEqual({ display: 'none', hidden: true });

        // Neither route back in may repaint: the new diagram's nodes are not in this
        // timeline, so a replay would grey the whole thing out.
        await updatePage.evaluate(() => {
            (document.querySelector('[data-sfn-playback="toggle"]') as HTMLElement).click();
        });
        await updatePage.keyboard.press('ArrowRight');
        const painted = await updatePage.evaluate(
            () => document.querySelectorAll('[class*="sfn-exec-"]').length,
        );
        expect(painted).toBe(0);
    });
});

describe('execution playback with a container and a name containing #', () => {
    let hashPage: Page;

    beforeAll(async () => {
        hashPage = await browser.newPage();
        await hashPage.setViewport({ width: 1280, height: 800 });
        const at = (ms: number): Date => new Date(Date.parse('2024-01-01T00:00:00.000Z') + ms);
        const { html } = generateHtml({
            aslDefinition: {
                StartAt: 'Fanout',
                States: {
                    Fanout: {
                        Type: 'Parallel',
                        Branches: [
                            {
                                StartAt: 'Pay#1',
                                States: {
                                    'Pay#1': { Type: 'Pass', Next: 'Settle' },
                                    Settle: { Type: 'Pass', End: true },
                                },
                            },
                        ],
                        Next: 'Done',
                    },
                    Done: { Type: 'Succeed' },
                },
            } as AslDefinition,
            history: {
                events: [
                    { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: at(0) },
                    { id: 2, previousEventId: 1, type: 'ParallelStateEntered', timestamp: at(10), stateEnteredEventDetails: { name: 'Fanout' } },
                    { id: 3, previousEventId: 2, type: 'ParallelStateStarted', timestamp: at(20) },
                    { id: 4, previousEventId: 3, type: 'PassStateEntered', timestamp: at(30), stateEnteredEventDetails: { name: 'Pay#1' } },
                    { id: 5, previousEventId: 4, type: 'PassStateExited', timestamp: at(40), stateExitedEventDetails: { name: 'Pay#1' } },
                    { id: 6, previousEventId: 5, type: 'PassStateEntered', timestamp: at(50), stateEnteredEventDetails: { name: 'Settle' } },
                    { id: 7, previousEventId: 6, type: 'PassStateExited', timestamp: at(60), stateExitedEventDetails: { name: 'Settle' } },
                    { id: 8, previousEventId: 7, type: 'ParallelStateExited', timestamp: at(70), stateExitedEventDetails: { name: 'Fanout' } },
                    { id: 9, previousEventId: 8, type: 'SucceedStateEntered', timestamp: at(80), stateEnteredEventDetails: { name: 'Done' } },
                    { id: 10, previousEventId: 9, type: 'SucceedStateExited', timestamp: at(90), stateExitedEventDetails: { name: 'Done' } },
                    { id: 11, previousEventId: 10, type: 'ExecutionSucceeded', timestamp: at(100) },
                ],
            },
        });
        await hashPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await hashPage.close();
    });

    it('lights an edge whose source state name contains a #', async () => {
        // Edge ids are `${from}->${to}#${type}#${ordinal}`, and a state name may itself
        // contain a # - splitting on the first one would never match the pair (#79).
        for (let step = 0; step < 3; step++) {
            await hashPage.click('[data-sfn-playback="next"]');
        }
        const taken = await hashPage.evaluate(() =>
            Array.from(document.querySelectorAll('.sfn-exec-taken')).map((edge) =>
                edge.getAttribute('data-edge-id'),
            ),
        );
        expect(taken.some((id) => id?.indexOf('Pay#1->Settle#') === 0)).toBe(true);
    });

    it('clears both views when a collapse toggle happened mid-replay', async () => {
        await hashPage.keyboard.press('Home');
        await hashPage.click('[data-sfn-playback="next"]');
        await hashPage.click('[data-sfn-collapse-toggle]');
        await hashPage.keyboard.press('End');

        // Including the view left behind, which no longer gets painted.
        const painted = await hashPage.evaluate(
            () =>
                document
                    .querySelector('[data-sfn="content"]')!
                    .querySelectorAll('[class*="sfn-exec-"]').length,
        );
        expect(painted).toBe(0);
    });
});

describe('execution payloads in the detail panel', () => {
    let payloadPage: Page;
    let plainPage: Page;

    const retryDefinition: AslDefinition = {
        StartAt: 'Submit',
        States: {
            Submit: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:submit',
                Retry: [{ ErrorEquals: ['States.Timeout'], MaxAttempts: 3 }],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
            // Never entered by the fixture history - the never-reached case.
            Abandoned: { Type: 'Pass', End: true },
        },
    };

    /** The retry fixture, with payloads attached - one of them past the cap. */
    const historyWithPayloads = (): { events: unknown[] } => {
        const events = JSON.parse(
            readFileSync(join(__dirname, '..', 'fixtures', 'execution-retry-success.json'), 'utf-8'),
        ).events;
        events[1].stateEnteredEventDetails.input = '{"orderId":"A-1"}';
        events[4].taskFailedEventDetails.cause = 'connection reset by peer';
        events[11].stateExitedEventDetails.output = '{"receipt":"' + 'x'.repeat(6000) + '"}';
        return { events };
    };

    beforeAll(async () => {
        payloadPage = await browser.newPage();
        await payloadPage.setViewport({ width: 1280, height: 900 });
        const withPayloads = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
        });
        await payloadPage.setContent(withPayloads.html, { waitUntil: 'load' });

        plainPage = await browser.newPage();
        await plainPage.setViewport({ width: 1280, height: 900 });
        const withoutPayloads = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
        });
        await plainPage.setContent(withoutPayloads.html, { waitUntil: 'load' });
    }, 60_000);

    afterAll(async () => {
        await payloadPage.close();
        await plainPage.close();
    });

    /**
     * Click a state by its centre in page coordinates.
     *
     * `page.click(selector)` first scrolls the element into view, which an SVG group
     * inside the stage's `overflow: hidden` box never satisfies - the viewer pans by
     * transform rather than by scrolling - so it times out instead of clicking.
     */
    const clickState = async (target: Page, stateId: string): Promise<void> => {
        const box = await target.evaluate((id) => {
            const rect = document
                .querySelector('[data-sfn="content"] [data-state-id="' + id + '"]')!
                .getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, stateId);
        await target.mouse.click(box.x, box.y);
    };

    it('lists every run of the clicked state, newest attempt folded away', async () => {
        await clickState(payloadPage, 'Submit');

        const runs = await payloadPage.$eval('[data-sfn="panel-runs"]', (section) => ({
            heading: section.querySelector('.sfn-runs-title')!.textContent,
            open: Array.from(section.querySelectorAll('details')).map(
                (block) => (block as HTMLDetailsElement).open,
            ),
            summaries: Array.from(section.querySelectorAll('summary')).map(
                (summary) => summary.textContent,
            ),
        }));

        expect(runs.heading).toBe('Execution \u00b7 3 runs');
        expect(runs.summaries).toEqual([
            'Attempt 1 \u00b7 failed \u00b7 200ms \u00b7 States.Timeout',
            'Attempt 2 \u00b7 failed \u00b7 200ms \u00b7 States.Timeout',
            'Attempt 3 \u00b7 succeeded \u00b7 550ms',
        ]);
        expect(runs.open).toEqual([true, false, false]);
    });

    it('shows the input, the failure cause and the output, pretty-printed', async () => {
        const labels = await payloadPage.$$eval('[data-sfn="panel-runs"] .sfn-payload-head span', (heads) =>
            heads.map((head) => head.textContent),
        );
        expect(labels).toEqual(['Input', 'Cause', 'Input', 'Input', 'Output']);

        const firstInput = await payloadPage.$eval(
            '[data-sfn="panel-runs"] .sfn-payload-json',
            (element) => element.textContent,
        );
        expect(firstInput).toBe('{\n  "orderId": "A-1"\n}');
    });

    it('says how much of an oversized payload is on screen', async () => {
        const note = await payloadPage.$eval(
            '[data-sfn="panel-runs"] .sfn-payload-note',
            (element) => element.textContent,
        );
        expect(note).toBe('Truncated to 4096 of 6014 characters');
    });

    it('carries no payloads at all unless the document asked for them', async () => {
        await clickState(plainPage, 'Submit');

        const section = await plainPage.$eval('[data-sfn="panel-runs"]', (element) => ({
            payloads: element.querySelectorAll('.sfn-payload').length,
            summaries: Array.from(element.querySelectorAll('summary')).map(
                (summary) => summary.textContent,
            ),
        }));
        // The runs themselves are still worth showing - only their contents are gated.
        expect(section.summaries).toHaveLength(3);
        expect(section.payloads).toBe(0);

        const html = await plainPage.content();
        expect(html).not.toContain('connection reset by peer');
        expect(html).not.toContain('orderId');
    });

    it('shows no execution section for a state the run never reached', async () => {
        // Done ran, so it has one; Abandoned is in the definition but not the history.
        await clickState(payloadPage, 'Done');
        const ran = await payloadPage.$eval(
            '[data-sfn="panel-runs"]',
            (section) => section.querySelectorAll('summary').length,
        );
        expect(ran).toBe(1);

        // Close and re-fit first: the open panel is a column over the right of the
        // stage, where an orphan state sits, and a click there would hit the panel.
        await payloadPage.evaluate(() => {
            (document.querySelector('[data-sfn="panel-close"]') as HTMLElement).click();
            (document.querySelector('[data-sfn-zoom="fit"]') as HTMLElement).click();
        });
        await clickState(payloadPage, 'Abandoned');

        // The panel still opened - it is the runs section alone that is absent.
        expect(await payloadPage.$eval('#sfn-panel-title', (element) => element.textContent)).toBe(
            'Abandoned',
        );
        expect(await payloadPage.$('[data-sfn="panel-runs"]')).toBeNull();
    });

    it('has no section at all in a document built without a history', async () => {
        const { html } = generateHtml({ aslDefinition: retryDefinition });
        const plain = await browser.newPage();
        await plain.setContent(html, { waitUntil: 'load' });
        await clickState(plain, 'Submit');
        expect(await plain.$('[data-sfn="panel-runs"]')).toBeNull();
        await plain.close();
    });

    it('reaches a run summary by keyboard, so it can be expanded without a mouse', async () => {
        await clickState(plainPage, 'Submit');
        // Tab from the close button must land somewhere that opens a run.
        await plainPage.focus('[data-sfn="panel-close"]');
        await plainPage.keyboard.press('Tab');

        const focused = await plainPage.evaluate(() => document.activeElement?.tagName);
        expect(focused).toBe('SUMMARY');
    });

    it('drops the previous run when the host swaps in a different diagram', async () => {
        const update: ViewerUpdate = generateViewerUpdate({
            aslDefinition: { StartAt: 'Submit', States: { Submit: { Type: 'Pass', End: true } } } as AslDefinition,
        });
        await payloadPage.evaluate((detail) => {
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);

        await clickState(payloadPage, 'Submit');
        // The timeline described the diagram that was just replaced, payloads and all.
        expect(await payloadPage.$('[data-sfn="panel-runs"]')).toBeNull();
    });
});
describe('motion tokens and reduced motion', () => {
    let motionPage: Page;

    /** Open the detail panel without moving the mouse, which would pan the stage. */
    const openPanelFor = (stateId: string): Promise<void> =>
        motionPage.evaluate((id) => {
            const group = document.querySelector(`[data-state-id="${id}"]`) as SVGElement;
            const options = { bubbles: true, pointerId: 1 };
            group.dispatchEvent(new PointerEvent('pointerdown', options));
            group.dispatchEvent(new PointerEvent('pointerup', options));
        }, stateId);

    const panelMotion = (): Promise<{ delays: string; durations: string; visibility: string }> =>
        motionPage.$eval('#sfn-panel', (element) => {
            const style = getComputedStyle(element);
            return {
                delays: style.transitionDelay,
                durations: style.transitionDuration,
                visibility: style.visibility,
            };
        });

    beforeEach(async () => {
        motionPage = await browser.newPage();
        await motionPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: definition });
        await motionPage.setContent(html, { waitUntil: 'load' });
    }, 60_000);

    afterEach(async () => {
        await motionPage.close();
    });

    it('hides the closed panel with visibility and reveals it on open', async () => {
        expect((await panelMotion()).visibility).toBe('hidden');
        await openPanelFor('Beta');
        expect((await panelMotion()).visibility).toBe('visible');
        // The panel stays in layout throughout, which is what gives the opening
        // transition a start value to run from.
        expect(await motionPage.$eval('#sfn-panel', (element) => getComputedStyle(element).display)).toBe(
            'flex',
        );
    });

    it('resolves the tokens into real durations when motion is welcome', async () => {
        // Headless Chromium has no OS setting to read and reports `reduce`, so the
        // un-reduced case has to be emulated rather than assumed as the default.
        await motionPage.emulateMediaFeatures([
            { name: 'prefers-reduced-motion', value: 'no-preference' },
        ]);

        // Opacity alone, and no delay: the panel fades in and closes at once.
        const { delays, durations } = await panelMotion();
        expect(durations).toBe('0.18s');
        expect(delays).toBe('0s');

        const nodeDuration = await motionPage.$eval(
            '[data-state-id="Beta"]',
            (element) => getComputedStyle(element).transitionDuration,
        );
        expect(nodeDuration).toBe('0.12s');
    });

    it('zeroes every transition under prefers-reduced-motion: reduce', async () => {
        await motionPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

        const { delays, durations } = await panelMotion();
        for (const duration of durations.split(', ')) expect(duration).toBe('0s');
        for (const delay of delays.split(', ')) expect(delay).toBe('0s');

        const nodeDuration = await motionPage.$eval(
            '[data-state-id="Beta"]',
            (element) => getComputedStyle(element).transitionDuration,
        );
        expect(nodeDuration).toBe('0s');

        // The panel still opens and closes - only the animation of it is gone.
        await openPanelFor('Beta');
        expect((await panelMotion()).visibility).toBe('visible');
    });

    it('takes the closing panel out of the tab order before its fade has finished', async () => {
        await motionPage.emulateMediaFeatures([
            { name: 'prefers-reduced-motion', value: 'no-preference' },
        ]);

        expect(await motionPage.$eval('#sfn-panel', (element) => element.hasAttribute('inert'))).toBe(
            true,
        );

        await openPanelFor('Beta');
        expect(await motionPage.$eval('#sfn-panel', (element) => element.hasAttribute('inert'))).toBe(
            false,
        );

        await motionPage.evaluate(() => {
            (document.querySelector('[data-sfn="panel-close"]') as HTMLElement).click();
        });
        // Both the attribute and the paint go on the same tick: an inert panel that
        // is still on screen is one a click falls straight through.
        expect(
            await motionPage.$eval('#sfn-panel', (element) => ({
                inert: element.hasAttribute('inert'),
                visibility: getComputedStyle(element).visibility,
            })),
        ).toEqual({ inert: true, visibility: 'hidden' });

        await motionPage.focus('#sfn-search');
        await motionPage.keyboard.press('Tab');
        const focusedInPanel = await motionPage.evaluate(() =>
            document.querySelector('#sfn-panel')!.contains(document.activeElement),
        );
        expect(focusedInPanel).toBe(false);
    });

    it('skips the closed panel\'s subtree so it costs nothing to keep in layout', async () => {
        await openPanelFor('Beta');
        await motionPage.evaluate(() => {
            (document.querySelector('[data-sfn="panel-close"]') as HTMLElement).click();
        });

        // The panel keeps its own box - that is what the opening fade runs on - but the
        // ASL block it last rendered is skipped rather than re-laid-out on every resize.
        const closed = await motionPage.$eval('#sfn-panel', (element) => ({
            contentVisibility: getComputedStyle(element).contentVisibility,
            jsonRendered: element.querySelector('#sfn-panel-json')!.checkVisibility(),
            panelWidth: element.getBoundingClientRect().width,
        }));
        expect(closed.contentVisibility).toBe('hidden');
        expect(closed.jsonRendered).toBe(false);
        // 360px plus its 1px border - still a box, which is what the fade runs on.
        expect(closed.panelWidth).toBe(361);

        // ...and comes back the moment it reopens.
        await openPanelFor('Beta');
        const reopened = await motionPage.$eval('#sfn-panel', (element) => ({
            contentVisibility: getComputedStyle(element).contentVisibility,
            jsonRendered: element.querySelector('#sfn-panel-json')!.checkVisibility(),
        }));
        expect(reopened).toEqual({ contentVisibility: 'visible', jsonRendered: true });
    });

    it('collapses the minimap without taking it out of layout', async () => {
        const minimapStyle = (): Promise<{ display: string; visibility: string }> =>
            motionPage.$eval('#sfn-minimap', (element) => {
                const style = getComputedStyle(element);
                return { display: style.display, visibility: style.visibility };
            });

        await motionPage.keyboard.press('m');
        const collapsed = await motionPage.$eval('#sfn-minimap', (element) =>
            element.classList.contains('sfn-minimap-collapsed'),
        );
        // The three-node fixture starts under the auto-visible threshold, so one press
        // may reveal it rather than hide it; drive it to collapsed either way.
        if (!collapsed) await motionPage.keyboard.press('m');

        expect(await minimapStyle()).toEqual({ display: 'block', visibility: 'hidden' });

        await motionPage.keyboard.press('m');
        expect(await minimapStyle()).toEqual({ display: 'block', visibility: 'visible' });
    });
});
describe('deep links via location.hash', () => {
    let hashDir: string;
    let hashFile: string;
    let linkPage: Page;

    /** The viewer needs a real origin: replaceState refuses one that is opaque. */
    const load = async (target: Page, fragment = ''): Promise<void> => {
        await target.goto(pathToFileURL(hashFile).href + fragment, { waitUntil: 'load' });
    };

    const currentHash = (): Promise<string> => linkPage.evaluate(() => location.hash);
    const panelTitle = (): Promise<string | null> =>
        linkPage.$eval('#sfn-panel-title', (element) => element.textContent);
    const panelOpen = (): Promise<boolean> =>
        linkPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'));

    /** Select without moving the mouse, which would pan the stage. */
    const clickState = (stateId: string): Promise<void> =>
        linkPage.evaluate((id) => {
            const group = document.querySelector(`[data-state-id="${id}"]`) as SVGElement;
            const options = { bubbles: true, pointerId: 1 };
            group.dispatchEvent(new PointerEvent('pointerdown', options));
            group.dispatchEvent(new PointerEvent('pointerup', options));
        }, stateId);

    beforeAll(async () => {
        hashDir = mkdtempSync(join(tmpdir(), 'sfn-hash-'));
        hashFile = join(hashDir, 'diagram.html');
        writeFileSync(hashFile, generateHtml({ aslDefinition: definition }).html, 'utf-8');

        linkPage = await browser.newPage();
        await linkPage.setViewport({ width: 1280, height: 800 });
        await load(linkPage);
    }, 60_000);

    afterAll(async () => {
        await linkPage.close();
        rmSync(hashDir, { force: true, recursive: true });
    });

    it('writes the selected state into the fragment', async () => {
        await clickState('Beta');
        expect(await currentHash()).toBe('#sfn=state:Beta');
    });

    it('clears the fragment again when the panel closes', async () => {
        await linkPage.evaluate(() => {
            (document.querySelector('[data-sfn="panel-close"]') as HTMLElement).click();
        });
        expect(await currentHash()).toBe('');
    });

    it('leaves the back stack alone, so Back is not six clicks deep', async () => {
        const before = await linkPage.evaluate(() => history.length);
        await clickState('Alpha');
        await clickState('Beta');
        await clickState('Gamma');
        expect(await linkPage.evaluate(() => history.length)).toBe(before);
        expect(await currentHash()).toBe('#sfn=state:Gamma');
    });

    it('opens the panel for whatever the document was loaded with', async () => {
        const deepLinked = await browser.newPage();
        await deepLinked.setViewport({ width: 1280, height: 800 });
        await load(deepLinked, '#sfn=state:Beta');

        expect(
            await deepLinked.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open')),
        ).toBe(true);
        expect(await deepLinked.$eval('#sfn-panel-title', (element) => element.textContent)).toBe('Beta');
        await deepLinked.close();
    });

    it('follows a fragment changed in the address bar, and closes when it is emptied', async () => {
        await linkPage.evaluate(() => {
            location.hash = '#sfn=state:Alpha';
        });
        await linkPage.waitForFunction(
            () => document.querySelector('#sfn-panel-title')!.textContent === 'Alpha',
            { polling: 20, timeout: 5_000 },
        );
        expect(await panelTitle()).toBe('Alpha');

        await linkPage.evaluate(() => {
            location.hash = '';
        });
        await linkPage.waitForFunction(
            () => !document.querySelector('#sfn-panel')!.classList.contains('sfn-open'),
            { polling: 20, timeout: 5_000 },
        );
        expect(await panelOpen()).toBe(false);
    });

    it('opens nothing for a link into a state the diagram no longer has, and keeps the link', async () => {
        const stale = await browser.newPage();
        await stale.setViewport({ width: 1280, height: 800 });
        await stale.goto(pathToFileURL(hashFile).href + '#sfn=state:Renamed', { waitUntil: 'load' });

        expect(await stale.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            false,
        );
        // Erasing it would leave the reader unable to see or copy what they were sent,
        // and unable to retry it once the diagram is regenerated.
        expect(await stale.evaluate(() => location.hash)).toBe('#sfn=state:Renamed');
        await stale.close();
    });

    it('abstains entirely from a document that arrived with someone else\'s fragment', async () => {
        const other = await browser.newPage();
        await other.setViewport({ width: 1280, height: 800 });
        await other.goto(pathToFileURL(hashFile).href + '#some-anchor', { waitUntil: 'load' });

        const select = (): Promise<void> =>
            other.evaluate(() => {
                const group = document.querySelector('[data-state-id="Beta"]') as SVGElement;
                const options = { bubbles: true, pointerId: 1 };
                group.dispatchEvent(new PointerEvent('pointerdown', options));
                group.dispatchEvent(new PointerEvent('pointerup', options));
            });

        expect(await other.evaluate(() => location.hash)).toBe('#some-anchor');

        // Claiming the hash on the first click would overwrite the anchor, and
        // clearing it on close would then destroy it outright - so neither happens.
        await select();
        expect(await other.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open'))).toBe(
            true,
        );
        expect(await other.evaluate(() => location.hash)).toBe('#some-anchor');

        await other.evaluate(() => {
            (document.querySelector('[data-sfn="panel-close"]') as HTMLElement).click();
        });
        expect(await other.evaluate(() => location.hash)).toBe('#some-anchor');
        await other.close();
    });

    it('deep-links an edge as well as a state', async () => {
        const edgeId = await linkPage.$eval('[data-edge-id]', (element) =>
            element.getAttribute('data-edge-id'),
        );
        await linkPage.evaluate((id) => {
            location.hash = `#sfn=edge:${encodeURIComponent(id!)}`;
        }, edgeId);

        await linkPage.waitForFunction(
            (id) => document.querySelector('#sfn-panel-title')!.textContent === id,
            { polling: 20, timeout: 5_000 },
            edgeId,
        );
        expect(await panelTitle()).toBe(edgeId);
    });

    // The embedded counterpart - that an interactive <sfn-diagram> never claims its
    // host page's fragment - needs a real element bundle and a real origin, so it
    // lives in tests/element/elementRuntime.test.ts.
});
describe('toolbar exports', () => {
    let exportPage: Page;

    /** Click a toolbar button without moving the mouse, which could pan the stage. */
    const clickToolbar = (selector: string): Promise<void> =>
        exportPage.evaluate((target) => {
            (document.querySelector(target) as HTMLElement).click();
        }, selector);

    const buttonLabel = (selector: string): Promise<string | null> =>
        exportPage.$eval(selector, (element) => element.textContent);

    beforeAll(async () => {
        exportPage = await browser.newPage();
        await exportPage.setViewport({ width: 1280, height: 800 });
        const { html } = generateHtml({ aslDefinition: definition });
        await exportPage.setContent(html, { waitUntil: 'load' });

        // Capture the download rather than letting Chromium write it to disk, and
        // record the clipboard the copy button reaches for.
        await exportPage.evaluate(() => {
            const store = window as unknown as {
                sfnClipboard?: string;
                sfnDownloads?: Array<{ name: string; type: string }>;
                sfnLastBlob?: string;
            };
            store.sfnDownloads = [];
            const realCreate = URL.createObjectURL.bind(URL);
            URL.createObjectURL = (blob: Blob) => {
                store.sfnDownloads!.push({ name: '', type: blob.type });
                void blob.text().then((text) => {
                    store.sfnLastBlob = text;
                });
                return realCreate(blob);
            };
            const realClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
                if (this.download) {
                    store.sfnDownloads![store.sfnDownloads!.length - 1].name = this.download;
                    return;
                }
                realClick.call(this);
            };
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: (text: string) => {
                        store.sfnClipboard = text;
                        return Promise.resolve();
                    },
                },
            });
        });
    }, 60_000);

    afterAll(async () => {
        await exportPage.close();
    });

    it('downloads the SVG that is on screen, named for the diagram', async () => {
        await clickToolbar('[data-sfn="export-svg"]');
        await exportPage.waitForFunction(
            () => (window as unknown as { sfnLastBlob?: string }).sfnLastBlob !== undefined,
            { polling: 20, timeout: 5_000 },
        );

        const download = await exportPage.evaluate(() => {
            const store = window as unknown as {
                sfnDownloads: Array<{ name: string; type: string }>;
                sfnLastBlob: string;
            };
            return { blob: store.sfnLastBlob, entry: store.sfnDownloads[0] };
        });

        expect(download.entry).toEqual({ name: 'diagram.svg', type: 'image/svg+xml;charset=utf-8' });
        expect(download.blob).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(download.blob).toContain('data-state-id="Alpha"');
    });

    it('leaves search dimming out of the download - that is this reader, not the diagram', async () => {
        await typeSearch({ expectedCount: '1 / 1', target: exportPage, text: 'Beta' });
        // The live SVG really is dimmed, so the assertion below is not vacuous.
        expect(
            await exportPage.$eval('[data-state-id="Alpha"]', (element) =>
                element.classList.contains('sfn-dim'),
            ),
        ).toBe(true);

        await exportPage.evaluate(() => {
            (window as unknown as { sfnLastBlob?: string }).sfnLastBlob = undefined;
        });
        await clickToolbar('[data-sfn="export-svg"]');
        await exportPage.waitForFunction(
            () => (window as unknown as { sfnLastBlob?: string }).sfnLastBlob !== undefined,
            { polling: 20, timeout: 5_000 },
        );

        const blob = await exportPage.evaluate(
            () => (window as unknown as { sfnLastBlob: string }).sfnLastBlob,
        );
        expect(blob).not.toContain('sfn-dim');
        expect(blob).toContain('data-state-id="Alpha"');

        await exportPage.evaluate(() => {
            const input = document.querySelector('#sfn-search') as HTMLInputElement;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }, 20_000);

    it('copies the embedded Mermaid source', async () => {
        await clickToolbar('[data-sfn="copy-mermaid"]');
        await exportPage.waitForFunction(
            () => (window as unknown as { sfnClipboard?: string }).sfnClipboard !== undefined,
            { polling: 20, timeout: 5_000 },
        );

        const copied = await exportPage.evaluate(
            () => (window as unknown as { sfnClipboard: string }).sfnClipboard,
        );
        expect(copied).toContain('stateDiagram-v2');
        expect(copied).toContain('Alpha');
        expect(await buttonLabel('[data-sfn="copy-mermaid"]')).toBe('Copied');
    });

    it('says so rather than copying the old diagram after a content swap sent none', async () => {
        const update: ViewerUpdate = generateViewerUpdate({
            aslDefinition: { StartAt: 'Fresh', States: { Fresh: { Type: 'Succeed' } } } as AslDefinition,
        });
        await exportPage.evaluate((detail) => {
            const withoutMermaid = { ...(detail as Record<string, unknown>) };
            delete withoutMermaid.mermaid;
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail: withoutMermaid }));
        }, update as unknown as Record<string, unknown>);

        await clickToolbar('[data-sfn="copy-mermaid"]');
        await exportPage.waitForFunction(
            () => document.querySelector('[data-sfn="copy-mermaid"]')!.textContent === 'Unavailable',
            { polling: 20, timeout: 5_000 },
        );
        expect(await buttonLabel('[data-sfn="copy-mermaid"]')).toBe('Unavailable');
    });

    it('keeps every toolbar button reachable when the bar outgrows a narrow viewer', async () => {
        const narrow = await browser.newPage();
        await narrow.setViewport({ width: 560, height: 800 });
        // A Parallel diagram, so the collapse toggle is present too - the widest the
        // toolbar ever gets.
        const { html } = generateHtml({
            aslDefinition: {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        Type: 'Parallel',
                        Branches: [
                            { StartAt: 'Leaf', States: { Leaf: { Type: 'Pass', End: true } } },
                        ],
                        Next: 'Done',
                    },
                    Done: { Type: 'Succeed' },
                },
            } as AslDefinition,
        });
        await narrow.setContent(html, { waitUntil: 'load' });

        const bar = await narrow.$eval('[data-sfn="toolbar"]', (element) => ({
            clientWidth: element.clientWidth,
            right: element.getBoundingClientRect().right,
            scrollWidth: element.scrollWidth,
        }));

        // The bar really does outgrow the viewer here, so the rest is not vacuous...
        expect(bar.scrollWidth).toBeGreaterThan(bar.clientWidth);
        // ...but it stays inside it rather than running off the clipped edge...
        expect(bar.right).toBeLessThanOrEqual(560);

        // ...and the last button is reachable by scrolling to it, which is also what
        // focusing it does for a keyboard user.
        const reached = await narrow.evaluate(() => {
            const button = document.querySelector('[data-sfn="copy-mermaid"]') as HTMLElement;
            button.focus();
            const bounds = document.querySelector('[data-sfn="toolbar"]')!.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return {
                focused: document.activeElement === button,
                inside: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
            };
        });
        expect(reached).toEqual({ focused: true, inside: true });
        await narrow.close();
    });

    it('copies the new diagram when the swap did send its Mermaid', async () => {
        const update: ViewerUpdate = generateViewerUpdate({
            aslDefinition: { StartAt: 'Fresh', States: { Fresh: { Type: 'Succeed' } } } as AslDefinition,
        });
        await exportPage.evaluate((detail) => {
            (window as unknown as { sfnClipboard?: string }).sfnClipboard = undefined;
            document.dispatchEvent(new CustomEvent('sfn-set-content', { detail }));
        }, update as unknown as Record<string, unknown>);

        await clickToolbar('[data-sfn="copy-mermaid"]');
        await exportPage.waitForFunction(
            () => (window as unknown as { sfnClipboard?: string }).sfnClipboard !== undefined,
            { polling: 20, timeout: 5_000 },
        );

        const copied = await exportPage.evaluate(
            () => (window as unknown as { sfnClipboard: string }).sfnClipboard,
        );
        expect(copied).toContain('Fresh');
        expect(copied).not.toContain('Alpha');
    });
});
describe('pinch to zoom', () => {
    let touchPage: Page;

    let cdp: CDPSession;

    /**
     * Drive touches through CDP rather than Puppeteer's own touchscreen: that API
     * models a single finger, and everything here is about what happens with two.
     *
     * One session for the whole gesture - Chromium tracks active touch points per
     * session, so a fresh one per call is rejected with "Must send a TouchStart first".
     */
    const touch = async (
        type: 'touchCancel' | 'touchEnd' | 'touchMove' | 'touchStart',
        points: Array<{ id: number; x: number; y: number }>,
    ): Promise<void> => {
        await cdp.send('Input.dispatchTouchEvent', {
            touchPoints: points.map((point) => ({ id: point.id, x: point.x, y: point.y })),
            type,
        });
    };

    /**
     * Dispatch one synthetic PointerEvent on the stage.
     *
     * CDP drives real touches, which is what the pinch arithmetic below is measured
     * with - but it cannot lift one finger of two: `touchEnd` with the remaining point
     * releases every point, and a `touchMove` listing a subset is rejected outright
     * (both measured). The multi-finger bookkeeping is therefore driven at the pointer
     * layer the implementation actually listens on. `setPointerCapture` refuses a
     * synthetic id, which `attachPanZoom` already tolerates by design.
     */
    const pointer = (type: string, id: number, x: number, y: number): Promise<void> =>
        touchPage.evaluate(
            (args) => {
                document.querySelector('#sfn-stage')!.dispatchEvent(
                    new PointerEvent(args.type, {
                        bubbles: true,
                        clientX: args.x,
                        clientY: args.y,
                        pointerId: args.id,
                    }),
                );
            },
            { id, type, x, y },
        );

    /**
     * Let a dispatched move be consumed before the next one.
     *
     * Two touchMoves sent back to back are coalesced and the second is dropped, which
     * reads in a test exactly like the handler ignoring it.
     */
    const settle = (): Promise<unknown> =>
        touchPage.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );

    /** The viewport transform, as the stage currently has it. */
    const transform = (): Promise<{ scale: number; x: number; y: number }> =>
        touchPage.$eval('#sfn-content', (element) => {
            const match = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([\d.]+)\)/.exec(
                (element as HTMLElement).style.transform,
            );
            return match
                ? { scale: Number(match[3]), x: Number(match[1]), y: Number(match[2]) }
                : { scale: NaN, x: NaN, y: NaN };
        });

    beforeEach(async () => {
        touchPage = await browser.newPage();
        await touchPage.setViewport({ hasTouch: true, height: 800, isMobile: false, width: 1000 });
        const { html } = generateHtml({ aslDefinition: definition });
        await touchPage.setContent(html, { waitUntil: 'load' });
        cdp = await touchPage.createCDPSession();
    }, 60_000);

    afterEach(async () => {
        await touchPage.close();
    });

    it('zooms in as two fingers spread, about the point between them', async () => {
        const before = await transform();

        await touch('touchStart', [
            { id: 1, x: 400, y: 400 },
            { id: 2, x: 500, y: 400 },
        ]);
        // Same midpoint (450, 400), twice the span.
        await touch('touchMove', [
            { id: 1, x: 350, y: 400 },
            { id: 2, x: 550, y: 400 },
        ]);
        await touch('touchEnd', []);

        const after = await transform();
        expect(after.scale / before.scale).toBeCloseTo(2, 1);
        // The content under the midpoint did not move, which is what "about the point
        // between them" means: solve the transform for it on both sides.
        const contentBefore = (450 - before.x) / before.scale;
        const contentAfter = (450 - after.x) / after.scale;
        expect(contentAfter).toBeCloseTo(contentBefore, 0);
    });

    it('zooms out as they close', async () => {
        const before = await transform();

        await touch('touchStart', [
            { id: 1, x: 350, y: 400 },
            { id: 2, x: 550, y: 400 },
        ]);
        await touch('touchMove', [
            { id: 1, x: 425, y: 400 },
            { id: 2, x: 475, y: 400 },
        ]);
        await touch('touchEnd', []);

        const after = await transform();
        expect(after.scale / before.scale).toBeCloseTo(0.25, 1);
    });

    it('pans by the midpoint at the same time as it zooms', async () => {
        await touch('touchStart', [
            { id: 1, x: 400, y: 300 },
            { id: 2, x: 500, y: 300 },
        ]);
        const before = await transform();

        // Span unchanged, midpoint moved 100px right and 50px down: a pure pan.
        await touch('touchMove', [
            { id: 1, x: 500, y: 350 },
            { id: 2, x: 600, y: 350 },
        ]);
        await touch('touchEnd', []);

        const after = await transform();
        expect(after.scale).toBeCloseTo(before.scale, 5);
        expect(after.x - before.x).toBeCloseTo(100, 0);
        expect(after.y - before.y).toBeCloseTo(50, 0);
    });

    it('never opens the detail panel, however little the fingers moved', async () => {
        const centre = await centerOfOn(touchPage, 'Beta');

        await touch('touchStart', [
            { id: 1, x: centre.x, y: centre.y },
            { id: 2, x: centre.x + 40, y: centre.y },
        ]);
        await touch('touchMove', [
            { id: 1, x: centre.x, y: centre.y },
            { id: 2, x: centre.x + 41, y: centre.y },
        ]);
        await touch('touchEnd', []);

        // A two-finger gesture is not a click, even inside the click slop.
        expect(
            await touchPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open')),
        ).toBe(false);
    });

    it('still opens it for a plain one-finger tap', async () => {
        const centre = await centerOfOn(touchPage, 'Beta');
        await touch('touchStart', [{ id: 1, x: centre.x, y: centre.y }]);
        await touch('touchEnd', []);

        expect(
            await touchPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open')),
        ).toBe(true);
    });

    it('measures the gesture against a diagram that was already panned and zoomed', async () => {
        // Two toolbar zooms and a one-finger drag, so the pinch starts from something
        // other than the fit transform it would otherwise be measured against.
        await touchPage.evaluate(() => {
            const zoomIn = document.querySelector('[data-sfn-zoom="in"]') as HTMLElement;
            zoomIn.click();
            zoomIn.click();
        });
        await touch('touchStart', [{ id: 1, x: 500, y: 400 }]);
        await touch('touchMove', [{ id: 1, x: 560, y: 430 }]);
        await touch('touchEnd', []);

        const before = await transform();
        // The fit transform for this diagram is scale 2.5 at x 300, so the starting
        // point really is somewhere else by now - the ratio below is not measured
        // against the identity.
        expect(before.scale).toBeCloseTo(2.5 * 1.2 * 1.2, 2);
        expect(before.x).not.toBeCloseTo(300, 0);

        await touch('touchStart', [
            { id: 1, x: 400, y: 400 },
            { id: 2, x: 500, y: 400 },
        ]);
        await settle();
        await touch('touchMove', [
            { id: 1, x: 350, y: 400 },
            { id: 2, x: 550, y: 400 },
        ]);
        await settle();
        await touch('touchEnd', []);

        const after = await transform();
        // The ratio is relative to where the diagram already was, not to 1.
        expect(after.scale / before.scale).toBeCloseTo(2, 1);
        const contentBefore = (450 - before.x) / before.scale;
        const contentAfter = (450 - after.x) / after.scale;
        expect(contentAfter).toBeCloseTo(contentBefore, 0);
    });

    it('keeps following the original pair when a third finger joins', async () => {
        const start = await transform();
        await pointer('pointerdown', 1, 400, 400);
        await pointer('pointerdown', 2, 600, 400);
        await pointer('pointermove', 1, 350, 400);
        await pointer('pointermove', 2, 650, 400);

        const beforeThird = await transform();
        // 200px apart, now 300px: the pinch is live before the third finger arrives.
        expect(beforeThird.scale / start.scale).toBeCloseTo(1.5, 2);

        // A third finger arriving must not re-baseline the span...
        await pointer('pointerdown', 3, 800, 700);
        expect(await transform()).toEqual(beforeThird);

        // ...nor must moving it on its own do anything at all.
        await pointer('pointermove', 3, 200, 200);
        expect(await transform()).toEqual(beforeThird);

        // The original pair still drives: 300px apart, now 400px, so 4/3.
        await pointer('pointermove', 1, 300, 400);
        await pointer('pointermove', 2, 700, 400);
        const after = await transform();
        expect(after.scale / beforeThird.scale).toBeCloseTo(4 / 3, 2);

        await pointer('pointerup', 3, 200, 200);
        await pointer('pointerup', 2, 700, 400);
        await pointer('pointerup', 1, 300, 400);
    });

    it('hands back to a one-finger pan when a finger lifts, without jumping', async () => {
        const start = await transform();
        await pointer('pointerdown', 1, 400, 400);
        await pointer('pointerdown', 2, 600, 400);
        await pointer('pointermove', 1, 390, 400);
        await pointer('pointermove', 2, 610, 400);

        const pinched = await transform();
        expect(pinched.scale / start.scale).toBeCloseTo(1.1, 2);

        // Lift the second finger; the first stays where it already was.
        await pointer('pointerup', 2, 610, 400);
        expect(await transform()).toEqual(pinched);

        // The very first move afterwards must pan by exactly its own delta. Without
        // re-anchoring on the surviving finger it would be read as a drag all the way
        // from wherever the pan last left off - here, a 340px jump back to where the
        // one-finger pan was last anchored.
        await pointer('pointermove', 1, 440, 430);
        const panned = await transform();
        expect(panned.scale).toBeCloseTo(pinched.scale, 5);
        expect(panned.x - pinched.x).toBeCloseTo(50, 0);
        expect(panned.y - pinched.y).toBeCloseTo(30, 0);

        await pointer('pointerup', 1, 440, 430);
    });

    it('saturates at the zoom limits and keeps panning there rather than drifting', async () => {
        // Spread far enough to blow well past MAX_SCALE (8): a 45x span increase on
        // top of the 2.5 the diagram fits at.
        await touch('touchStart', [
            { id: 1, x: 490, y: 400 },
            { id: 2, x: 510, y: 400 },
        ]);
        await settle();
        await touch('touchMove', [
            { id: 1, x: 50, y: 400 },
            { id: 2, x: 950, y: 400 },
        ]);
        await settle();
        const clampedIn = await transform();
        // Saturated exactly at the bound - not merely somewhere below it.
        expect(clampedIn.scale).toBe(8);

        // Spreading further does not overshoot the bound, and the diagram still pans
        // while it is held there.
        //
        // Not asserted as a *pure* pan: Chromium emits one touchmove per changed
        // point, so a two-finger slide arrives as two events and the span wobbles
        // between them. Unclamped that nets out exactly - (S-d)/S then S/(S-d) - but
        // at the bound the first half is clamped and the second is not, so the scale
        // comes back down. That is the right behaviour: it means pulling back from
        // the limit starts zooming out immediately rather than through a dead zone.
        await touch('touchMove', [
            { id: 1, x: 40, y: 400 },
            { id: 2, x: 990, y: 400 },
        ]);
        await settle();
        const spreadFurther = await transform();
        expect(spreadFurther.scale).toBe(8);
        expect(spreadFurther.x).not.toBeCloseTo(clampedIn.x, 0);

        // And pulling back in from the bound does reduce it, with no dead zone.
        await touch('touchMove', [
            { id: 1, x: 300, y: 400 },
            { id: 2, x: 700, y: 400 },
        ]);
        await settle();
        const pulledBack = await transform();
        expect(pulledBack.scale).toBeLessThan(8);
        expect(pulledBack.scale).toBeGreaterThan(0);
        await touch('touchEnd', []);
        await settle();

        // And the other way, past MIN_SCALE (0.05).
        await touch('touchStart', [
            { id: 1, x: 50, y: 400 },
            { id: 2, x: 950, y: 400 },
        ]);
        await settle();
        await touch('touchMove', [
            { id: 1, x: 499, y: 400 },
            { id: 2, x: 501, y: 400 },
        ]);
        await settle();
        expect((await transform()).scale).toBe(0.05);
        await touch('touchEnd', []);
    });

    it('does not close an open panel when two fingers tap and lift', async () => {
        // The gesture that catches this is the one the other no-tap test cannot: with
        // a panel already open, the stray activate() lands on closePanel() rather than
        // on nothing, taking the selection - and #315's deep link - with it.
        // Opened with a real touch: `pointer` dispatches on the stage itself, so
        // there would be no node under it to select.
        const centre = await centerOfOn(touchPage, 'Beta');
        await touch('touchStart', [{ id: 1, x: centre.x, y: centre.y }]);
        await touch('touchEnd', []);
        expect(
            await touchPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open')),
        ).toBe(true);

        // A two-finger tap with no movement at all, lifted in the order it went down.
        await pointer('pointerdown', 2, 300, 500);
        await pointer('pointerdown', 3, 500, 500);
        await pointer('pointerup', 2, 300, 500);
        await pointer('pointerup', 3, 500, 500);

        expect(
            await touchPage.$eval('#sfn-panel', (element) => element.classList.contains('sfn-open')),
        ).toBe(true);
    });

    it('recovers from a pointer whose pointerup never arrived', async () => {
        // The single-pointer path had this recovery before pinch existed: a press that
        // never lifts must not wedge panning. A ghost left in the map would otherwise
        // push every later press into the pinch branch, and each one-finger drag would
        // be read as a one-sided pinch against coordinates that never move again.
        await pointer('pointerdown', 9, 200, 200);

        const before = await transform();
        // A real mouse press is primary, which is what clears the ghost.
        await touchPage.mouse.move(500, 400);
        await touchPage.mouse.down();
        await touchPage.mouse.move(560, 400);
        await touchPage.mouse.up();

        const after = await transform();
        expect(after.scale).toBeCloseTo(before.scale, 5);
        expect(after.x - before.x).toBeCloseTo(60, 0);
    });

    it('behaves identically under prefers-reduced-motion', async () => {
        // Nothing about pan or zoom is transitioned, so the preference must not change
        // the arithmetic - only that it is asserted stops a future transition from
        // quietly making the gesture lag behind the fingers.
        await touchPage.emulateMediaFeatures([
            { name: 'prefers-reduced-motion', value: 'reduce' },
        ]);
        const before = await transform();

        await touch('touchStart', [
            { id: 1, x: 400, y: 400 },
            { id: 2, x: 500, y: 400 },
        ]);
        await settle();
        await touch('touchMove', [
            { id: 1, x: 350, y: 400 },
            { id: 2, x: 550, y: 400 },
        ]);
        await settle();
        await touch('touchEnd', []);

        const after = await transform();
        expect(after.scale / before.scale).toBeCloseTo(2, 1);
        const contentBefore = (450 - before.x) / before.scale;
        const contentAfter = (450 - after.x) / after.scale;
        expect(contentAfter).toBeCloseTo(contentBefore, 0);
    });
});
