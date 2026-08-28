import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { AslDefinition } from '../../src/types';

/**
 * Runtime tests for `<sfn-diagram>` (the `sfn-diagram/element` custom element),
 * mirroring `tests/viewer/viewerRuntime.test.ts`'s real-Chromium approach: the
 * upgrade lifecycle, attribute/property reactivity, and multi-instance behaviour
 * aren't things a string/markup assertion can catch.
 */

const asl: AslDefinition = {
    StartAt: 'Start',
    States: {
        Start: { Type: 'Pass', Comment: 'Starting state', Next: 'Process' },
        Process: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ProcessTask',
            Next: 'End',
        },
        End: { Type: 'Succeed' },
    },
};

const historyJson = readFileSync(join(__dirname, '../fixtures/execution-success.json'), 'utf-8');

/**
 * The shipped `dist/element*.js` keep `@dagrejs/dagre`/`d3-shape`/`yaml` as bare
 * external imports - correct for a real consumer's own bundler, but unresolvable
 * when loaded directly into a bare page with no module resolution. Build a
 * throwaway variant with those inlined, just for driving the element in Chromium.
 *
 * Shelled out to `scripts/build-test-element-bundle.mjs` in a separate process
 * rather than calling tsdown's `build()` in-process: with rolldown's native
 * bindings and Puppeteer's browser automation sharing one worker, the browser
 * side became unreliable in this environment.
 *
 * @param entry - Source entry to bundle, relative to the package root
 */
function buildElementTestBundle(entry: string): string {
    const outDir = join(tmpdir(), 'sfn-diagram-element-test-bundle', entry.replace(/\W+/g, '-'));
    execFileSync(
        process.execPath,
        [join(__dirname, '../../scripts/build-test-element-bundle.mjs'), entry, outDir],
        { cwd: join(__dirname, '../..'), stdio: 'inherit' },
    );
    return readFileSync(join(outDir, 'bundle.js'), 'utf-8');
}

let browser: Browser;
/** Bundled from `src/element/auto.ts` - auto-registers `<sfn-diagram>` on load. */
let autoElementBundle: string;
/**
 * Bundled from `src/element/index.ts` - no registration side effect, for the one
 * test that calls `defineSfnDiagram` itself under a custom name.
 */
let bareElementBundle: string;
let page: Page;

// CPU contention from other Puppeteer-heavy suites running in the same test process
// can starve the renderer's rAF loop, which is waitForFunction's default polling
// strategy - poll on a plain timer instead so registration is still observed promptly.
const POLLING_OPTIONS = { polling: 100, timeout: 30_000 } as const;

/**
 * A fresh page with the auto-registering element module loaded.
 *
 * Retries the whole page/script/registration sequence once: under heavy contention
 * from the other Puppeteer-driven suites in this run, a fresh page has occasionally
 * needed longer than any single reasonable timeout to become responsive at all - a
 * new page (and its own waitForFunction budget) reliably clears that up.
 */
async function newElementPage(): Promise<Page> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        const newPage = await browser.newPage();
        try {
            await newPage.setViewport({ width: 1280, height: 800 });
            // A module script is deferred, so `waitUntil: 'load'` already guarantees it
            // (and its customElements.define side effect) ran by the time this resolves
            // - matching tests/viewer/viewerRuntime.test.ts's setContent-only pattern
            // rather than addScriptTag, which was unreliable in this environment.
            await newPage.setContent(
                `<!doctype html><html><body><script type="module">${autoElementBundle}</script></body></html>`,
                { waitUntil: 'load' },
            );
            await newPage.waitForFunction(() => !!customElements.get('sfn-diagram'), POLLING_OPTIONS);
            return newPage;
        } catch (error) {
            lastError = error;
            await newPage.close().catch(() => {});
        }
    }
    throw lastError;
}

beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
});

beforeAll(async () => {
    autoElementBundle = buildElementTestBundle('./src/element/auto.ts');
    bareElementBundle = buildElementTestBundle('./src/element/index.ts');
    page = await newElementPage();
}, 150_000);

