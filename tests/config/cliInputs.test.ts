import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
    CliInputError,
    deriveOutputName,
    expandInputs,
    hasGlobMagic,
    OUTPUT_EXTENSIONS,
    patternRoot,
    planOutputPaths,
} from '../../src/cliInputs';

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

    it('accepts a ./-prefixed pattern', () => {
        // Shell completion and copy-pasted docs routinely produce `./`, and the
        // candidates it is matched against never carry one.
        touch('machines/one.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['./machines/*.asl.json'] }),
        ).toEqual(['machines/one.asl.json']);
    });

    it('accepts a bare ./ pattern in the working directory', () => {
        touch('one.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['./*.asl.json'] })).toEqual(
            ['one.asl.json'],
        );
    });

    it('accepts an absolute pattern', () => {
        // A CI job passing "$CI_PROJECT_DIR/machines/*.asl.json" must work.
        const file = touch('machines/one.asl.json');
        const pattern = join(root, 'machines', '*.asl.json');
        expect(expandInputs({ cwd: root, patterns: [pattern] })).toEqual([
            file.split(sep).join('/'),
        ]);
    });

    it('falls back to a literal path when a bracketed name matches nothing', () => {
        // `order[1].asl.json` is a real filename and a valid glob. Before globbing
        // existed the positional went straight to readFileSync and rendered; treating
        // it only as a pattern would be a regression on files that already work.
        const file = touch('order[1].asl.json');
        expect(existsSync(file)).toBe(true);
        expect(
            expandInputs({ cwd: root, patterns: ['order[1].asl.json'] }),
        ).toEqual(['order[1].asl.json']);
    });

    it('still prefers a real glob match over the literal fallback', () => {
        touch('order1.asl.json');
        expect(
            expandInputs({ cwd: root, patterns: ['order[1].asl.json'] }),
        ).toEqual(['order1.asl.json']);
    });

    it('still throws when neither the pattern nor the literal path exists', () => {
        expect(() =>
            expandInputs({ cwd: root, patterns: ['order[9].asl.json'] }),
        ).toThrowError(CliInputError);
    });

    it('matches a symlinked definition', () => {
        // pnpm workspaces and shared definition directories are full of symlinks; a
        // walk that reports neither isFile() nor isDirectory() for them skips the file
        // entirely and reports "No files matched".
        const target = touch('real/one.asl.json');
        mkdirSync(join(root, 'machines'), { recursive: true });
        try {
            symlinkSync(target, join(root, 'machines', 'linked.asl.json'));
        } catch {
            // Windows without developer mode refuses symlinks; nothing to assert.
            return;
        }
        expect(
            expandInputs({ cwd: root, patterns: ['machines/*.asl.json'] }),
        ).toEqual(['machines/linked.asl.json']);
    });

    it('ignores a directory whose name matches the pattern', () => {
        mkdirSync(join(root, 'looks.asl.json'), { recursive: true });
        touch('real.asl.json');
        expect(expandInputs({ cwd: root, patterns: ['*.asl.json'] })).toEqual([
            'real.asl.json',
        ]);
    });
});

describe('patternRoot', () => {
    // The scoping this decides cannot be seen in expandInputs' result: matching filters
    // the candidates afterwards either way, so a test of the output passes even when the
    // walk read the entire tree. An earlier version popped the last plain segment
    // unconditionally, which reduced every prefixed pattern to no root at all.
    it.each([
        ['machines/**/*.asl.json', 'machines'],
        ['machines/*.asl.json', 'machines'],
        ['a/b/c/*.asl.json', 'a/b/c'],
        ['*.asl.json', ''],
        ['**/*.asl.json', ''],
        ['machines/**/deep/*.json', 'machines'],
    ])('scopes %s to %s', (pattern, expected) => {
        expect(patternRoot(pattern)).toBe(expected);
    });

    it('keeps an absolute prefix absolute', () => {
        expect(patternRoot('/srv/machines/*.asl.json')).toBe('/srv/machines');
    });

    it('normalises a backslash-separated prefix', () => {
        expect(patternRoot('machines\\nested\\*.asl.json')).toBe(
            'machines/nested',
        );
    });
});

