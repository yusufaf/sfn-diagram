import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser } from 'puppeteer';
import { generateSvg } from '../src';
import { escapeAttribute, escapeText } from '../src/renderers/svgBuilder';
import type { AslDefinition } from '../src/types';

/**
 * SVG is XML, so the HTML named entity for no-break space is undefined there and
 * XML-strict consumers (resvg, browsers opening the file, Inkscape) reject it (#459).
 */

const NBSP_DEFINITION: AslDefinition = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'nbsp-names.asl.json'), 'utf-8'),
);

describe('escapers', () => {
    it('writes U+00A0 as a numeric character reference in text', () => {
        expect(escapeText('a b')).toBe('a&#160;b');
    });

    it('writes U+00A0 as a numeric character reference in attributes', () => {
        expect(escapeAttribute('a b')).toBe('a&#160;b');
    });
});

describe('generateSvg output is well-formed XML (#459)', () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    }, 60_000);

    afterAll(async () => {
        await browser?.close();
    });

    it('parses as image/svg+xml with no parsererror when names contain U+00A0', async () => {
        const { svg } = generateSvg({ aslDefinition: NBSP_DEFINITION });
        const page = await browser.newPage();
        try {
            const result = await page.evaluate((markup) => {
                const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
                return {
                    error: doc.getElementsByTagName('parsererror')[0]?.textContent ?? null,
                    stateIds: [...doc.querySelectorAll('[data-state-id]')].map((element) =>
                        element.getAttribute('data-state-id'),
                    ),
                };
            }, svg);

            expect(result.error).toBeNull();
            expect(result.stateIds).toContain('Charge Card');
        } finally {
            await page.close();
        }
    });
});