describe('upgrade and static rendering', () => {
    it('renders SVG once definition is set', async () => {
        const html = await page.evaluate((definition) => {
            const el = document.createElement('sfn-diagram');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<string>((resolve) => {
                queueMicrotask(() => queueMicrotask(() => resolve(el.innerHTML)));
            });
        }, asl as unknown as object);

        expect(html).toContain('<svg');
        expect(html).toContain('data-state-id="Start"');
    });

    it('accepts a JSON string via the definition attribute', async () => {
        const html = await page.evaluate((definitionJson) => {
            const el = document.createElement('sfn-diagram');
            el.setAttribute('definition', definitionJson);
            document.body.appendChild(el);
            return new Promise<string>((resolve) => {
                queueMicrotask(() => queueMicrotask(() => resolve(el.innerHTML)));
            });
        }, JSON.stringify(asl));

        expect(html).toContain('<svg');
    });

    it('re-renders when layout or theme attributes change', async () => {
        const result = await page.evaluate((definition) => {
            const el = document.createElement('sfn-diagram');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<{ afterTheme: string; before: string }>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() => {
                        const before = el.innerHTML;
                        el.setAttribute('theme', 'dark');
                        queueMicrotask(() =>
                            queueMicrotask(() => resolve({ afterTheme: el.innerHTML, before })),
                        );
                    }),
                );
            });
        }, asl as unknown as object);

        expect(result.afterTheme).not.toBe(result.before);
    });

    it('renders Mermaid code into a <pre> for format="mermaid"', async () => {
        const text = await page.evaluate((definition) => {
            const el = document.createElement('sfn-diagram');
            el.setAttribute('format', 'mermaid');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<string | null | undefined>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() => resolve(el.querySelector('pre')?.textContent)),
                );
            });
        }, asl as unknown as object);

        expect(text).toContain('stateDiagram-v2');
    });

    it('renders an execution overlay when history is set', async () => {
        const html = await page.evaluate(
            (definition, history) => {
                const el = document.createElement('sfn-diagram');
                document.body.appendChild(el);
                (el as unknown as { definition: unknown; history: unknown }).definition =
                    definition;
                (el as unknown as { history: unknown }).history = JSON.parse(history);
                return new Promise<string>((resolve) => {
                    queueMicrotask(() => queueMicrotask(() => resolve(el.innerHTML)));
                });
            },
            asl as unknown as object,
            historyJson,
        );

        expect(html).toContain('data-state-id');
    });

    it('dispatches sfn-error and renders nothing for invalid ASL', async () => {
        const result = await page.evaluate(() => {
            const el = document.createElement('sfn-diagram');
            let caught: string | undefined;
            el.addEventListener('sfn-error', (event) => {
                caught = (event as CustomEvent<Error>).detail.message;
            });
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = { StartAt: 'X', States: {} };
            return new Promise<{ caught: string | undefined; html: string }>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() => resolve({ caught, html: el.innerHTML })),
                );
            });
        });

        expect(result.caught).toBeTruthy();
        expect(result.html).toBe('');
    });
});

describe('progressive enhancement', () => {
    it('leaves pre-existing markup untouched when no definition is set', async () => {
        const html = await page.evaluate(() => {
            const el = document.createElement('sfn-diagram');
            el.innerHTML = '<svg width="10" height="10"><rect data-marker="original"/></svg>';
            document.body.appendChild(el);
            return new Promise<string>((resolve) => {
                queueMicrotask(() => queueMicrotask(() => resolve(el.innerHTML)));
            });
        });

        expect(html).toContain('data-marker="original"');
    });

    it('wraps pre-existing SVG with viewer chrome when interactive is set', async () => {
        const result = await page.evaluate(() => {
            const el = document.createElement('sfn-diagram');
            el.setAttribute('interactive', '');
            el.innerHTML = '<svg width="10" height="10"><rect data-marker="original"/></svg>';
            document.body.appendChild(el);
            return new Promise<{ hasStage: boolean; keptSvgContent: boolean }>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() =>
                        resolve({
                            hasStage: !!el.querySelector('[data-sfn="stage"]'),
                            keptSvgContent: el.innerHTML.includes('data-marker="original"'),
                        }),
                    ),
                );
            });
        });

        expect(result.hasStage).toBe(true);
        expect(result.keptSvgContent).toBe(true);
    });
});

