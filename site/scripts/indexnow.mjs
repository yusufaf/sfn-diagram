#!/usr/bin/env node
// IndexNow tells Bing (and the other engines that share it) which pages
// changed, so they recrawl them soon instead of whenever they next read the
// sitemap. Google ignores it.
//
// Runs after `astro build`. It hashes every page in the sitemap, writes the
// hashes to dist/indexnow-pages.json, and compares them with the copy the live
// site still serves. The changed URLs go to indexnow-request.json, which the
// workflow POSTs once the new build is deployed. The live copy records what
// was last deployed, so this needs no Actions cache, which expires after a week.
//
// Usage: node scripts/indexnow.mjs <distDir> <siteUrl> <key>

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'indexnow-pages.json';

export function sitemapUrls(xml) {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
}

export function pageFile(distDir, url) {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return path.join(
        distDir,
        pathname.endsWith('/') ? `${pathname}index.html` : pathname,
    );
}

export function changedUrls(current, previous) {
    return Object.keys(current).filter((url) => current[url] !== previous[url]);
}

async function hashPages(distDir) {
    const sitemaps = (await readdir(distDir)).filter((name) =>
        /^sitemap-\d+\.xml$/.test(name),
    );
    const pages = {};
    for (const sitemap of sitemaps) {
        for (const url of sitemapUrls(
            await readFile(path.join(distDir, sitemap), 'utf8'),
        )) {
            const html = await readFile(pageFile(distDir, url));
            pages[url] = createHash('sha256').update(html).digest('hex');
        }
    }
    return pages;
}

// A missing or unreadable live copy means every page is submitted, which is
// harmless; failing here would block the docs deploy over a crawl hint.
async function livePages(siteUrl) {
    try {
        const response = await fetch(new URL(MANIFEST, siteUrl));
        if (response.ok) return await response.json();
        if (response.status !== 404)
            console.warn(
                `${MANIFEST}: HTTP ${response.status}, submitting every page`,
            );
    } catch (error) {
        console.warn(`${MANIFEST}: ${error.message}, submitting every page`);
    }
    return {};
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const [distDir, siteUrl, key] = process.argv.slice(2);
    if (!distDir || !siteUrl || !key) {
        throw new Error(
            'usage: node scripts/indexnow.mjs <distDir> <siteUrl> <key>',
        );
    }

    const pages = await hashPages(distDir);
    if (Object.keys(pages).length === 0)
        throw new Error(`no sitemap pages found in ${distDir}`);
    await writeFile(path.join(distDir, MANIFEST), JSON.stringify(pages));

    const urlList = changedUrls(pages, await livePages(siteUrl));
    await writeFile(
        'indexnow-request.json',
        JSON.stringify({ host: new URL(siteUrl).host, key, urlList }),
    );
    console.log(
        `IndexNow: ${urlList.length} of ${Object.keys(pages).length} pages changed`,
    );
}
