import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

const MIGRATION_PAGE = 'site/src/content/docs/upgrading-to-v2.md';

/**
 * The 1.x names 2.0 removed. The `@deprecated` tags that named them are gone from
 * `src/`, so the list is fixed here.
 */
const REMOVED_IN_2 = [
    'ConvertParams.height',
    'DiagramOptions.height',
    'DiagramOptions.pngQuality',
    'DiagramOptions.width',
    'LayoutCache.get',
    'LayoutCache.keyFor',
    'LayoutCache.set',
    'RelayoutModel.callerOverrides',
    'RelayoutModel.collapseTargets',
    'RelayoutModel.diffChangedIds',
    'RelayoutModel.edges',
    'RelayoutModel.executionStatusByNodeId',
    'RelayoutModel.nodes',
    'RelayoutModel.options',
    'buildViewerContent',
    'html-to-image',
    'node-html-to-image',
    'resolveViewerTheme',
];

/** One issue per `BREAKING CHANGE:` commit since `sfn-diagram-v1.10.0`. */
const BREAKING_ISSUES = [285, 309, 321, 408, 524, 525, 526, 527, 528, 555, 615];

/**
 * Read a repo file with its line endings normalised to `\n`, since Windows checkouts
 * are CRLF. Called inside each test rather than at module scope, so a missing page
 * fails only the tests that need it.
 */
