#!/usr/bin/env node
/**
 * Regenerate the diagram gallery images used on the docs site's gallery page
 * and, as light/dark SVG pairs, committed under `docs/images/gallery/` (same
 * git-tracked convention as `generate-doc-images.mjs` — see #49). Copied
 * verbatim into `site/public/gallery/` so the Astro build can serve them as
 * static assets with no extra CI step.
 *
 * The gallery shows each SVG through `<img>`, and a browser loads nothing external
 * for an SVG used that way, so service icons are embedded as data URIs. They come
 * from the `aws-icons` dev dependency, never from jsDelivr.
 *
 * `--check` writes nothing and fails when a committed file differs from what this
 * script would write, or when a gallery directory holds a file it does not write
 * (#685); CI runs it through `pnpm run check:images`.
 *
 * Usage: pnpm run gallery:images
 */
import { embedIcons, generateSvg } from '../dist/index.js';
import { runAsScript } from './lib/cliScript.mjs';
import {
    REGENERATE_COMMAND,
    createLocalIconFetch,
    embedIconsLocally,
    resolveAwsIconsPackage,
    writeOrCheckImages,
} from './lib/docImages.mjs';
import { readAslFixture, repoRootFrom } from './lib/repo-paths.mjs';

const repoRoot = repoRootFrom(import.meta.url);
const OUTPUT_DIRS = ['docs/images/gallery', 'site/public/gallery'];

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
        fixture: 'service-integrations',
        layout: 'TB',
        // 220 fits every Comment beside its icon; revisit once #411 wraps long names.
        nodeWidth: 220,
        showIcons: true,
        slug: 'services',
    },
];

await runAsScript({
    importMetaUrl: import.meta.url,
    main: async ({ check = false }) => {
        const iconsPackage = resolveAwsIconsPackage({ repoRoot });
        const iconFetch = createLocalIconFetch({
            iconsPackageDir: iconsPackage.dir,
            iconsVersion: iconsPackage.version,
        });

        /** @type {Map<string, string>} */
        const expected = new Map();
        /** @type {{ caption: string; slug: string }[]} */
        const manifest = [];

        for (const { caption, fixture, layout, nodeWidth, showIcons, slug } of GALLERY_ITEMS) {
            const aslDefinition = readAslFixture(repoRoot, fixture);

            for (const theme of /** @type {const} */ (['light', 'dark'])) {
                let { svg } = generateSvg({ aslDefinition, layout, nodeWidth, showIcons, theme });
                if (showIcons) svg = await embedIconsLocally({ embedIcons, iconFetch, svg });
                for (const dir of OUTPUT_DIRS) expected.set(`${dir}/${slug}-${theme}.svg`, svg);
            }
            manifest.push({ caption, slug });
        }
        expected.set('docs/images/gallery/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

        await writeOrCheckImages({
            check,
            expected,
            ownedDirs: OUTPUT_DIRS,
            regenerateCommand: REGENERATE_COMMAND,
            repoRoot,
        });
    },
    options: { check: { type: 'boolean' } },
    usage: 'generate-gallery-images.mjs [--check]',
});
