import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { generateHtml } from '../../src';
import type { AslDefinition } from '../../src/types';

/**
 * Confirms the interactive viewer document runs clean under a strict host
 * content-security-policy - the constraint a VS Code webview imposes. Markup
 * assertions alone (`tests/HtmlViewer.test.ts`) cannot catch a CSP violation: an
 * inline `on*=` handler or an un-nonced `<script>` fails silently in a real
 * browser rather than throwing at generation time.
 */

const parallelFixture: AslDefinition = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/parallel.asl.json'), 'utf-8'),
);

const NONCE = 'test-nonce-abc123';

/** Strict CSP matching the one `packages/vscode-sfn-diagram` stamps on its webview. */
function strictCspMeta(nonce: string): string {
    return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https://cdn.jsdelivr.net data:; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline';">`;
}

let browser: Browser;
let page: Page;

beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
});

describe('interactive viewer under a strict CSP', () => {
    it('reports zero policy violations and zero script errors, and the controller attaches', async () => {
        const { html } = generateHtml({ aslDefinition: parallelFixture, nonce: NONCE });
        const withCsp = html.replace('<head>', `<head>\n${strictCspMeta(NONCE)}`);

        page = await browser.newPage();
        const violations: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') violations.push(message.text());
        });
        page.on('pageerror', (error) => pageErrors.push(error.message));

        await page.setContent(withCsp, { waitUntil: 'load' });

        // The controller actually attached: clicking a state opens the detail panel.
        const target = await page.evaluate(() => {
            const element = document.querySelector('[data-state-id]')!;
            const rect = element.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await page.mouse.up();

        const panelOpen = await page.$eval('[data-sfn="panel"]', (element) =>
            element.classList.contains('sfn-open'),
        );

        expect(pageErrors).toEqual([]);
        expect(violations.filter((text) => /content security policy|securitypolicyviolation/i.test(text))).toEqual([]);
        expect(panelOpen).toBe(true);

        await page.close();
    }, 30_000);

    it('logs a policy violation when the nonce is wrong, proving the CSP is actually enforced', async () => {
        const { html } = generateHtml({ aslDefinition: parallelFixture, nonce: NONCE });
        // Stamp a CSP that does not match the document's nonce - the negative control
        // confirming the assertions above would actually catch a real violation.
        const withMismatchedCsp = html.replace('<head>', `<head>\n${strictCspMeta('a-different-nonce')}`);

        page = await browser.newPage();
        const consoleMessages: string[] = [];
        page.on('console', (message) => consoleMessages.push(message.text()));

        await page.setContent(withMismatchedCsp, { waitUntil: 'load' });

        expect(
            consoleMessages.some((text) => /content security policy/i.test(text)),
        ).toBe(true);

        await page.close();
    }, 30_000);
});
