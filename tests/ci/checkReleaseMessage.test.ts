import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildSquashMessage,
    checkReleaseMessage,
} from '../../scripts/check-release-message.mjs';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// The merge commit of #362, whose release-please parse failed at 201:59 (#387).
const SQUASH_362 = fixture('a726ac4.commit.txt');

describe('checkReleaseMessage', () => {
    it('fails the real #362 squash message', () => {
        const result = checkReleaseMessage({ message: SQUASH_362 });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('201:59');
    });

    it('passes the same message when the PR body carries a BEGIN_COMMIT_OVERRIDE block', () => {
        const result = checkReleaseMessage({
            message: SQUASH_362,
            prBody: fixture('pr362.body.txt'),
        });
        expect(result).toMatchObject({ ok: true, parsedCount: 1 });
    });

    it('passes a clean message', () => {
        const result = checkReleaseMessage({
            message: 'feat(png): add thing\n\nplain body\n\n* perf(png): second commit',
        });
        expect(result.ok).toBe(true);
    });

    it('fails a body line that starts with `identifier(` and runs past the line', () => {
        const result = checkReleaseMessage({ message: 'fix: a\n\nfoo(bar,\nbaz)' });
        expect(result.ok).toBe(false);
    });

    // Hit by this check's own PR (#396): prose naming the marker made release-please
    // take the rest of the body as the commit message.
    it('fails a PR body that merely mentions the override marker', () => {
        const result = checkReleaseMessage({
            message: 'feat: a',
            prBody: 'Honors the BEGIN_COMMIT_OVERRIDE block, as release-please does.',
        });
        expect(result.ok).toBe(false);
    });

    it('passes the same code when indented', () => {
        const result = checkReleaseMessage({ message: 'fix: a\n\n    foo(bar,\n    baz)' });
        expect(result.ok).toBe(true);
    });

    it('fails a message with no conventional header', () => {
        const result = checkReleaseMessage({ message: 'Update stuff' });
        expect(result.ok).toBe(false);
    });

    it('fails a breaking marker that only sits in a commit bullet', () => {
        const result = checkReleaseMessage({
            message: 'feat(parser): t (#600)\n\n* feat(parser)!: remove x\n\n* test: cover it',
        });
        expect(result).toMatchObject({ breakingDropped: true, ok: false });
    });

    it('passes a dropped bullet marker when the PR body carries a BEGIN_COMMIT_OVERRIDE block', () => {
        const result = checkReleaseMessage({
            message: 'feat(parser): t (#600)\n\n* feat(parser)!: remove x\n\n* test: cover it',
            prBody: 'Notes.\n\nBEGIN_COMMIT_OVERRIDE\nfeat(parser): t\nEND_COMMIT_OVERRIDE',
        });
        expect(result).toMatchObject({ breakingDropped: false, ok: true });
    });

    it('passes a bullet whose BREAKING CHANGE footer release-please reads', () => {
        const result = checkReleaseMessage({
            message: 'feat: t (#600)\n\n* feat!: y\n\nBREAKING CHANGE: z\n\n* test: b',
        });
        expect(result).toMatchObject({ breakingDropped: false, ok: true });
    });

    it('passes a docs commit that quotes an indented footer example', () => {
        const result = checkReleaseMessage({
            message:
                'docs: explain footers (#601)\n\nWrite it as:\n\n    BREAKING CHANGE: <migration>\n\nin the body.',
        });
        expect(result.ok).toBe(true);
    });

    it('passes a breaking PR title over plain bullets', () => {
        const result = checkReleaseMessage({
            message: 'feat(parser)!: remove x (#600)\n\n* refactor: a\n\n* test: b',
        });
        expect(result.ok).toBe(true);
    });

    it('passes a single breaking commit with a footer', () => {
        const result = checkReleaseMessage({ message: 'feat!: x\n\nBREAKING CHANGE: y' });
        expect(result.ok).toBe(true);
    });

    it('exits 1 with the breaking-change hint when run as a script', () => {
        const dir = mkdtempSync(join(tmpdir(), 'release-message-'));
        try {
            const file = join(dir, 'message.txt');
            writeFileSync(file, 'feat(parser): t (#600)\n\n* feat(parser)!: remove x\n\n* test: cover it');
            const script = resolve(__dirname, '../../scripts/check-release-message.mjs');
            const run = spawnSync(process.execPath, [script, '--message-file', file], {
                encoding: 'utf8',
                timeout: 30_000,
            });
            // Asserted together so a crash or spawn failure shows its stderr and error.
            expect({ error: run.error, status: run.status, stderr: run.stderr }).toMatchObject({
                error: undefined,
                status: 1,
                stderr: expect.stringContaining('release-please would drop this breaking change'),
            });
            expect(run.stderr).toContain('Put `!` in the PR title');
            expect(run.stderr).not.toContain('cannot parse');
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    }, 30_000);
});

describe('buildSquashMessage', () => {
    it('uses a lone commit message as is', () => {
        expect(buildSquashMessage({ commits: ['fix: a\n\nbody'], title: 'fix: a' })).toBe(
            'fix: a\n\nbody',
        );
    });

    it('prefixes the title and bullets each commit when there are several', () => {
        expect(
            buildSquashMessage({ commits: ['fix: a', 'perf: b\n\nbody'], title: 'feat: t (#1)' }),
        ).toBe('feat: t (#1)\n\n* fix: a\n\n* perf: b\n\nbody');
    });
});
