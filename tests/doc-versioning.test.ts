import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

const UPCOMING_PAGE = 'site/src/content/docs/upgrading-to-v2.md';

/**
 * Read a repo file. Called inside each test rather than at module scope, so a missing
 * page fails only the tests that need it.
 */
function readRepoFile(relativePath: string): string {
    return readFileSync(join(repoRoot, relativePath), 'utf8');
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
 * collectRemovedIn2Declarations({ sourceRoot: join(repoRoot, 'src') }); // ['DiagramOptions.height', …]
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

    it('lists every declaration removed in 2.0 on the Upcoming in 2.0 page', () => {
        const page = readRepoFile(UPCOMING_PAGE);
        const missing = collectRemovedIn2Declarations({
            sourceRoot: join(repoRoot, 'src'),
        }).filter((name) => !page.includes(`\`${name}\``));
        expect(missing).toEqual([]);
    });

    it('lists the deprecated html-to-image engine', () => {
        const page = readRepoFile(UPCOMING_PAGE);
        expect(page).toContain('`html-to-image`');
        expect(page).toContain('`node-html-to-image`');
    });

    it('links both pages from the README', () => {
        const readme = readRepoFile('README.md');
        expect(readme).toContain('https://sfn.yusufaf.dev/compatibility/');
        expect(readme).toContain('https://sfn.yusufaf.dev/upgrading-to-v2/');
    });
});
