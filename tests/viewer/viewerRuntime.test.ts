import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
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
        expect(await collapseToggleAriaExpanded()).toBe('true');
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
        expect(await collapseToggleAriaExpanded()).toBe('false');

        const buttonLabel = await collapsePage.$eval(
            '[data-sfn-collapse-toggle]',
            (element) => element.textContent,
        );
        expect(buttonLabel).toBe('Expand');
    });

    it('keeps the collapsed view keyboard-navigable for an edge id shared with the expanded view', async () => {
        // FanOut->Done exists in both the expanded and collapsed SVGs under the same
        // data-edge-id - a global, content-wide dedup pass would only make it a tab
        // stop in whichever view's DOM query visits it first (the expanded view,
        // rendered first), leaving the now-visible collapsed view's copy untabbable.
        const collapsedEdgeTabIndexes = await collapsePage.$$eval(
            '[data-sfn-view="collapsed"] [data-edge-id="FanOut->Done#normal#0"]',
            (elements) => elements.map((element) => element.getAttribute('tabindex')),
        );
        expect(collapsedEdgeTabIndexes).toContain('0');
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
        expect(await collapseToggleAriaExpanded()).toBe('true');
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
        await contentPage.type('#sfn-search', 'be');
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
});
