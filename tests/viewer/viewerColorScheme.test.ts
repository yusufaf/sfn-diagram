import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer';
import { generateHtml } from '../../src';
import type { AslDefinition, ThemeOption } from '../../src/types';

/**
 * Colour-scheme behaviour of the viewer in Chromium: `'auto'` against the named
 * themes it stands in for.
 *
 * Headless Chromium reports the host OS colour scheme, so every page here emulates
 * `prefers-color-scheme` explicitly; none may rely on the default.
 */

/** No containers and no Distributed Map satellites: every node carries a theme colour. */
const PLAIN_DEFINITION: AslDefinition = {
    StartAt: 'Alpha',
    States: {
        Alpha: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:alpha',
            Retry: [{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 3 }],
            Next: 'Route',
        },
        Route: {
            Type: 'Choice',
            Choices: [{ Variable: '$.ok', BooleanEquals: true, Next: 'Pause' }],
            Default: 'Broken',
        },
        Pause: { Type: 'Wait', Seconds: 1, Next: 'Shape' },
        Shape: { Type: 'Pass', Next: 'Done' },
        Done: { Type: 'Succeed' },
        Broken: { Type: 'Fail' },
    },
};

const PARALLEL_DEFINITION: AslDefinition = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'parallel.asl.json'), 'utf-8'),
);

type Scheme = 'dark' | 'light';

let browser: Browser;

beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
});

/** Parameters for {@link emulate}. */
interface EmulateParams {
    /** Whether `forced-colors: active` should match. */
    forced: boolean;
    page: Page;
    scheme: Scheme;
}

/** One CDP session per page, kept open: detaching it drops the emulation it set. */
const sessions = new WeakMap<Page, CDPSession>();

/**
 * Emulate the colour scheme (always) and forced colours. Raw CDP, because
 * puppeteer's `emulateMediaFeatures` rejects `forced-colors`.
 */
