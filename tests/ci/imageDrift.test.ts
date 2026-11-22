import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    createLocalIconFetch,
    embedIconsLocally,
    findImageDrift,
    normalizeLineEndings,
    resolveAwsIconsPackage,
    writeOrCheckImages,
} from '../../scripts/lib/docImages.mjs';
import { generateSvg } from '../../src';
import { embedIcons } from '../../src/utils/iconEmbedder';

const repoRoot = resolve(__dirname, '../..');

const servicesSvg = (): string =>
    generateSvg({
        aslDefinition: JSON.parse(
            readFileSync(join(repoRoot, 'tests/fixtures/services.asl.json'), 'utf-8'),
        ),
        showIcons: true,
    }).svg;

const firstIconUrl = (svg: string): string => {
    const match = /<image\b[^>]*?\shref="([^"]+)"/.exec(svg);
    if (!match) throw new Error('no <image href> in the rendered SVG');
    return match[1];
};

describe('normalizeLineEndings', () => {
    it('turns CRLF into LF', () => {
        expect(normalizeLineEndings({ contents: 'a\r\nb\r\n' })).toBe('a\nb\n');
    });
});

describe('committed image files', () => {
    let workDir: string;

    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'sfn-doc-images-'));
    });

    afterEach(() => {
        rmSync(workDir, { force: true, recursive: true });
    });

    const commit = (path: string, contents: string) => {
        mkdirSync(join(workDir, path, '..'), { recursive: true });
        writeFileSync(join(workDir, path), contents);
    };

    describe('findImageDrift', () => {
        it('reports a file that was never committed as missing', () => {
            expect(
                findImageDrift({ expected: new Map([['a.svg', '<svg/>']]), repoRoot: workDir }),
            ).toEqual([{ path: 'a.svg', problem: 'missing' }]);
        });

        it('reports a file whose content differs as stale', () => {
            commit('a.svg', '<svg>old</svg>');
            expect(
                findImageDrift({ expected: new Map([['a.svg', '<svg>new</svg>']]), repoRoot: workDir }),
            ).toEqual([{ path: 'a.svg', problem: 'stale' }]);
        });

        it('ignores a difference in line endings alone', () => {
            commit('manifest.json', '[\r\n  1\r\n]\r\n');
            expect(
                findImageDrift({
                    expected: new Map([['manifest.json', '[\n  1\n]\n']]),
                    repoRoot: workDir,
                }),
            ).toEqual([]);
        });

        it('reports an extra file in an owned directory as unexpected, with a POSIX path', () => {
            commit('gallery/a.svg', '<svg/>');
            commit('gallery/extra.svg', '<svg/>');
            expect(
                findImageDrift({
                    expected: new Map([['gallery/a.svg', '<svg/>']]),
                    ownedDirs: ['gallery'],
                    repoRoot: workDir,
                }),
            ).toEqual([{ path: 'gallery/extra.svg', problem: 'unexpected' }]);
        });

        it('ignores an extra file in a directory it does not own', () => {
            commit('images/hand-made.png', 'png');
            expect(
                findImageDrift({
                    expected: new Map([['images/a.svg', '<svg/>']]),
                    ownedDirs: [],
                    repoRoot: workDir,
                }),
            ).toEqual([{ path: 'images/a.svg', problem: 'missing' }]);
        });

        it('ignores a dotfile in an owned directory, which git ignores too', () => {
            commit('gallery/a.svg', '<svg/>');
            commit('gallery/.DS_Store', 'finder');
            expect(
                findImageDrift({
                    expected: new Map([['gallery/a.svg', '<svg/>']]),
                    ownedDirs: ['gallery'],
                    repoRoot: workDir,
                }),
            ).toEqual([]);
        });
    });

    describe('writeOrCheckImages', () => {
        it('fails a check on a stale file, naming it and the command, and leaves it alone', async () => {
            commit('gallery/a.svg', '<svg>old</svg>');
            await expect(
                writeOrCheckImages({
                    check: true,
                    expected: new Map([['gallery/a.svg', '<svg>new</svg>']]),
                    ownedDirs: ['gallery'],
                    regenerateCommand: 'pnpm run gallery:images',
                    repoRoot: workDir,
                }),
            ).rejects.toThrow(/stale gallery\/a\.svg[\s\S]*pnpm run gallery:images/);
            expect(readFileSync(join(workDir, 'gallery/a.svg'), 'utf-8')).toBe('<svg>old</svg>');
        });

        it('tells the author to delete an unexpected file, since writing never removes one', async () => {
            commit('gallery/a.svg', '<svg/>');
            commit('gallery/renamed-away.svg', '<svg/>');
            await expect(
                writeOrCheckImages({
                    check: true,
                    expected: new Map([['gallery/a.svg', '<svg/>']]),
                    ownedDirs: ['gallery'],
                    regenerateCommand: 'pnpm run gallery:images',
                    repoRoot: workDir,
                }),
            ).rejects.toThrow(/unexpected gallery\/renamed-away\.svg .*delete it/);
        });

        it('writes into a directory that does not exist yet, and a check then passes', async () => {
            const params = {
                expected: new Map([['nested/dir/a.svg', '<svg/>']]),
                ownedDirs: ['nested/dir'],
                regenerateCommand: 'pnpm run gallery:images',
                repoRoot: workDir,
            };
            await writeOrCheckImages({ ...params, check: false });
            expect(readFileSync(join(workDir, 'nested/dir/a.svg'), 'utf-8')).toBe('<svg/>');
            await expect(writeOrCheckImages({ ...params, check: true })).resolves.toBeUndefined();
        });
    });
});