describe('interactive mode', () => {
    it('renders the toolbar and wires pan/zoom', async () => {
        const result = await page.evaluate((definition) => {
            const el = document.createElement('sfn-diagram');
            el.setAttribute('interactive', '');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<{ hasSearch: boolean; hasStage: boolean; transform: string }>(
                (resolve) => {
                    queueMicrotask(() =>
                        queueMicrotask(() => {
                            const content = el.querySelector('[data-sfn="content"]') as HTMLElement;
                            resolve({
                                hasSearch: !!el.querySelector('[data-sfn="search"]'),
                                hasStage: !!el.querySelector('[data-sfn="stage"]'),
                                transform: content?.style.transform ?? '',
                            });
                        }),
                    );
                },
            );
        }, asl as unknown as object);

        expect(result.hasStage).toBe(true);
        expect(result.hasSearch).toBe(true);
        expect(result.transform).toContain('scale(');
    });

    it('supports two instances on one page without colliding', async () => {
        const result = await page.evaluate((definition) => {
            const a = document.createElement('sfn-diagram');
            const b = document.createElement('sfn-diagram');
            a.setAttribute('interactive', '');
            b.setAttribute('interactive', '');
            document.body.appendChild(a);
            document.body.appendChild(b);
            (a as unknown as { definition: unknown }).definition = definition;
            (b as unknown as { definition: unknown }).definition = definition;
            return new Promise<{ aStage: boolean; bStage: boolean; duplicateIds: number }>(
                (resolve) => {
                    queueMicrotask(() =>
                        queueMicrotask(() => {
                            const ids = new Map<string, number>();
                            document.querySelectorAll('[id]').forEach((element) => {
                                ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
                            });
                            resolve({
                                aStage: !!a.querySelector('[data-sfn="stage"]'),
                                bStage: !!b.querySelector('[data-sfn="stage"]'),
                                duplicateIds: Array.from(ids.values()).filter((count) => count > 1)
                                    .length,
                            });
                        }),
                    );
                },
            );
        }, asl as unknown as object);

        expect(result.aStage).toBe(true);
        expect(result.bStage).toBe(true);
        expect(result.duplicateIds).toBe(0);
    });

    it('detaches its listeners on remove()', async () => {
        const result = await page.evaluate((definition) => {
            const el = document.createElement('sfn-diagram');
            el.setAttribute('interactive', '');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<{ after: string; before: string }>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() => {
                        el.remove();
                        const content = el.querySelector('[data-sfn="content"]') as HTMLElement;
                        const stage = el.querySelector('[data-sfn="stage"]') as HTMLElement;
                        const before = content.style.transform;
                        // A leaked wheel listener would still update the transform even
                        // though the element is now detached; a cleaned-up one won't.
                        stage.dispatchEvent(
                            new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -50 }),
                        );
                        resolve({ after: content.style.transform, before });
                    }),
                );
            });
        }, asl as unknown as object);

        expect(result.after).toBe(result.before);
    });
});

/** Same page/script/registration-observation sequence as {@link newElementPage}, but exposing `defineSfnDiagram` directly instead of relying on an auto-registration side effect. Retries once for the same reason. */
async function newBareElementPage(): Promise<Page> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        const scoped = await browser.newPage();
        try {
            // src/element/index.ts (unlike .../auto.ts) has no registration side effect
            // of its own - defineSfnDiagram is exposed on window purely so a test can
            // call it directly, the way a consumer importing { defineSfnDiagram } would.
            await scoped.setContent(
                `<!doctype html><html><body><script type="module">${bareElementBundle}\nwindow.defineSfnDiagram = defineSfnDiagram;\n</script></body></html>`,
                { waitUntil: 'load' },
            );
            await scoped.waitForFunction(
                () =>
                    typeof (window as unknown as { defineSfnDiagram?: unknown })
                        .defineSfnDiagram === 'function',
                POLLING_OPTIONS,
            );
            return scoped;
        } catch (error) {
            lastError = error;
            await scoped.close().catch(() => {});
        }
    }
    throw lastError;
}

describe('defineSfnDiagram', () => {
    it('registers under a custom tag name and renders under it', async () => {
        const scoped = await newBareElementPage();

        const result = await scoped.evaluate((definition) => {
            (window as unknown as { defineSfnDiagram: (params: { name: string }) => void })
                .defineSfnDiagram({ name: 'my-diagram' });

            const el = document.createElement('my-diagram');
            document.body.appendChild(el);
            (el as unknown as { definition: unknown }).definition = definition;
            return new Promise<{ defaultTagDefined: boolean; html: string }>((resolve) => {
                queueMicrotask(() =>
                    queueMicrotask(() =>
                        resolve({
                            defaultTagDefined: !!customElements.get('sfn-diagram'),
                            html: el.innerHTML,
                        }),
                    ),
                );
            });
        }, asl as unknown as object);

        expect(result.html).toContain('<svg');
        // Only the custom name was registered - no auto side effect in this bundle.
        expect(result.defaultTagDefined).toBe(false);
        await scoped.close();
    }, 120_000);
});