async function emulate(params: EmulateParams): Promise<void> {
    const { forced, page, scheme } = params;
    let session = sessions.get(page);
    if (!session) {
        session = await page.createCDPSession();
        sessions.set(page, session);
    }
    await session.send('Emulation.setEmulatedMedia', {
        features: [
            { name: 'forced-colors', value: forced ? 'active' : 'none' },
            { name: 'prefers-color-scheme', value: scheme },
            { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
    });
}

/** Parameters for {@link openViewer}. */
interface OpenViewerParams {
    definition: AslDefinition;
    /** Emulate `forced-colors: active`. Defaults to `false`. */
    forced?: boolean;
    /** Execution history, for a document with the playback bar. */
    history?: string;
    scheme: Scheme;
    theme: ThemeOption;
}

async function openViewer(params: OpenViewerParams): Promise<Page> {
    const { definition, forced = false, history, scheme, theme } = params;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await emulate({ forced, page, scheme });
    await page.setContent(generateHtml({ aslDefinition: definition, history, theme }).html, { waitUntil: 'load' });
    return page;
}

/** Tag plus computed fill and stroke of every drawn SVG element, in document order. */
const svgPaint = (page: Page): Promise<string[]> =>
    page.$$eval('[data-sfn="content"] svg *:not(style)', (elements) =>
        elements.map((element) => {
            const style = getComputedStyle(element);
            return `${element.tagName} fill=${style.fill} stroke=${style.stroke}`;
        }),
    );

/** Computed colours of the chrome that frames the diagram. */
const chromePaint = (page: Page): Promise<Record<string, string>> =>
    page.evaluate(() => {
        const computed = (selector: string): CSSStyleDeclaration =>
            getComputedStyle(document.querySelector(selector)!);
        return {
            button: computed('[data-sfn="toolbar"] button').color,
            stage: computed('[data-sfn="stage"]').backgroundColor,
            toolbar: computed('[data-sfn="toolbar"]').backgroundColor,
        };
    });

/** A point on an edge's drawn stroke, in viewport coordinates. */
async function pointOnEdge(page: Page, edgeId: string): Promise<{ x: number; y: number }> {
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

async function clickAt(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
}

describe("viewer colour scheme: theme 'auto'", () => {
    describe.each(['light', 'dark'] as const)('under prefers-color-scheme: %s', (scheme) => {
        it.each([
            ['plain', PLAIN_DEFINITION],
            ['parallel', PARALLEL_DEFINITION],
        ] as const)(
            `paints the %s diagram and chrome exactly as theme '${scheme}' does`,
            async (_label, definition) => {
                const autoPage = await openViewer({ definition, scheme, theme: 'auto' });
                const namedPage = await openViewer({ definition, scheme, theme: scheme });
                try {
                    const autoSvg = await svgPaint(autoPage);
                    const namedSvg = await svgPaint(namedPage);
                    expect(autoSvg.length).toBe(namedSvg.length);
                    expect(autoSvg).toEqual(namedSvg);
                    expect(await chromePaint(autoPage)).toEqual(await chromePaint(namedPage));
                } finally {
                    await autoPage.close();
                    await namedPage.close();
                }
            },
            60_000,
        );
    });

    it('repaints live when the scheme changes, with no reload', async () => {
        const page = await openViewer({ definition: PLAIN_DEFINITION, scheme: 'light', theme: 'auto' });
        try {
            const taskFill = (): Promise<string> =>
                page.$eval('[data-state-type="Task"] > rect', (element) => getComputedStyle(element).fill);
            expect(await taskFill()).toBe('rgb(255, 243, 224)');

            await emulate({ forced: false, page, scheme: 'dark' });
            expect(await taskFill()).toBe('rgb(156, 52, 0)');
        } finally {
            await page.close();
        }
    }, 60_000);

    it('keeps the selected-edge accent over the dark edge colour', async () => {
        const page = await openViewer({ definition: PLAIN_DEFINITION, scheme: 'dark', theme: 'auto' });
        try {
            const edgeId = 'Alpha->Route#normal#0';
            const target = await pointOnEdge(page, edgeId);
            await clickAt(page, target.x, target.y);

            const drawn = await page.evaluate((id) => {
                const path = Array.from(document.querySelectorAll('path[data-edge-id]')).find(
                    (element) => element.getAttribute('data-edge-id') === id && !element.hasAttribute('data-edge-hit-area'),
                )!;
                return { selected: path.classList.contains('sfn-edge-selected'), stroke: getComputedStyle(path).stroke };
            }, edgeId);
            expect(drawn.selected).toBe(true);
            // The dark chrome accent, not the dark normal edge colour rgb(144, 164, 174).
            expect(drawn.stroke).toBe('rgb(83, 159, 229)');
        } finally {
            await page.close();
        }
    }, 60_000);
});

/** WCAG contrast ratio between two computed `rgb()`/`rgba()` colours. */
function contrastRatio(first: string, second: string): number {
    const luminance = (color: string): number => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const [red, green, blue] = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
}

const RETRY_DEFINITION: AslDefinition = {
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
const RETRY_HISTORY = readFileSync(join(__dirname, '..', 'fixtures', 'execution-retry-success.json'), 'utf-8');

const STATE_TYPES = ['Pass', 'Task', 'Choice', 'Wait', 'Succeed', 'Fail', 'Parallel', 'Map'];

/**
 * Chromium forces the HTML chrome's colours under forced-colors but leaves SVG paint
 * alone, so the diagram keeps its theme palette and only the chrome needs care.
 */
describe('viewer under forced colours', () => {
    const combinations = (['light', 'dark', 'auto'] as const).flatMap((theme) =>
        (['light', 'dark'] as const).map((scheme) => [theme, scheme] as const),
    );

    it.each(combinations)('keeps theme %s legible under the %s scheme', async (theme, scheme) => {
        const accent = (theme === 'auto' ? scheme : theme) === 'dark' ? 'rgb(83, 159, 229)' : 'rgb(9, 114, 211)';
        const page = await openViewer({ definition: PLAIN_DEFINITION, forced: true, scheme, theme });
        try {
            const toolbar = await page.evaluate(() => {
                const bar = document.querySelector('[data-sfn="toolbar"]')!;
                const button = getComputedStyle(bar.querySelector('button')!);
                return {
                    background: getComputedStyle(bar).backgroundColor,
                    buttonBackground: button.backgroundColor,
                    buttonText: button.color,
                    divider: getComputedStyle(bar.querySelector('.sfn-divider')!).backgroundColor,
                };
            });
            expect(contrastRatio(toolbar.buttonText, toolbar.buttonBackground)).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(toolbar.divider, toolbar.background)).toBeGreaterThanOrEqual(3);

            const labels = await page.evaluate((stateTypes) => {
                const groups = Array.from(document.querySelectorAll('[data-sfn="content"] g.node[data-state-type]'));
                return groups
                    .filter((group) => stateTypes.includes(group.getAttribute('data-state-type')!))
                    .map((group) => ({
                        id: group.getAttribute('data-state-id'),
                        shape: getComputedStyle(group.querySelector(':scope > title + *')!).fill,
                        text: getComputedStyle(group.querySelector(':scope > text')!).fill,
                    }));
            }, STATE_TYPES);
            expect(labels.length).toBe(Object.keys(PLAIN_DEFINITION.States).length);
            for (const label of labels) {
                expect(contrastRatio(label.text, label.shape), label.id!).toBeGreaterThanOrEqual(4.5);
            }

            await page.click('[data-sfn="minimap-toggle"]');
            const viewportBorder = await page.$eval(
                '[data-sfn="minimap-viewport"]',
                (element) => getComputedStyle(element).borderTopColor,
            );
            expect(viewportBorder).toBe(accent);

            await page.focus('[data-sfn="search"]');
            let focused: { outline: string } | null = null;
            for (let attempt = 0; attempt < 15 && focused === null; attempt++) {
                await page.keyboard.press('Tab');
                focused = await page.evaluate(() => {
                    const active = document.activeElement;
                    if (!active?.hasAttribute('data-state-id')) return null;
                    return { outline: getComputedStyle(active.querySelector(':scope > title + *')!).outlineColor };
                });
            }
            expect(focused).not.toBeNull();
            const background = await page.$eval(
                '[data-sfn="content"] svg > rect',
                (element) => getComputedStyle(element).fill,
            );
            expect(contrastRatio(focused!.outline, background)).toBeGreaterThanOrEqual(3);
        } finally {
            await page.close();
        }
    }, 60_000);

    it.each(combinations)('shows the pressed playback control for theme %s under the %s scheme', async (theme, scheme) => {
        const page = await openViewer({
            definition: RETRY_DEFINITION,
            forced: true,
            history: RETRY_HISTORY,
            scheme,
            theme,
        });
        try {
            const buttons = await page.evaluate(() => {
                const paint = (selector: string): { background: string; text: string } => {
                    const style = getComputedStyle(document.querySelector(selector)!);
                    return { background: style.backgroundColor, text: style.color };
                };
                return {
                    pressed: paint('[data-sfn="playback"] button[aria-pressed="true"]'),
                    unpressed: paint('[data-sfn="playback"] button[aria-pressed="false"]'),
                };
            });
            expect(buttons.pressed.background).not.toBe(buttons.unpressed.background);
            expect(contrastRatio(buttons.pressed.text, buttons.pressed.background)).toBeGreaterThanOrEqual(4.5);
        } finally {
            await page.close();
        }
    }, 60_000);
});