describe('icons from the aws-icons dev dependency', () => {
    const iconsPackage = resolveAwsIconsPackage({ repoRoot });
    const iconFetch = createLocalIconFetch({
        iconsPackageDir: iconsPackage.dir,
        iconsVersion: iconsPackage.version,
    });

    it('serves the bytes of the installed icon a rendered SVG links to', async () => {
        const url = firstIconUrl(servicesSvg());
        const iconPath = /\/(icons\/.+)$/.exec(url)?.[1];
        const response = await iconFetch(url);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
            readFileSync(join(iconsPackage.dir, iconPath ?? '')),
        );
    });

    it('rejects a URL for another aws-icons version, naming both', async () => {
        const url = firstIconUrl(servicesSvg()).replace(/aws-icons@[^/]+/, 'aws-icons@0.0.0');
        await expect(iconFetch(url)).rejects.toThrow(
            new RegExp(`0\\.0\\.0.*${iconsPackage.version.replaceAll('.', '\\.')}`),
        );
    });

    it('rejects a URL that is not an aws-icons jsDelivr URL', async () => {
        await expect(iconFetch('https://example.com/icon.svg')).rejects.toThrow(
            /not an aws-icons jsDelivr URL/,
        );
    });

    it('rejects a path that climbs out of the icons directory', async () => {
        await expect(
            iconFetch(
                `https://cdn.jsdelivr.net/npm/aws-icons@${iconsPackage.version}/icons/../package.json`,
            ),
        ).rejects.toThrow();
    });

    it('is the version the renderer links to, so a lone bump of either fails here', () => {
        expect(firstIconUrl(servicesSvg())).toContain(`aws-icons@${iconsPackage.version}/`);
    });

    describe('embedIconsLocally', () => {
        it('inlines every icon and puts the global fetch back', async () => {
            const fetchBefore = globalThis.fetch;
            const svg = await embedIconsLocally({ embedIcons, iconFetch, svg: servicesSvg() });
            expect(svg).not.toContain('href="https://');
            expect(svg).toContain('data:image/svg+xml;base64,');
            expect(globalThis.fetch).toBe(fetchBefore);
        });

        it('fails, naming the URL, rather than leaving a remote icon behind', async () => {
            const fetchBefore = globalThis.fetch;
            const failingFetch = (input: string | URL | Request) =>
                Promise.reject(new Error(`no icon for ${String(input)}`));
            await expect(
                embedIconsLocally({ embedIcons, iconFetch: failingFetch, svg: servicesSvg() }),
            ).rejects.toThrow(/icon embedding failed:\nhttps:\/\/cdn\.jsdelivr\.net\//);
            expect(globalThis.fetch).toBe(fetchBefore);
        });
    });
});
