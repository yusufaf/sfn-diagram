import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, parseCommentGitlabArgs, run } from '../src/cli';
import { git } from './ci/gitTestHelper';

/** Asserts `action` throws a `CliError` with exit code 2 and returns its message. */
function expectUsageError(action: () => unknown): string {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).exitCode).toBe(2);
        return (error as CliError).message;
    }
    throw new Error('expected a usage error, but nothing was thrown');
}

describe('parseCommentGitlabArgs', () => {
    it('applies sensible defaults', () => {
        const args = parseCommentGitlabArgs([]);
        expect(args).toMatchObject({
            aslGlob: '**/*.asl.json,**/*.asl',
            commentTag: 'sfn-diagram-preview',
            executionMode: 'off',
            hideCatch: false,
            outputDir: 'sfn-diagram-artifacts',
            showHelp: false,
            stateMachineArn: '',
            theme: 'light',
        });
        expect(args.collapse).toBeUndefined();
        expect(args.layout).toBeUndefined();
    });

    it('parses every flag', () => {
        const args = parseCommentGitlabArgs([
            '--asl-glob',
            'flows/**/*.asl.json',
            '--comment-tag',
            'my-tag',
            '--theme',
            'dark',
            '--layout',
            'LR',
            '--collapse=GroupA',
            '--hide-catch',
            '--out-dir',
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
            collapse: ['GroupA'],
            commentTag: 'my-tag',
            executionMode: 'latest-failed',
            hideCatch: true,
            layout: 'LR',
            outputDir: 'out',
            showHelp: false,
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:sm',
            theme: 'dark',
        });
    });

    it('accepts the --flag=value form for every value flag', () => {
        expect(
            parseCommentGitlabArgs([
                '--asl-glob=a/**/*.asl.json',
                '--comment-tag=t',
                '--theme=dark',
                '--layout=LR',
                '--out-dir=o',
                '--execution-mode=latest',
                '--state-machine-arn=arn:aws:states:us-east-1:1:stateMachine:sm',
                '--aws-region=eu-west-1',
            ]),
        ).toMatchObject({
            aslGlob: 'a/**/*.asl.json',
            awsRegion: 'eu-west-1',
            commentTag: 't',
            executionMode: 'latest',
            layout: 'LR',
            outputDir: 'o',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:sm',
            theme: 'dark',
        });
    });

    it('parses --layout and rejects an unknown direction', () => {
        expect(parseCommentGitlabArgs(['--layout', 'RL']).layout).toBe('RL');
        expectUsageError(() => parseCommentGitlabArgs(['--layout', 'lr']));
    });

    it('treats a bare --collapse as "collapse every container" without swallowing the next flag', () => {
        expect(
            parseCommentGitlabArgs(['--collapse', '--hide-catch']),
        ).toMatchObject({ collapse: true, hideCatch: true });
    });

    it('parses --collapse=names, honouring an escaped comma', () => {
        expect(
            parseCommentGitlabArgs(['--collapse=GroupA,GroupB']).collapse,
        ).toEqual(['GroupA', 'GroupB']);
        expect(
            parseCommentGitlabArgs(['--collapse=Fetch\\, then merge']).collapse,
        ).toEqual(['Fetch, then merge']);
        expect(parseCommentGitlabArgs(['--collapse=']).collapse).toEqual([]);
    });

    it('accepts --out-dir, keeps --output-dir as an alias, and rejects both together', () => {
        expect(parseCommentGitlabArgs(['--out-dir', 'a']).outputDir).toBe('a');
        expect(parseCommentGitlabArgs(['--output-dir', 'b']).outputDir).toBe(
            'b',
        );
        expectUsageError(() =>
            parseCommentGitlabArgs(['--out-dir', 'a', '--output-dir', 'b']),
        );
        expectUsageError(() => parseCommentGitlabArgs(['--out-dir=']));
    });

    it('rejects a stray positional with exit code 2', () => {
        expect(expectUsageError(() => parseCommentGitlabArgs(['foo']))).toBe(
            'Unexpected argument: foo',
        );
        expect(
            expectUsageError(() =>
                parseCommentGitlabArgs(['--collapse', 'GroupA']),
            ),
        ).toContain('--collapse=GroupA');
    });

    it('rejects a value on a boolean flag', () => {
        expect(
            expectUsageError(() => parseCommentGitlabArgs(['--hide-catch=true'])),
        ).toContain('does not take a value');
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
        delete process.env.CI_API_V4_URL;
        delete process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
        delete process.env.CI_MERGE_REQUEST_IID;
        delete process.env.CI_MERGE_REQUEST_PROJECT_ID;
        delete process.env.GITLAB_TOKEN;
        vi.unstubAllGlobals();
    });

    it('prints help and exits 0', async () => {
        const code = await run(['comment', 'gitlab', '--help']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('sfn-diagram comment gitlab');
    });

    it('lists the render and output-directory flags in --help', async () => {
        await run(['comment', 'gitlab', '--help']);
        for (const flag of ['--layout', '--collapse', '--out-dir', '--output-dir']) {
            expect(stdoutData).toContain(flag);
        }
    });

    it('forwards --layout, --collapse and --theme to the posted note', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(
            join(repo, 'flow.asl.json'),
            JSON.stringify({
                StartAt: 'GroupA',
                States: {
                    GroupA: {
                        Branches: [
                            {
                                StartAt: 'BranchA',
                                States: { BranchA: { Type: 'Succeed' } },
                            },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            }),
        );
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        process.env.CI_API_V4_URL = 'https://gitlab.example.com/api/v4';
        process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = baseSha;
        process.env.CI_MERGE_REQUEST_IID = '7';
        process.env.CI_MERGE_REQUEST_PROJECT_ID = '42';
        process.env.GITLAB_TOKEN = 'tok';

        const postedBodies: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'POST') {
                    const { body } = JSON.parse(init.body as string) as {
                        body: string;
                    };
                    postedBodies.push(body);
                    return new Response(JSON.stringify({ id: 1 }), {
                        status: 201,
                    });
                }
                return new Response('[]', { status: 200 });
            }),
        );

        const code = await run([
            'comment',
            'gitlab',
            '--layout=LR',
            '--collapse',
            '--theme=dark',
        ]);

        expect(code).toBe(0);
        expect(postedBodies).toHaveLength(1);
        expect(postedBodies[0]).toContain('direction LR');
        expect(postedBodies[0]).toContain('fill:#14532d');
        expect(postedBodies[0]).not.toContain('BranchA');
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
