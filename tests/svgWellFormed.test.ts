import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Browser } from 'puppeteer';
import { generateHtml, generateSvg } from '../src';
import { exportPng } from '../src/png';
import { escapeAttribute, escapeText } from '../src/renderers/svgBuilder';
import type { AslDefinition } from '../src/types';

/**
 * SVG is XML, so the HTML named entity for no-break space is undefined there and
 * XML-strict consumers (resvg, browsers opening the file, Inkscape) reject it (#459).
 * XML 1.0 also forbids some characters outright, even as references (#463).
 */

const NBSP_DEFINITION: AslDefinition = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'nbsp-names.asl.json'), 'utf-8'),
);

const FORBIDDEN_DEFINITION: AslDefinition = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'xml-forbidden-names.asl.json'), 'utf-8'),
);

const REPLACEMENT = String.fromCharCode(0xfffd);

/** C0 controls other than tab, LF and CR, both noncharacters, and lone surrogates of each half. */
const FORBIDDEN_CODES = [0x00, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0xfffe, 0xffff, 0xd800, 0xdfff];

describe('escapers', () => {
    it('writes U+00A0 as a numeric character reference in text', () => {
        expect(escapeText('a\u00A0b')).toBe('a&#160;b');
    });

    it('writes U+00A0 as a numeric character reference in attributes', () => {
        expect(escapeAttribute('a\u00A0b')).toBe('a&#160;b');
    });

    it('replaces each character XML forbids with U+FFFD in text and attributes', () => {
        for (const code of FORBIDDEN_CODES) {
            const value = `a${String.fromCharCode(code)}b`;
            expect(escapeText(value), code.toString(16)).toBe(`a${REPLACEMENT}b`);
            expect(escapeAttribute(value), code.toString(16)).toBe(`a${REPLACEMENT}b`);
        }
    });

    it('keeps tab, line feed, carriage return and characters outside the BMP', () => {
        const value = `a\tb\nc\rd${String.fromCodePoint(0x1f680)}`;
        expect(escapeText(value)).toBe(value);
        expect(escapeAttribute(value)).toBe(value);
    });
});

describe('characters XML forbids in a definition (#463)', () => {
    it('leaves none of them in the SVG', () => {
        const { svg } = generateSvg({ aslDefinition: FORBIDDEN_DEFINITION });
        for (const code of [0x01, 0x07, 0x0b, 0x0c, 0xffff, 0xd800]) {
            expect(svg.includes(String.fromCharCode(code)), code.toString(16)).toBe(false);
        }
        expect(svg).toContain(`Route${REPLACEMENT}A`);
    });

    it('exports to PNG', async () => {
        const result = await exportPng({ aslDefinition: FORBIDDEN_DEFINITION });
        expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('keys the viewer state data by the same ids the nodes carry', () => {
        const { html } = generateHtml({ aslDefinition: FORBIDDEN_DEFINITION });
        const start = html.indexOf('id="sfn-state-data">') + 'id="sfn-state-data">'.length;
        const stateIds = Object.keys(JSON.parse(html.slice(start, html.indexOf('</script>', start))));
        const renderedIds = new Set([...html.matchAll(/data-state-id="([^"]*)"/g)].map((match) => match[1]));

        expect(stateIds).toHaveLength(4);
        expect(stateIds.filter((id) => !renderedIds.has(id))).toEqual([]);
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
            expect(result.stateIds).toContain('Charge\u00A0Card');
        } finally {
            await page.close();
        }
    });

    it('parses as image/svg+xml with no parsererror when names contain characters XML forbids', async () => {
        const { svg } = generateSvg({ aslDefinition: FORBIDDEN_DEFINITION });
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
            expect(result.stateIds).toContain(`Charge${REPLACEMENT}Card`);
        } finally {
            await page.close();
        }
    });
});
