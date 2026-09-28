import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliInputError, expandInputs, hasGlobMagic } from '../../src/cliInputs';

describe('hasGlobMagic', () => {
    it.each([
        '*.asl.json',
        'a/**/b.json',
        'x?.json',
        '[ab].json',
        '{a,b}.json',
    ])('treats %s as a pattern', (pattern) => {
        expect(hasGlobMagic(pattern)).toBe(true);
    });

    it.each(['order.asl.json', './a/b.asl.json', 'C:/tmp/x.asl.json', '-'])(
        'treats %s as a literal path',
        (pattern) => {
            expect(hasGlobMagic(pattern)).toBe(false);
        },
    );
});

describe('expandInputs', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sfn-inputs-'));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const touch = (relative: string): string => {
        const path = join(root, relative);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, '{}');
        return path;
    };

    it('passes a literal path through without touching the filesystem', () => {
        // Existence is checked when the file is read, which reports it properly.
        expect(
            expandInputs({ cwd: root, patterns: ['does/not/exist.asl.json'] }),
        ).toEqual(['does/not/exist.asl.json']);
    });

    it('keeps several literal paths in the order given', () => {
        expect(
            expandInputs({ cwd: root, patterns: ['b.asl.json', 'a.asl.json'] }),
        ).toEqual(['b.asl.json', 'a.asl.json']);
    });

    it('expands a glob in the working directory only', () => {
        touch('one.asl.json');
        touch('two.asl.json');
        touch('nested/three.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['*.asl.json'] })).toEqual([
            'one.asl.json',
            'two.asl.json',
        ]);
    });

    it('expands ** across directories', () => {
        touch('one.asl.json');
        touch('nested/two.asl.json');
        touch('nested/deep/three.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['**/*.asl.json'] }),
        ).toEqual([
            'nested/deep/three.asl.json',
            'nested/two.asl.json',
            'one.asl.json',
        ]);
    });

    it('returns matches sorted, so the batch order does not depend on the filesystem', () => {
        touch('c.asl.json');
        touch('a.asl.json');
        touch('b.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['*.asl.json'] })).toEqual([
            'a.asl.json',
            'b.asl.json',
            'c.asl.json',
        ]);
    });

    it('scopes the walk to a pattern prefix', () => {
        touch('machines/one.asl.json');
        touch('elsewhere/two.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['machines/**/*.asl.json'] }),
        ).toEqual(['machines/one.asl.json']);
    });

    it('accepts a backslash separator in a pattern', () => {
        // minimatch does not match `\` separators, so an unnormalized Windows-style
        // pattern would silently match nothing.
        touch('machines/one.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['machines\\*.asl.json'] }),
        ).toEqual(['machines/one.asl.json']);
    });

    it('does not let a bare *.json match at depth', () => {
        // matchBase would make it match, which leaves no way to ask for
        // "this directory only".
        touch('top.asl.json');
        touch('nested/deep.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['*.asl.json'] })).toEqual([
            'top.asl.json',
        ]);
    });

    it('skips node_modules and .git', () => {
        touch('node_modules/pkg/bundled.asl.json');
        touch('.git/objects/stray.asl.json');
        touch('real.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['**/*.asl.json'] }),
        ).toEqual(['real.asl.json']);
    });

    it('walks a hidden directory that is not .git', () => {
        touch('.github/workflows/machine.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['**/*.asl.json'] }),
        ).toEqual(['.github/workflows/machine.asl.json']);
    });

    it('de-duplicates a file matched by two patterns', () => {
        touch('one.asl.json');
        expect(
            expandInputs({
                cwd: root,
                patterns: ['*.asl.json', 'one.asl.json'],
            }),
        ).toEqual(['one.asl.json']);
    });

    it('throws when a pattern matches nothing', () => {
        touch('one.asl.json');
        expect(() =>
            expandInputs({ cwd: root, patterns: ['*.nope.json'] }),
        ).toThrowError(CliInputError);
        expect(() =>
            expandInputs({ cwd: root, patterns: ['*.nope.json'] }),
        ).toThrowError(/\*\.nope\.json/);
    });

    it('throws naming only the pattern that matched nothing', () => {
        touch('one.asl.json');
        let message = '';
        try {
            expandInputs({
                cwd: root,
                patterns: ['*.asl.json', '*.nope.json'],
            });
            expect.unreachable('the second pattern matches nothing');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('*.nope.json');
        expect(message).not.toContain('*.asl.json');
    });

    it('ignores a directory whose name matches the pattern', () => {
        mkdirSync(join(root, 'looks.asl.json'), { recursive: true });
        touch('real.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['*.asl.json'] })).toEqual([
            'real.asl.json',
        ]);
    });
});
