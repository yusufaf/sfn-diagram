// @ts-check
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import { rm } from 'node:fs/promises'
import { defineConfig } from 'astro/config'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightPageActions from 'starlight-page-actions'
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc'

const SITE = 'https://sfn.yusufaf.dev'

/**
 * Drop the package-overview page TypeDoc emits for a multi-entry-point project.
 *
 * With four entry points TypeDoc writes a root `README.md` whose body is empty
 * and whose links all point at per-module readme pages it never emits (the
 * plugin defaults to `readme: 'none'`). The hand-written reference landing page
 * at `/reference/` replaces it, so this removes the orphan rather than leaving
 * four broken links in the sitemap and search index.
 *
 * @returns {import('astro').AstroIntegration} An Astro integration that deletes
 *   the page after the build.
 */
function removeTypeDocOverviewPage() {
    return {
        hooks: {
            'astro:build:done': async ({ dir }) => {
                await rm(new URL('reference/readme/', dir), {
                    force: true,
                    recursive: true,
                })
            },
        },
        name: 'remove-typedoc-overview-page',
    }
}

export default defineConfig({
    base: '/',
    integrations: [
        react(),
        removeTypeDocOverviewPage(),
        starlight({
            components: {
                Head: './src/components/Head.astro',
            },
            customCss: ['./src/styles/custom.css'],
            description:
                'Generate SVG, Mermaid, HTML, and PNG diagrams from AWS Step Functions ASL definitions, CloudFormation/CDK templates, or live AWS state machines.',
            editLink: {
                baseUrl: 'https://github.com/yusufaf/sfn-diagram/edit/main/site/',
            },
            plugins: [
                starlightTypeDoc({
                    entryPoints: [
                        '../src/index.ts',
                        '../src/png.ts',
                        '../src/aws.ts',
                        '../src/cfn.ts',
                    ],
                    output: 'reference',
                    sidebar: { collapsed: true, label: 'API Reference' },
                    tsconfig: '../tsconfig.json',
                    typeDoc: {
                        entryPointStrategy: 'resolve',
                        excludeInternal: true,
                        excludePrivate: true,
                        // The generated readme page comes out empty and links to
                        // per-module readmes that are never emitted; the
                        // hand-written reference landing page replaces it.
                        readme: 'none',
                        useCodeBlocks: true,
                    },
                }),
                // `baseUrl` is deliberately omitted: setting it makes this plugin
                // emit its own URL-list llms.txt, which would collide with the
                // richer content-bearing one from starlight-llms-txt below.
                starlightPageActions({
                    actions: {
                        chatgpt: true,
                        claude: true,
                        cursor: true,
                        githubCopilot: true,
                        markdown: true,
                        perplexity: false,
                        t3chat: false,
                        v0: false,
                    },
                    position: 'page-title',
                    prompt:
                        'Read {url} — documentation for sfn-diagram, a library that generates SVG, Mermaid, HTML, and PNG diagrams from AWS Step Functions ASL definitions. Use it to answer my questions about this page.',
                    share: false,
                }),
                starlightLlmsTxt({
                    description:
                        'Generate SVG, Mermaid, HTML, and PNG diagrams from AWS Step Functions ASL (Amazon States Language) definitions, CloudFormation/SAM/CDK templates, or live AWS state machines. Runs in Node, the browser, and edge runtimes.',
                    details: [
                        'Core (`sfn-diagram`) is platform-agnostic. Only `sfn-diagram/png` and the CLI are Node-only.',
                        'Four entry points: `sfn-diagram` (SVG/Mermaid/HTML), `sfn-diagram/png`, `sfn-diagram/aws`, `sfn-diagram/cfn`.',
                    ].join('\n'),
                    demote: ['ecosystem/**'],
                    // `exclude` applies to llms-small.txt only — llms-full.txt is
                    // the complete corpus by design. Keeping the exhaustive
                    // TypeDoc reference out of the abridged set leaves it as
                    // usable prose for small context windows.
                    exclude: ['reference/**'],
                    promote: ['introduction', 'installation', 'quick-start', 'guides/**'],
                    optionalLinks: [
                        {
                            description: 'Interactive editor — paste ASL, see the diagram.',
                            label: 'Playground',
                            url: `${SITE}/playground`,
                        },
                        {
                            description: 'Source, issues, and releases.',
                            label: 'GitHub repository',
                            url: 'https://github.com/yusufaf/sfn-diagram',
                        },
                    ],
                    projectName: 'sfn-diagram',
                }),
            ],
            sidebar: [
                {
                    items: [
                        { label: 'Introduction', slug: 'introduction' },
                        { label: 'Installation', slug: 'installation' },
                        { label: 'Quick start', slug: 'quick-start' },
                    ],
                    label: 'Getting started',
                },
                {
                    items: [{ autogenerate: { directory: 'guides' } }],
                    label: 'Guides',
                },
                typeDocSidebarGroup,
                {
                    items: [{ autogenerate: { directory: 'ecosystem' } }],
                    label: 'Ecosystem',
                },
            ],
            social: [
                {
                    href: 'https://github.com/yusufaf/sfn-diagram',
                    icon: 'github',
                    label: 'GitHub',
                },
            ],
            title: 'sfn-diagram',
        }),
    ],
    site: SITE,
})
