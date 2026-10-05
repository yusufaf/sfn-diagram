import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

    it('passes the same code when indented', () => {
        const result = checkReleaseMessage({ message: 'fix: a\n\n    foo(bar,\n    baz)' });
        expect(result.ok).toBe(true);
    });

    it('fails a message with no conventional header', () => {
        const result = checkReleaseMessage({ message: 'Update stuff' });
        expect(result.ok).toBe(false);
    });
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
