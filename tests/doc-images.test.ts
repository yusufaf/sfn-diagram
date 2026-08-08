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

/** Every image reference, absolute or not, from Markdown and `src`/`srcset`. */
function collectAllImageRefs(markdown: string): string[] {
    const refs = new Set<string>();

    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        refs.add(match[1]);
    }
    for (const match of markdown.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
        refs.add(match[1]);
    }

    return [...refs];
}

/** Map a raw.githubusercontent URL for this repo back to its repo-relative path. */
function repoPathFromRawUrl(url: string): string | null {
    const match = /^https:\/\/raw\.githubusercontent\.com\/yusufaf\/sfn-diagram\/[^/]+\/(.+)$/.exec(
        url,
    );
    return match ? match[1] : null;
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

describe('VS Code extension listing images', () => {
    const readmePath = 'packages/vscode-sfn-diagram/README.md';
    const readme = readFileSync(join(repoRoot, readmePath), 'utf-8');
    const allRefs = collectAllImageRefs(readme);

    it('references at least one image', () => {
        expect(allRefs.length).toBeGreaterThan(0);
    });

    // The Marketplace renders this README on its own domain, so a relative path
    // resolves against marketplace.visualstudio.com and silently 404s on the public
    // listing. Only absolute URLs survive.
    it.each(allRefs)('%s is an absolute URL', (ref) => {
        expect(ref).toMatch(/^https:\/\//);
    });

    // The Marketplace also rejects SVG images in extension READMEs.
    it.each(allRefs)('%s is not an SVG', (ref) => {
        expect(ref.toLowerCase().endsWith('.svg')).toBe(false);
    });

    // An absolute raw-GitHub URL still 404s if the file was never committed, which is
    // exactly how #49 broke the root README's hero image.
    it.each(allRefs.filter((ref) => repoPathFromRawUrl(ref) !== null))(
        '%s points at a file tracked by git',
        (ref) => {
            expect(isTrackedByGit(repoPathFromRawUrl(ref) as string)).toBe(true);
        },
    );
});