describe('deriveOutputName', () => {
    it.each([
        ['order.asl.json', 'svg', 'order.svg'],
        ['order.asl.json', 'mermaid', 'order.mmd'],
        ['order.asl.json', 'png', 'order.png'],
        ['order.asl.json', 'html', 'order.html'],
        ['machines/refund.asl.json', 'svg', 'refund.svg'],
        ['plain.asl', 'svg', 'plain.svg'],
        ['template.yaml', 'svg', 'template.svg'],
        ['template.yml', 'svg', 'template.svg'],
        ['machine.json', 'svg', 'machine.svg'],
        ['machine.asl.yaml', 'svg', 'machine.svg'],
    ] as const)('maps %s at --format %s to %s', (input, format, expected) => {
        expect(deriveOutputName({ format, input })).toBe(expected);
    });

    it('keeps a name with no recognised suffix intact', () => {
        expect(deriveOutputName({ format: 'svg', input: 'Makefile' })).toBe(
            'Makefile.svg',
        );
    });

    it('strips the longest matching suffix, not the shortest', () => {
        // '.asl.json' and '.json' both match; taking '.json' would leave 'order.asl'.
        expect(
            deriveOutputName({ format: 'svg', input: 'order.asl.json' }),
        ).toBe('order.svg');
    });

    it('discards the input directory', () => {
        expect(
            deriveOutputName({ format: 'svg', input: 'a/b/c/order.asl.json' }),
        ).toBe('order.svg');
    });

    it('discards a backslash-separated input directory too', () => {
        expect(
            deriveOutputName({ format: 'svg', input: 'a\\b\\order.asl.json' }),
        ).toBe('order.svg');
    });

    it('covers every diagram format', () => {
        // A format added without an extension here would produce an output with no
        // extension at all, silently.
        expect(Object.keys(OUTPUT_EXTENSIONS).sort()).toEqual([
            'html',
            'mermaid',
            'png',
            'svg',
        ]);
    });
});

describe('planOutputPaths', () => {
    /** A file input names its output after its own path, so both roles are the path. */
    const fileSources = (...paths: string[]) =>
        paths.map((path) => ({ label: path, nameSource: path }));

    it('pairs each input with a flattened output path', () => {
        expect(
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: fileSources('a/order.asl.json', 'b/refund.asl.json'),
            }),
        ).toEqual([
            { label: 'a/order.asl.json', output: join('out', 'order.svg') },
            { label: 'b/refund.asl.json', output: join('out', 'refund.svg') },
        ]);
    });

    it('throws naming both inputs and the output they collide on', () => {
        let message = '';
        try {
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: fileSources('a/order.asl.json', 'b/order.asl.json'),
            });
            expect.unreachable('two inputs map to the same output');
        } catch (error) {
            expect(error).toBeInstanceOf(CliInputError);
            message = (error as Error).message;
        }
        expect(message).toContain('a/order.asl.json');
        expect(message).toContain('b/order.asl.json');
        expect(message).toContain(join('out', 'order.svg'));
    });

    it('reports every collision, not only the first', () => {
        let message = '';
        try {
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: fileSources(
                    'a/order.asl.json',
                    'b/order.asl.json',
                    'a/refund.asl.json',
                    'b/refund.asl.json',
                ),
            });
            expect.unreachable('two pairs collide');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('order.svg');
        expect(message).toContain('refund.svg');
    });

    it('collides on the derived name, not the input name', () => {
        // order.asl.json and order.asl are different inputs that both become order.svg.
        expect(() =>
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: fileSources('order.asl.json', 'order.asl'),
            }),
        ).toThrowError(/order\.svg/);
    });

    it('accepts a single input', () => {
        expect(
            planOutputPaths({
                format: 'mermaid',
                outDir: 'out',
                sources: fileSources('order.asl.json'),
            }),
        ).toEqual([
            { label: 'order.asl.json', output: join('out', 'order.mmd') },
        ]);
    });

    it('does not suggest a flag that does not exist', () => {
        // The chosen design has no --preserve-tree; an error pointing at one would send
        // the reader looking for something they cannot use.
        let message = '';
        try {
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: fileSources('a/order.asl.json', 'b/order.asl.json'),
            });
            expect.unreachable('two inputs map to the same output');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).not.toContain('--preserve-tree');
    });

    it('derives an ARN output name from the state machine name, not the ARN', () => {
        // An ARN has no basename and its colons are illegal in a Windows filename,
        // so the name it is written under has to come from somewhere else.
        const arn =
            'arn:aws:states:us-east-1:123456789012:stateMachine:Orders';
        expect(
            planOutputPaths({
                format: 'svg',
                outDir: 'out',
                sources: [{ label: arn, nameSource: 'Orders' }],
            }),
        ).toEqual([{ label: arn, output: join('out', 'Orders.svg') }]);
    });

    it('refuses two ARNs whose state machine names collide, naming both ARNs', () => {
        const first =
            'arn:aws:states:us-east-1:111111111111:stateMachine:Orders';
        const second =
            'arn:aws:states:eu-west-1:222222222222:stateMachine:Orders';
        const sources = [
            { label: first, nameSource: 'Orders' },
            { label: second, nameSource: 'Orders' },
        ];

        let message = '';
        try {
            planOutputPaths({ format: 'svg', outDir: 'out', sources });
            expect.unreachable('two ARNs map to the same output');
        } catch (error) {
            expect(error).toBeInstanceOf(CliInputError);
            message = (error as Error).message;
        }
        expect(message).toContain(first);
        expect(message).toContain(second);
        expect(message).toContain(join('out', 'Orders.svg'));
    });
});
