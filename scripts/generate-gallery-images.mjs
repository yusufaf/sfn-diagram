#!/usr/bin/env node
/**
 * Regenerate the diagram gallery images used on the docs site's gallery page
 * and, as light/dark SVG pairs, committed under `docs/images/gallery/` (same
 * git-tracked convention as `generate-doc-images.mjs` — see #49). Copied
 * verbatim into `site/public/gallery/` so the Astro build can serve them as
 * static assets with no extra CI step.
 *
 * Usage: pnpm run gallery:images
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSvg } from '../dist/index.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const outputDirs = [
    join(repoRoot, 'docs', 'images', 'gallery'),
    join(repoRoot, 'site', 'public', 'gallery'),
];

/** One card per pattern: which fixture renders it, and a caption for the gallery page. */
const GALLERY_ITEMS = [
    { caption: 'A minimal two-state workflow.', fixture: 'simple', layout: 'LR', slug: 'simple' },
    { caption: 'Branching logic with a Choice state.', fixture: 'choice', layout: 'TB', slug: 'choice' },
    {
        caption: 'Concurrent branches with a Parallel state.',
        fixture: 'parallel',
        layout: 'TB',
        slug: 'parallel',
    },
    { caption: 'Iterating over items with a Map state.', fixture: 'map', layout: 'TB', slug: 'map' },
    {
        caption: 'Large-scale iteration with a Distributed Map.',
        fixture: 'distributed-map',
        layout: 'TB',
        slug: 'distributed-map',
    },
    {
        caption: 'Catch blocks rendered as dashed error edges.',
        fixture: 'error-handling',
        layout: 'TB',
        slug: 'error-handling',
    },
    {
        caption: 'A Retry policy rendered as a labelled self-loop.',
        fixture: 'retry',
        layout: 'TB',
        slug: 'retry',
    },
    {
        caption: 'AWS service integrations shown with service icons.',
        fixture: 'services',
        layout: 'LR',
        showIcons: true,
        slug: 'services',
    },
];

for (const dir of outputDirs) mkdirSync(dir, { recursive: true });

/** @type {{ caption: string; slug: string }[]} */
const manifest = [];

for (const { caption, fixture, layout, showIcons, slug } of GALLERY_ITEMS) {
    const fixturePath = join(repoRoot, 'tests', 'fixtures', `${fixture}.asl.json`);
    const aslDefinition = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    for (const theme of /** @type {const} */ (['light', 'dark'])) {
        const { svg } = generateSvg({ aslDefinition, layout, showIcons, theme });
        const fileName = `${slug}-${theme}.svg`;
        for (const dir of outputDirs) {
            writeFileSync(join(dir, fileName), svg, 'utf-8');
        }
    }
    manifest.push({ caption, slug });
    console.log(`✓ ${slug} (${fixture}, light + dark)`);
}

writeFileSync(
    join(repoRoot, 'docs', 'images', 'gallery', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
);