function readRepoFile(relativePath: string): string {
    return readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/** Parameters for {@link collectBreakingSections}. */
interface CollectBreakingSectionsParams {
    /** The migration guide's Markdown, with `\n` line endings. */
    page: string;
}

/** One `###` section under the guide's `## Breaking changes` heading. */
interface BreakingSection {
    /** Everything after the heading line, up to the next `###` or `##`. */
    body: string;
    /** The heading line, without the leading `### `. */
    heading: string;
    /** The issue numbers linked from the heading. */
    issues: number[];
}

/**
 * Splits the guide's `## Breaking changes` section into its `###` sections. Fenced code
 * blocks are dropped first, so a `#` comment line inside one can't start or end a section.
 *
 * @param params - The page to read.
 * @returns The sections in page order.
 * @throws When the page has no line that is exactly `## Breaking changes`, so a renamed
 * heading fails loudly instead of leaving nothing to check.
 * @example
 * collectBreakingSections({ page: '## Breaking changes\n\n### A ([#1](https://github.com/o/r/issues/1))\nBody\n' });
 * // [{ body: 'Body\n', heading: 'A ([#1](https://github.com/o/r/issues/1))', issues: [1] }]
 */
function collectBreakingSections(params: CollectBreakingSectionsParams): BreakingSection[] {
    const { page } = params;
    const prose = page.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '');
    const start = /^## Breaking changes$/m.exec(prose);
    if (!start) {
        throw new Error('migration guide has no "## Breaking changes" section');
    }
    const rest = prose.slice(start.index + start[0].length);
    const end = rest.indexOf('\n## ');
    const section = end === -1 ? rest : rest.slice(0, end);
    return section
        .split(/^### /m)
        .slice(1)
        .map((chunk) => {
            const newline = chunk.indexOf('\n');
            const heading = newline === -1 ? chunk : chunk.slice(0, newline);
            return {
                body: newline === -1 ? '' : chunk.slice(newline + 1),
                heading,
                issues: [...heading.matchAll(/issues\/(\d+)/g)].map((match) => Number(match[1])),
            };
        });
}

/** Parameters for {@link extractRemovedIn2Declarations}. */
interface ExtractRemovedIn2DeclarationsParams {
    /** Path reported when a declaration shape is not recognised. */
    fileName: string;
    /** TypeScript source to scan. */
    source: string;
}

/**
 * Names every declaration whose `@deprecated` tag mentions 2.0, as `name` for a
 * top-level export or `Container.member` for an interface/class member.
 *
 * Only the `@deprecated` text up to the next block tag counts, so a 2.0 mention in an
 * `@see` line does not, while a `{@link}` before "2.0" inside the tag does.
 *
 * @param params - The file name (for errors) and its source.
 * @returns Names in source order.
 * @throws When the line after a matching block is no declaration shape this knows, so a
 * new shape fails the guard instead of silently dropping out of it.
 * @example
 * extractRemovedIn2Declarations({ fileName: 'a.ts', source: '/** @deprecated removed in 2.0 *\/\nexport function old() {}' }); // ['old']
 */
function extractRemovedIn2Declarations(
    params: ExtractRemovedIn2DeclarationsParams,
): string[] {
    const { fileName, source } = params;
    const names: string[] = [];
    for (const match of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        const block = match[0];
        const tagStart = block.indexOf('@deprecated');
        if (tagStart === -1) {
            continue;
        }
        const tagText = block
            .slice(tagStart + '@deprecated'.length)
            .split(/\n\s*\*\s*@/)[0];
        if (!/\b2\.0\b/.test(tagText)) {
            continue;
        }
        const blockEnd = match.index + block.length;
        const line =
            source
                .slice(blockEnd)
                .split(/\r?\n/)
                .find((candidate) => candidate.trim() !== '') ?? '';
        const exported =
            /^export (?:(?:abstract|async|declare|default) )*(?:function|const|class) (\w+)/.exec(
                line,
            );
        if (exported) {
            names.push(exported[1]);
            continue;
        }
        const member = /^\s*(?:readonly\s+)?(\w+)\??[(:]/.exec(line);
        const containers = [
            ...source
                .slice(0, match.index)
                .matchAll(
                    /^export (?:(?:abstract|declare|default) )*(?:interface|class|type) (\w+)/gm,
                ),
        ];
        const container = containers.at(-1)?.[1];
        if (member && container) {
            names.push(`${container}.${member[1]}`);
            continue;
        }
        throw new Error(
            `${fileName}: unrecognised declaration after a 2.0 @deprecated tag: ${line}`,
        );
    }
    return names;
}

/** Parameters for {@link collectRemovedIn2Declarations}. */
interface CollectRemovedIn2DeclarationsParams {
    /** Directory to walk for `.ts` sources. */
    sourceRoot: string;
}

/**
 * Runs {@link extractRemovedIn2Declarations} over every hand-written `.ts` file under
 * `sourceRoot`, skipping declaration files and generated bundles.
 *
 * @param params - The directory to walk.
 * @returns Sorted, de-duplicated names.
 * @example
 * collectRemovedIn2Declarations({ sourceRoot: join(repoRoot, 'src') }); // ['Container.member', 'topLevelName', …]
 */
function collectRemovedIn2Declarations(
    params: CollectRemovedIn2DeclarationsParams,
): string[] {
    const { sourceRoot } = params;
    const names = new Set<string>();
    const files = readdirSync(sourceRoot, {
        recursive: true,
        encoding: 'utf8',
    }).filter(
        (file) =>
            file.endsWith('.ts') &&
            !file.endsWith('.d.ts') &&
            !file.endsWith('.generated.ts'),
    );
    for (const file of files) {
        const source = readFileSync(join(sourceRoot, file), 'utf8');
        for (const name of extractRemovedIn2Declarations({
            fileName: file,
            source,
        })) {
            names.add(name);
        }
    }
    return [...names].sort();
}

describe('versioning docs', () => {
    it('extracts 2.0 deprecations from JSDoc', () => {
        const fixture = [
            '/** @deprecated Gone; removed in 2.0. */',
            'export function oldFn(): void {}',
            '',
            'export interface Box {',
            '    /**',
            '     * Size.',
            '     * @deprecated Use {@link Other.scale} instead; removed in 2.0.',
            '     */',
            '    size?: number;',
            '    /** @deprecated No replacement. */',
            '    kept: string;',
            '    /**',
            '     * @deprecated Legacy.',
            '     * @see the 2.0 plan',
            '     */',
            '    legacy: string;',
            '}',
            '',
            'export abstract class Shape {',
            '    /** @deprecated removed in 2.0 */',
            '    area(): number {',
            '        return 0;',
            '    }',
            '}',
        ].join('\n');
        expect(
            extractRemovedIn2Declarations({
                fileName: 'fixture.ts',
                source: fixture,
            }),
        ).toEqual(['oldFn', 'Box.size', 'Shape.area']);
        expect(() =>
            extractRemovedIn2Declarations({
                fileName: 'enum-fixture.ts',
                source: '/** @deprecated removed in 2.0 */\nexport enum Mode {\n    On,\n}',
            }),
        ).toThrow(/unrecognised declaration/);
    });

    it('leaves no @deprecated tag promising a 2.0 removal', () => {
        expect(collectRemovedIn2Declarations({ sourceRoot: join(repoRoot, 'src') })).toEqual([]);
    });

    it('names every 1.x API that 2.0 removed on the migration guide', () => {
        const page = readRepoFile(MIGRATION_PAGE);
        const missing = REMOVED_IN_2.filter((name) => !page.includes(`\`${name}\``));
        expect(missing).toEqual([]);
    });

    it('gives every breaking change a before and after', () => {
        const sections = collectBreakingSections({ page: readRepoFile(MIGRATION_PAGE) });
        const incomplete = sections
            .filter(
                (section) =>
                    !section.body.includes('**Before (1.x):**') ||
                    !section.body.includes('**After (2.0):**'),
            )
            .map((section) => section.heading);
        expect(incomplete).toEqual([]);
    });

    it('has a breaking-change section for every 2.0 breaking change', () => {
        const sections = collectBreakingSections({ page: readRepoFile(MIGRATION_PAGE) });
        const issues = [...new Set(sections.flatMap((section) => section.issues))].sort(
            (left, right) => left - right,
        );
        expect(issues).toEqual(BREAKING_ISSUES);
    });

    it('links the compatibility policy and the migration guide from the README', () => {
        const readme = readRepoFile('README.md');
        expect(readme).toContain('https://sfn.yusufaf.dev/compatibility/');
        expect(readme).toContain('https://sfn.yusufaf.dev/upgrading-to-v2/');
    });
});
