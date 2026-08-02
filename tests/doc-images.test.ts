import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

/**
 * Local (non-URL) image paths referenced by a Markdown/HTML document, collected from
 * both Markdown `![alt](path)` syntax and the `src` / `srcset` attributes used by the
 * README's `<picture>` hero block.
 */
function collectLocalImageRefs(markdown: string): string[] {
    const refs = new Set<string>();

    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        refs.add(match[1]);
    }
    for (const match of markdown.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
        refs.add(match[1]);
    }

    return [...refs].filter(
        (ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith('data:') && !ref.startsWith('#')
    );
}

/** Whether git tracks the path — the only check that catches a gitignored asset. */
function isTrackedByGit(relativePath: string): boolean {
    const output = execFileSync('git', ['ls-files', '--', relativePath], {
        cwd: repoRoot,
        encoding: 'utf-8',
    });
    return output.trim().length > 0;
}

describe('documentation images', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf-8');
    const imageRefs = collectLocalImageRefs(readme);

    it('finds the local image references in README.md', () => {
        expect(imageRefs.length).toBeGreaterThan(0);
    });

    // Existence on disk is not enough: examples/outputs/ is generated locally by
    // `pnpm run examples`, so a broken reference looks fine to whoever wrote it and
    // only breaks for readers on GitHub and npm (#49).
    it.each(imageRefs)('README image %s is tracked by git', (ref) => {
        expect(isTrackedByGit(ref)).toBe(true);
    });
});
