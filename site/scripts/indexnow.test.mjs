import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    changedUrls,
    pageContent,
    pageFile,
    sitemapUrls,
} from './indexnow.mjs';

describe('sitemapUrls', () => {
    it('reads every <loc> from a sitemap', () => {
        const xml =
            '<urlset><url><loc>https://sfn.yusufaf.dev/</loc></url>' +
            '<url><loc>https://sfn.yusufaf.dev/comparison/</loc><lastmod>2026-10-01</lastmod></url></urlset>';
        expect(sitemapUrls(xml)).toEqual([
            'https://sfn.yusufaf.dev/',
            'https://sfn.yusufaf.dev/comparison/',
        ]);
    });

    it('unescapes XML entities', () => {
        expect(
            sitemapUrls('<loc>https://sfn.yusufaf.dev/a&amp;b/</loc>'),
        ).toEqual(['https://sfn.yusufaf.dev/a&b/']);
    });
});

describe('pageFile', () => {
    it('maps a directory URL to its index.html', () => {
        expect(
            pageFile({
                distDir: 'dist',
                url: 'https://sfn.yusufaf.dev/reference/cli/',
            }),
        ).toBe(path.join('dist', 'reference', 'cli', 'index.html'));
        expect(
            pageFile({ distDir: 'dist', url: 'https://sfn.yusufaf.dev/' }),
        ).toBe(path.join('dist', 'index.html'));
    });

    it('keeps a file URL as is and decodes it', () => {
        expect(
            pageFile({
                distDir: 'dist',
                url: 'https://sfn.yusufaf.dev/a%20b.html',
            }),
        ).toBe(path.join('dist', 'a b.html'));
    });
});

describe('pageContent', () => {
    it('ignores everything outside <main>', () => {
        const page = (sidebar, body) =>
            `<head>${sidebar}</head><nav>${sidebar}</nav><main class="x">${body}</main>`;
        expect(pageContent(page('old', 'text'))).toBe(
            pageContent(page('new', 'text')),
        );
        expect(pageContent(page('same', 'text'))).not.toBe(
            pageContent(page('same', 'edited')),
        );
    });

    it('ignores build fingerprints but not head tags a search engine shows', () => {
        const page = ({ asset, cls, title }) =>
            `<title>${title}</title><main class="${cls}"><link href="/_astro/${asset}.css">Text</main>`;
        const base = { asset: 'ec.a1b2c', cls: 'astro-abcd1234', title: 'CLI' };
        expect(pageContent(page(base))).toBe(
            pageContent(
                page({ ...base, asset: 'ec.z9y8x', cls: 'astro-zzzz9999' }),
            ),
        );
        expect(pageContent(page(base))).not.toBe(
            pageContent(page({ ...base, title: 'sfn-diagram CLI' })),
        );
    });

    it('falls back to the whole page without a <main>', () => {
        expect(pageContent('<body>hi</body>')).toBe('<body>hi</body>');
    });
});

describe('changedUrls', () => {
    it('lists changed, new and removed pages, not unchanged ones', () => {
        const previous = {
            'https://s.dev/same': 'a',
            'https://s.dev/edited': 'b',
            'https://s.dev/removed': 'c',
        };
        const current = {
            'https://s.dev/same': 'a',
            'https://s.dev/edited': 'B',
            'https://s.dev/new': 'd',
        };
        expect(changedUrls({ current, previous })).toEqual([
            'https://s.dev/edited',
            'https://s.dev/new',
            'https://s.dev/removed',
        ]);
    });

    it('drops removed URLs from another host, which would void the request', () => {
        const current = { 'https://sfn.yusufaf.dev/': 'a' };
        const previous = {
            'https://sfn.yusufaf.dev/': 'a',
            'https://old.example/gone/': 'b',
        };
        expect(changedUrls({ current, previous })).toEqual([]);
    });

    it('lists every page when nothing was deployed before', () => {
        expect(
            changedUrls({
                current: { 'https://s.dev/a': '1', 'https://s.dev/b': '2' },
                previous: {},
            }),
        ).toEqual(['https://s.dev/a', 'https://s.dev/b']);
    });
});
