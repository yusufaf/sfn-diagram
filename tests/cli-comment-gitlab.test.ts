import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, parseCommentGitlabArgs, run } from '../src/cli';
import { git } from './ci/gitTestHelper';

describe('parseCommentGitlabArgs', () => {
    it('applies sensible defaults', () => {
        expect(parseCommentGitlabArgs([])).toMatchObject({
            aslGlob: '**/*.asl.json,**/*.asl',
            commentTag: 'sfn-diagram-preview',
            executionMode: 'off',
            hideCatch: false,
            outputDir: 'sfn-diagram-artifacts',
            showHelp: false,
            stateMachineArn: '',
            theme: 'light',
        });
    });

    it('parses every flag', () => {
        const args = parseCommentGitlabArgs([
            '--asl-glob',
            'flows/**/*.asl.json',
            '--comment-tag',
            'my-tag',
            '--theme',
            'dark',
            '--hide-catch',
            '--output-dir',
            'out',
            '--execution-mode',
            'latest-failed',
            '--state-machine-arn',
            'arn:aws:states:us-east-1:1:stateMachine:sm',
            '--aws-region',
            'eu-west-1',
        ]);
        expect(args).toEqual({
            aslGlob: 'flows/**/*.asl.json',
            awsRegion: 'eu-west-1',
            commentTag: 'my-tag',
            executionMode: 'latest-failed',
            hideCatch: true,
            outputDir: 'out',
            showHelp: false,
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:sm',
            theme: 'dark',
        });
    });

    it('sets showHelp for -h and --help', () => {
        expect(parseCommentGitlabArgs(['-h']).showHelp).toBe(true);
        expect(parseCommentGitlabArgs(['--help']).showHelp).toBe(true);
    });

    it('rejects an unknown flag with exit code 2', () => {
        expect(() => parseCommentGitlabArgs(['--nope'])).toThrowError(CliError);
        try {
            parseCommentGitlabArgs(['--nope']);
        } catch (error) {
            expect((error as CliError).exitCode).toBe(2);
        }
    });

    it('rejects an invalid --theme and --execution-mode', () => {
        expect(() => parseCommentGitlabArgs(['--theme', 'neon'])).toThrowError(
            CliError,
        );
        expect(() =>
            parseCommentGitlabArgs(['--execution-mode', 'always']),
        ).toThrowError(CliError);
    });
});

// Spawns a real git repo per test; see tests/ci/changedFiles.test.ts for the budget.
describe('run(["comment", "gitlab", ...])', { timeout: 30_000 }, () => {
    let repo: string;
    let originalCwd: string;
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'sfn-cli-gitlab-'));
        git(repo, 'init', '-q');
        git(repo, 'config', 'user.email', 'test@example.com');
        git(repo, 'config', 'user.name', 'Test');

        originalCwd = process.cwd();
        process.chdir(repo);

        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        process.chdir(originalCwd);
        rmSync(repo, { force: true, recursive: true });
        delete process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
        delete process.env.GITLAB_TOKEN;
    });

    it('prints help and exits 0', async () => {
        const code = await run(['comment', 'gitlab', '--help']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('sfn-diagram comment gitlab');
    });

    it('exits 0 with an informational message outside a merge request pipeline', async () => {
        delete process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
        const code = await run(['comment', 'gitlab']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('CI_MERGE_REQUEST_DIFF_BASE_SHA');
    });

    it('renders (no token) and reports the changed file without posting a comment', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(
            join(repo, 'flow.asl.json'),
            JSON.stringify({
                StartAt: 'A',
                States: { A: { Type: 'Succeed' } },
            }),
        );
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = baseSha;
        delete process.env.GITLAB_TOKEN;

        const code = await run(['comment', 'gitlab']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('No GITLAB_TOKEN');
    });

    it('rejects --execution-mode without --state-machine-arn with exit code 2', async () => {
        process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = 'irrelevant';
        const code = await run([
            'comment',
            'gitlab',
            '--execution-mode',
            'latest',
        ]);
        expect(code).toBe(2);
        expect(stderrData).toContain('--state-machine-arn is required');
    });
});
