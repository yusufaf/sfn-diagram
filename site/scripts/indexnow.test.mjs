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

    it('falls back to the whole page without a <main>', () => {
        expect(pageContent('<body>hi</body>')).toBe('<body>hi</body>');
    });
});

describe('changedUrls', () => {
    it('lists changed, new and removed pages, not unchanged ones', () => {
        const previous = { '/same': 'a', '/edited': 'b', '/removed': 'c' };
        const current = { '/same': 'a', '/edited': 'B', '/new': 'd' };
        expect(changedUrls({ current, previous })).toEqual([
            '/edited',
            '/new',
            '/removed',
        ]);
    });

    it('lists every page when nothing was deployed before', () => {
        expect(
            changedUrls({ current: { '/a': '1', '/b': '2' }, previous: {} }),
        ).toEqual(['/a', '/b']);
    });
});
