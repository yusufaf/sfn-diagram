import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A standalone binary (`pnpm run build:binary`) inlines dagre, minimatch, yaml and a
 * few more packages, and their licences (MIT, ISC, BlueOak) require their notice in
 * every copy. scripts/build-binaries.mjs puts those notices in a comment at the top
 * of the binary's entry module. These checks keep a build change from silently
 * dropping them. They find the inlined packages from the binary's own
 * `// node_modules/…` path comments, so they share no code with the build.
 *
 * The binary is a build artifact, not part of `pnpm test`: the suite runs only when
 * `SFN_DIAGRAM_BINARY` names one. CI's binary smoke test and the release `binaries`
 * job set it.
 */

const binaryPath = process.env.SFN_DIAGRAM_BINARY;
const repoRoot = resolve(__dirname, '..');

// Vitest runs a skipped suite's factory while collecting tests, and `it.each` needs
// its array then, so nothing may touch the binary unless one was named.
const binary = binaryPath
    ? readFileSync(resolve(process.cwd(), binaryPath))
          .toString('utf8')
          .replace(/\r\n/g, '\n')
    : '';

const NOTICE_HEADING = 'Third-party software bundled into this file';

/**
 * The notice block only, never the rest of the binary: the viewer's inlined relayout
 * bundle already carries dagre's licence, so a check over the whole file would pass
 * without the notice.
 */
function noticeBlock(): string {
    const start = binary.indexOf(NOTICE_HEADING);
    if (start === -1) {
        return '';
    }
    const end = binary.indexOf('\n */', start);
    return binary.slice(start, end === -1 ? undefined : end);
}

const notice = noticeBlock();

const LICENCE_FILE =
    /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i;
const PATH_COMMENT = /^\/\/ (\S*node_modules\/\S+)$/gm;
const MARKER = 'node_modules/';

interface InlinedPackage {
    id: string;
    licenceFiles: string[];
}

/** Every non-blank line of a licence file, trimmed. */
function licenceLines(file: string): string[] {
    return readFileSync(file, 'utf-8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/** An inlined input's package root, as written in the path comment: everything up to and including its name. */
function packagePrefix(input: string): string {
    const index = input.lastIndexOf(MARKER);
    const segments = input.slice(index + MARKER.length).split('/');
    const nameLength = segments[0].startsWith('@') ? 2 : 1;
    return (
        input.slice(0, index + MARKER.length) +
        segments.slice(0, nameLength).join('/')
    );
}

function inlinedInputs(): string[] {
    return [...binary.matchAll(PATH_COMMENT)].map((match) => match[1]);
}

/**
 * The packages the binary inlines, with the licence files in each package root and in
 * every directory between an inlined file and that root. bun writes the path comments
 * relative to the repo root, with `/` separators on every OS.
 */
function inlinedPackages(): InlinedPackage[] {
    const dirsByRoot = new Map<string, Set<string>>();
    for (const input of inlinedInputs()) {
        const root = join(repoRoot, packagePrefix(input));
        const dirs = dirsByRoot.get(root) ?? new Set([root]);
        let dir = dirname(join(repoRoot, input));
        while (dir.startsWith(root + sep)) {
            dirs.add(dir);
            dir = dirname(dir);
        }
        dirsByRoot.set(root, dirs);
    }
    return [...dirsByRoot]
        .map(([root, dirs]) => {
            const manifest = JSON.parse(
                readFileSync(join(root, 'package.json'), 'utf-8'),
            ) as { name: string; version: string };
            const licenceFiles = [...dirs]
                .filter((dir) => existsSync(dir))
                .flatMap((dir) =>
                    readdirSync(dir)
                        .filter(
                            (file) =>
                                LICENCE_FILE.test(file) &&
                                statSync(join(dir, file)).isFile(),
                        )
                        .map((file) => join(dir, file)),
                );
            return { id: `${manifest.name}@${manifest.version}`, licenceFiles };
        })
        .sort((left, right) =>
            left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
        );
}

const packages = binaryPath ? inlinedPackages() : [];

describe.runIf(binaryPath)(
    'third-party licence notices in a standalone binary',
    () => {
        it("includes dagre's copyright and every line of its MIT licence", () => {
            expect(notice).toContain('Copyright (c) 2012-2014 Chris Pettitt');
            const dagre = packages.find((pkg) =>
                pkg.id.startsWith('@dagrejs/dagre@'),
            );
            expect(dagre?.licenceFiles.length).toBeGreaterThan(0);
            for (const file of dagre!.licenceFiles) {
                for (const line of licenceLines(file)) {
                    expect(notice).toContain(line);
                }
            }
        });

        it('finds the packages the binary inlines', () => {
            const ids = packages.map((pkg) => pkg.id);
            for (const prefix of ['@dagrejs/dagre@', 'minimatch@', 'yaml@']) {
                expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
            }
            expect(packages.length).toBeGreaterThanOrEqual(5);
            // One entry per installed copy: two copies of a package (two versions, or
            // one version under two pnpm peer paths) each need checking.
            expect(new Set(inlinedInputs().map(packagePrefix)).size).toBe(
                packages.length,
            );
        });

        it.each(packages)(
            'names $id and carries every line of its licence',
            ({ id, licenceFiles }) => {
                expect(notice).toContain(id);
                expect(licenceFiles.length).toBeGreaterThan(0);
                for (const file of licenceFiles) {
                    for (const line of licenceLines(file)) {
                        expect(notice).toContain(line);
                    }
                }
            },
        );

        it('keeps the d3-shape port notice', () => {
            // bun re-indents the comment inside its module wrapper, and the real
            // newline here can't match the JSON-escaped copy in the relayout bundle.
            expect(binary).toMatch(
                /\/\*! @license\n\s*\* buildLinePath is ported from d3-shape/,
            );
        });
    },
);
