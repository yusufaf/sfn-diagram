import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getChangedAslFiles,
    readFileAtGitRef,
    readWorkingTreeFile,
} from '../../src/ci/changedFiles';
import { git } from './gitTestHelper';

describe('changedFiles (real git repo)', () => {
    let repo: string;

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'sfn-ci-git-'));
        git(repo, 'init', '-q');
        git(repo, 'config', 'user.email', 'test@example.com');
        git(repo, 'config', 'user.name', 'Test');
    });

    afterEach(() => {
        rmSync(repo, { force: true, recursive: true });
    });

    it('discovers added, modified, and removed files matching the glob against the base ref', () => {
        writeFileSync(join(repo, 'unrelated.ts'), 'export {}');
        writeFileSync(
            join(repo, 'modified.asl.json'),
            JSON.stringify({
                StartAt: 'A',
                States: { A: { Type: 'Succeed' } },
            }),
        );
        writeFileSync(
            join(repo, 'removed.asl.json'),
            JSON.stringify({
                StartAt: 'B',
                States: { B: { Type: 'Succeed' } },
            }),
        );
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();

        writeFileSync(
            join(repo, 'modified.asl.json'),
            JSON.stringify({
                StartAt: 'A2',
                States: { A2: { Type: 'Succeed' } },
            }),
        );
        git(repo, 'rm', '-q', 'removed.asl.json');
        writeFileSync(
            join(repo, 'added.asl.json'),
            JSON.stringify({
                StartAt: 'C',
                States: { C: { Type: 'Succeed' } },
            }),
        );
        writeFileSync(join(repo, 'unrelated.ts'), 'export const x = 1');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const changed = getChangedAslFiles({
            baseRef: baseSha,
            cwd: repo,
            patterns: ['**/*.asl.json'],
        });
        const byName = Object.fromEntries(
            changed.map((file) => [file.filename, file.status]),
        );

        expect(byName).toEqual({
            'added.asl.json': 'added',
            'modified.asl.json': 'modified',
            'removed.asl.json': 'removed',
        });
        // unrelated.ts changed too, but doesn't match the glob.
        expect(changed.some((file) => file.filename === 'unrelated.ts')).toBe(
            false,
        );
    });

    it('matches nested files by glob', () => {
        mkdirSync(join(repo, 'deep', 'nested'), { recursive: true });
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();

        writeFileSync(
            join(repo, 'deep', 'nested', 'state.asl.json'),
            JSON.stringify({
                StartAt: 'A',
                States: { A: { Type: 'Succeed' } },
            }),
        );
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const changed = getChangedAslFiles({
            baseRef: baseSha,
            cwd: repo,
            patterns: ['**/*.asl.json'],
        });
        expect(changed.map((file) => file.filename)).toEqual([
            'deep/nested/state.asl.json',
        ]);
    });

    it('reads a file at the base ref via readFileAtGitRef, and the working tree via readWorkingTreeFile', () => {
        writeFileSync(join(repo, 'flow.asl.json'), 'base-content');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();

        writeFileSync(join(repo, 'flow.asl.json'), 'head-content');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        expect(
            readFileAtGitRef({
                cwd: repo,
                path: 'flow.asl.json',
                ref: baseSha,
            }),
        ).toBe('base-content');
        expect(readWorkingTreeFile({ cwd: repo, path: 'flow.asl.json' })).toBe(
            'head-content',
        );
        expect(
            readFileAtGitRef({
                cwd: repo,
                path: 'nope.asl.json',
                ref: baseSha,
            }),
        ).toBeNull();
        expect(
            readWorkingTreeFile({ cwd: repo, path: 'nope.asl.json' }),
        ).toBeNull();
    });

    it('throws when the base ref is unknown (surfaces a shallow-clone misconfiguration)', () => {
        writeFileSync(join(repo, 'flow.asl.json'), '{}');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'only commit');

        expect(() =>
            getChangedAslFiles({
                baseRef: 'deadbeef',
                cwd: repo,
                patterns: ['**/*.asl.json'],
            }),
        ).toThrow();
    });
});
