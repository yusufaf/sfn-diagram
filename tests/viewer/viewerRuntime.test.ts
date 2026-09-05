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

    it('shows the expanded view with both branch states visible by default', async () => {
        const expandedVisible = await collapsePage.$eval(
            '[data-sfn-view="expanded"]',
            (element) => !(element as HTMLElement).hidden,
        );
        const collapsedHidden = await collapsePage.$eval(
            '[data-sfn-view="collapsed"]',
            (element) => (element as HTMLElement).hidden,
        );
        expect(expandedVisible).toBe(true);
        expect(collapsedHidden).toBe(true);
    });

    it('toggling shows the collapsed placeholder and hides the branch states', async () => {
        await collapsePage.click('[data-sfn-collapse-toggle]');

        const expandedHidden = await collapsePage.$eval(
            '[data-sfn-view="expanded"]',
            (element) => (element as HTMLElement).hidden,
        );
        const collapsedHidden = await collapsePage.$eval(
            '[data-sfn-view="collapsed"]',
            (element) => (element as HTMLElement).hidden,
        );
        expect(expandedHidden).toBe(true);
        expect(collapsedHidden).toBe(false);

        const buttonLabel = await collapsePage.$eval(
            '[data-sfn-collapse-toggle]',
            (element) => element.textContent,
        );
        expect(buttonLabel).toBe('Expand');
    });

    it('search after toggling only matches states in the now-visible view', async () => {
        await collapsePage.focus('#sfn-search');
        await collapsePage.type('#sfn-search', 'FanOut');

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

    it('starts open for the large expanded view', async () => {
        expect(await minimapCollapsed()).toBe(false);
    });

    it('auto-hides on switching to the small collapsed view, and reopens switching back', async () => {
        await togglePage.click('[data-sfn-collapse-toggle]');
        expect(await minimapCollapsed()).toBe(true);

        await togglePage.click('[data-sfn-collapse-toggle]');
        expect(await minimapCollapsed()).toBe(false);
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
