#!/usr/bin/env node
// IndexNow tells Bing (and the other engines that share it) which pages
// changed, so they recrawl them soon instead of whenever they next read the
// sitemap. Google ignores it.
//
// Runs after `astro build`. It hashes the <main> content of every page in the
// sitemap, writes the hashes to dist/indexnow-pages.json, and compares them
// with the copy the live site still serves. Changed, new and removed URLs go to
// indexnow-request.json, which the workflow POSTs once the new build is
// deployed. The live copy records what was last deployed, so this needs no
// Actions cache, which expires after a week.
//
// The host comes from the sitemap and the key from the one <key>.txt in
// public/, so neither can drift from what the site actually serves.
//
// Usage (from site/): node scripts/indexnow.mjs <distDir>

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const MANIFEST = 'indexnow-pages.json';
const REQUEST = 'indexnow-request.json';
const KEY_FILE = /^([a-f0-9]{32})\.txt$/;

const XML_ENTITIES = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };

/**
 * Reads every `<loc>` URL from a sitemap, unescaping XML entities.
 *
 * @param {string} xml - Sitemap XML, as Astro writes it.
 * @returns {string[]} Absolute page URLs, in sitemap order.
 * @example sitemapUrls('<loc>https://sfn.yusufaf.dev/a&amp;b/</loc>') // ['https://sfn.yusufaf.dev/a&b/']
 */
export function sitemapUrls(xml) {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) =>
        loc
            .trim()
            .replace(
                /&(amp|apos|gt|lt|quot);/g,
                (_, name) => XML_ENTITIES[name],
            ),
    );
}

/**
 * Maps a page URL to the built file that serves it.
 *
 * @param {{ distDir: string, url: string }} params - The build output folder and an absolute page URL.
 * @returns {string} `<distDir>/<path>/index.html` for a directory URL, otherwise `<distDir>/<path>`.
 * @example pageFile({ distDir: 'dist', url: 'https://sfn.yusufaf.dev/reference/cli/' }) // 'dist/reference/cli/index.html'
 */
export function pageFile({ distDir, url }) {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return path.join(
        distDir,
        pathname.endsWith('/') ? `${pathname}index.html` : pathname,
    );
}

/**
 * Returns the part of a page worth hashing: what a search engine shows for it
 * (title, description, robots and canonical tags, and its `<main>` content),
 * minus build fingerprints (`/_astro/` asset names, `astro-xxxx` classes). The
 * sidebar is on every page and fingerprints change on any Astro upgrade, so
 * hashing either would mark the whole site changed.
 *
 * @param {string} html - A built page.
 * @returns {string} Those head tags and the `<main>` element (or the whole page if it has none).
 */
export function pageContent(html) {
    const head =
        html.match(
            /<title>[\s\S]*?<\/title>|<meta name="(description|robots)"[^>]*>|<link rel="canonical"[^>]*>/g,
        ) ?? [];
    const main = html.match(/<main[\s>][\s\S]*<\/main>/)?.[0] ?? html;
    return [...head, main]
        .join('\n')
        .replace(/\/_astro\/[^"'\s)]+/g, '')
        .replace(/\bastro-[a-z0-9]{8}\b/g, '');
}

/**
 * Lists the URLs IndexNow should hear about: changed, new and removed pages.
 * Removed URLs on another host are dropped, since a request may only name its own host.
 *
 * @param {{ current: Record<string, string>, previous: Record<string, string> }} params -
 *   Page hashes keyed by URL, for this build and for the live site.
 * @returns {string[]} Changed and new URLs, then removed ones.
 * @example changedUrls({ current: { '/a': '2' }, previous: { '/a': '1', '/b': '1' } }) // ['/a', '/b']
 */
export function changedUrls({ current, previous }) {
    const changed = Object.keys(current).filter(
        (url) => current[url] !== previous[url],
    );
    // A request may only name URLs on its own host, so drop any left over from
    // a different domain.
    const host = new URL(Object.keys(current)[0] ?? 'http://invalid').host;
    const removed = Object.keys(previous).filter(
        (url) => !(url in current) && new URL(url).host === host,
    );
    return [...changed, ...removed];
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
            const html = await readFile(pageFile({ distDir, url }), 'utf8');
            pages[url] = createHash('sha256')
                .update(pageContent(html))
                .digest('hex');
        }
    }
    return pages;
}

async function findKey(distDir) {
    const keys = (await readdir(distDir))
        .map((name) => name.match(KEY_FILE)?.[1])
        .filter(Boolean);
    if (keys.length !== 1)
        throw new Error(
            `expected one IndexNow key file in ${distDir}, found ${keys.length}`,
        );
    return keys[0];
}

// A missing or unreadable live copy means every page is submitted, which is
// harmless. The query string skips the Pages CDN's ten-minute cache.
async function livePages(origin) {
    const url = new URL(`${MANIFEST}?t=${Date.now()}`, origin);
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
            const pages = await response.json();
            if (pages && typeof pages === 'object' && !Array.isArray(pages))
                return pages;
            console.warn(`${MANIFEST}: not an object, submitting every page`);
        } else if (response.status !== 404) {
            console.warn(
                `${MANIFEST}: HTTP ${response.status}, submitting every page`,
            );
        }
    } catch (error) {
        console.warn(`${MANIFEST}: ${error.message}, submitting every page`);
    }
    return {};
}

async function plan(distDir) {
    const pages = await hashPages(distDir);
    const urls = Object.keys(pages);
    if (urls.length === 0)
        throw new Error(`no sitemap pages found in ${distDir}`);
    const { host, origin } = new URL(urls[0]);
    const key = await findKey(distDir);

    const urlList = changedUrls({
        current: pages,
        previous: await livePages(origin),
    });
    await writeFile(REQUEST, JSON.stringify({ host, key, urlList }));
    // Last, so a failure above leaves no manifest and the next deploy submits everything.
    await writeFile(path.join(distDir, MANIFEST), JSON.stringify(pages));
    console.log(
        `IndexNow: ${urlList.length} URLs to submit (${urls.length} pages)`,
    );
}

// A crawl hint must never block a docs deploy: on any failure, warn and
// submit nothing. This deploy then ships no manifest, so the next one submits
// every page.
if (import.meta.main) {
    const [distDir] = process.argv.slice(2);
    try {
        if (!distDir)
            throw new Error('usage: node scripts/indexnow.mjs <distDir>');
        await plan(distDir);
    } catch (error) {
        console.log(`::warning title=IndexNow::${error.message}`);
        await writeFile(REQUEST, JSON.stringify({ urlList: [] }));
    }
}
