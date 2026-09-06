import {
    existsSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    detectGitlabMergeRequestContext,
    MAX_INLINE_MERMAID_CHARS,
    resolveGitlabToken,
    runGitlabComment,
    upsertMergeRequestNote,
} from '../../src/ci/gitlab';
import { git } from './gitTestHelper';

const { fetchExecutionForOverlayMock } = vi.hoisted(() => ({
    fetchExecutionForOverlayMock: vi.fn(),
}));

vi.mock('../../src/ci/execution', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/ci/execution')>()),
    fetchExecutionForOverlay: fetchExecutionForOverlayMock,
}));

describe('detectGitlabMergeRequestContext', () => {
    it('returns null when CI_API_V4_URL is missing', () => {
        expect(detectGitlabMergeRequestContext({})).toBeNull();
    });

    it('reads the IID directly from CI_MERGE_REQUEST_IID in an MR pipeline', () => {
        expect(
            detectGitlabMergeRequestContext({
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_IID: '12',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
            }),
        ).toEqual({
            apiUrl: 'https://gitlab.example.com/api/v4',
            mergeRequestIid: 12,
            projectId: '42',
        });
    });

    it('falls back to parsing CI_OPEN_MERGE_REQUESTS on a branch pipeline', () => {
        expect(
            detectGitlabMergeRequestContext({
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_OPEN_MERGE_REQUESTS: 'group/project!7,group/project!9',
                CI_PROJECT_ID: '42',
            }),
        ).toEqual({
            apiUrl: 'https://gitlab.example.com/api/v4',
            mergeRequestIid: 7,
            projectId: '42',
        });
    });

    it('returns null when neither IID source is present', () => {
        expect(
            detectGitlabMergeRequestContext({
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_PROJECT_ID: '42',
            }),
        ).toBeNull();
    });
});

describe('resolveGitlabToken', () => {
    it('prefers GITLAB_TOKEN over the fallback', () => {
        expect(
            resolveGitlabToken({
                GITLAB_TOKEN: 'a',
                SFN_DIAGRAM_GITLAB_TOKEN: 'b',
            }),
        ).toBe('a');
    });

    it('falls back to SFN_DIAGRAM_GITLAB_TOKEN', () => {
        expect(resolveGitlabToken({ SFN_DIAGRAM_GITLAB_TOKEN: 'b' })).toBe('b');
    });

    it('returns null when neither is set', () => {
        expect(resolveGitlabToken({})).toBeNull();
    });
});

/** A minimal fetch stub simulating GitLab's merge request Notes API. */
function makeFetchStub(existingNotes: { body: string; id: number }[] = []) {
    let nextId = 1000;
    const calls: { init?: RequestInit; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ init, url });
        if (!init || init.method === undefined) {
            return new Response(JSON.stringify(existingNotes), { status: 200 });
        }
        if (init.method === 'POST') {
            const body = JSON.parse(init.body as string) as { body: string };
            return new Response(
                JSON.stringify({ body: body.body, id: nextId++ }),
                { status: 201 },
            );
        }
        if (init.method === 'PUT') {
            const idMatch = url.match(/\/notes\/(\d+)$/);
            return new Response(JSON.stringify({ id: Number(idMatch?.[1]) }), {
                status: 200,
            });
        }
        throw new Error(`Unhandled method in stub: ${init.method}`);
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('upsertMergeRequestNote', () => {
    const baseParams = {
        apiUrl: 'https://gitlab.example.com/api/v4',
        body: '<!-- marker -->\nhello',
        marker: '<!-- marker -->',
        mergeRequestIid: 7,
        projectId: '42',
        token: 'tok',
    };

    it('creates a note when none with the marker exists', async () => {
        const { calls, fetchImpl } = makeFetchStub([]);
        const result = await upsertMergeRequestNote({
            ...baseParams,
            fetchImpl,
        });
        expect(result.action).toBe('created');
        expect(calls.some((call) => call.init?.method === 'POST')).toBe(true);
    });

    it('updates the existing note found by marker instead of creating a new one', async () => {
        const { calls, fetchImpl } = makeFetchStub([
            { body: '<!-- marker -->\nold', id: 55 },
            { body: 'unrelated note', id: 56 },
        ]);
        const result = await upsertMergeRequestNote({
            ...baseParams,
            fetchImpl,
        });
        expect(result).toEqual({ action: 'updated', noteId: 55 });
        expect(
            calls.some(
                (call) =>
                    call.init?.method === 'PUT' &&
                    call.url.includes('/notes/55'),
            ),
        ).toBe(true);
        expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
    });

    it('finds the marker note on a later page instead of giving up after page 1', async () => {
        const page1Notes = Array.from({ length: 100 }, (_, index) => ({
            body: `unrelated note ${index}`,
            id: index,
        }));
        const page2Notes = [{ body: '<!-- marker -->\nold', id: 999 }];

        const calls: { init?: RequestInit; url: string }[] = [];
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ init, url });
            if (!init || init.method === undefined) {
                const page = new URL(url).searchParams.get('page');
                if (page === '2') {
                    return new Response(JSON.stringify(page2Notes), { status: 200 });
                }
                return new Response(JSON.stringify(page1Notes), {
                    headers: { 'x-next-page': '2' },
                    status: 200,
                });
            }
            if (init.method === 'PUT') {
                const idMatch = url.match(/\/notes\/(\d+)$/);
                return new Response(JSON.stringify({ id: Number(idMatch?.[1]) }), { status: 200 });
            }
            throw new Error(`Unhandled method in stub: ${init.method}`);
        });

        const result = await upsertMergeRequestNote({
            ...baseParams,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        expect(result).toEqual({ action: 'updated', noteId: 999 });
        expect(calls.filter((call) => !call.init || call.init.method === undefined)).toHaveLength(2);
    });

    it('throws when the list request fails', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValue(new Response('nope', { status: 403 }));
        await expect(
            upsertMergeRequestNote({
                ...baseParams,
                fetchImpl: fetchImpl as unknown as typeof fetch,
            }),
        ).rejects.toThrow(/403/);
    });
});

const simpleAsl = (name: string) =>
    JSON.stringify({ StartAt: name, States: { [name]: { Type: 'Succeed' } } });

/** A single Pass-chain ASL definition whose Mermaid diagram exceeds `MAX_INLINE_MERMAID_CHARS`. */
function oversizedAsl(): string {
    const stateNames = Array.from(
        { length: 80 },
        (_, index) => `StateNumber${index}`,
    );
    const states: Record<string, unknown> = {};
    stateNames.forEach((name, index) => {
        const next = stateNames[index + 1];
        states[name] = next
            ? { Type: 'Pass', Next: next }
            : { Type: 'Succeed' };
    });
    return JSON.stringify({ StartAt: stateNames[0], States: states });
}

// Spawns a real git repo per test; see changedFiles.test.ts for the budget.
describe('runGitlabComment (integration, real git repo)', { timeout: 30_000 }, () => {
    let repo: string;
    let outputDir: string;

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'sfn-ci-gitlab-'));
        outputDir = mkdtempSync(join(tmpdir(), 'sfn-ci-artifacts-'));
        git(repo, 'init', '-q');
        git(repo, 'config', 'user.email', 'test@example.com');
        git(repo, 'config', 'user.name', 'Test');
    });

    afterEach(() => {
        rmSync(repo, { force: true, recursive: true });
        rmSync(outputDir, { force: true, recursive: true });
    });

    const baseParams = {
        aslGlob: '**/*.asl.json',
        commentTag: 'sfn-diagram-preview',
        executionMode: 'off' as const,
        outputDir: '',
        stateMachineArn: '',
        theme: 'light' as const,
    };

    it('exits 0 with an info log outside a merge request pipeline', async () => {
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {},
            outputDir,
        });
        expect(result.exitCode).toBe(0);
        expect(result.logs[0].message).toContain(
            'CI_MERGE_REQUEST_DIFF_BASE_SHA',
        );
    });

    it('exits 0 and skips commenting when no ASL files changed', async () => {
        writeFileSync(join(repo, 'unrelated.ts'), 'export {}');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'unrelated.ts'), 'export const x = 1');
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: { CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha },
            outputDir,
        });
        expect(result.exitCode).toBe(0);
        expect(
            result.logs.some((entry) =>
                entry.message.includes('No ASL files changed'),
            ),
        ).toBe(true);
    });

    it('renders but skips commenting (exit 0) when no GITLAB_TOKEN is set', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'new.asl.json'), simpleAsl('A'));
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const { calls, fetchImpl } = makeFetchStub([]);
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: { CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha },
            fetchImpl,
            outputDir,
        });

        expect(result.exitCode).toBe(0);
        expect(
            result.logs.some((entry) =>
                entry.message.includes('No GITLAB_TOKEN'),
            ),
        ).toBe(true);
        expect(calls).toHaveLength(0);
    });

    it('creates a merge request note when a token and MR context are present', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'new.asl.json'), simpleAsl('A'));
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const { calls, fetchImpl } = makeFetchStub([]);
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
                CI_MERGE_REQUEST_IID: '7',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
                GITLAB_TOKEN: 'tok',
            },
            fetchImpl,
            outputDir,
        });

        expect(result.exitCode).toBe(0);
        const postCall = calls.find((call) => call.init?.method === 'POST');
        expect(postCall).toBeDefined();
        const posted = JSON.parse(postCall!.init!.body as string) as {
            body: string;
        };
        expect(posted.body).toContain(
            '<!-- sfn-diagram:sfn-diagram-preview-->',
        );
        expect(posted.body).toContain('✨ **New file**');
        expect(posted.body).toContain('```mermaid');
    });

    it('updates the existing note (found by marker) on a second run instead of creating a new one', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'new.asl.json'), simpleAsl('A'));
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const { fetchImpl } = makeFetchStub([
            { body: '<!-- sfn-diagram:sfn-diagram-preview-->\nold', id: 900 },
        ]);
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
                CI_MERGE_REQUEST_IID: '7',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
                GITLAB_TOKEN: 'tok',
            },
            fetchImpl,
            outputDir,
        });

        expect(result.exitCode).toBe(0);
        expect(
            result.logs.some((entry) =>
                entry.message.includes('Updated merge request note #900'),
            ),
        ).toBe(true);
    });

    it('returns exit 1 with an error log when the base ref cannot be diffed', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'only commit');

        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: { CI_MERGE_REQUEST_DIFF_BASE_SHA: 'deadbeef' },
            outputDir,
        });

        expect(result.exitCode).toBe(1);
        expect(
            result.logs.some(
                (entry) =>
                    entry.level === 'error' &&
                    entry.message.includes('GIT_DEPTH'),
            ),
        ).toBe(true);
    });

    it('returns exit 1 with an error log when posting the comment fails', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'new.asl.json'), simpleAsl('A'));
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const fetchImpl = vi
            .fn()
            .mockResolvedValue(new Response('nope', { status: 500 }));
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
                CI_MERGE_REQUEST_IID: '7',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
                GITLAB_TOKEN: 'tok',
            },
            fetchImpl: fetchImpl as unknown as typeof fetch,
            outputDir,
        });

        expect(result.exitCode).toBe(1);
        expect(result.logs.some((entry) => entry.level === 'error')).toBe(true);
    });

    it('falls back to SVG artifacts and omits inline Mermaid once the report exceeds the char budget', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'big.asl.json'), oversizedAsl());
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        const { fetchImpl } = makeFetchStub([]);
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
                CI_MERGE_REQUEST_IID: '7',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
                GITLAB_TOKEN: 'tok',
            },
            fetchImpl,
            outputDir,
        });

        expect(result.exitCode).toBe(0);
        expect(
            result.logs.some((entry) =>
                entry.message.includes(`exceeded GitLab's ~2000-character`),
            ),
        ).toBe(true);
        expect(existsSync(join(outputDir, 'big.asl.json.svg'))).toBe(true);
        const svgContent = readdirSync(outputDir);
        expect(svgContent).toContain('big.asl.json.svg');
    });

    it('omits the execution overlay diagram too once the combined report exceeds the char budget', async () => {
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
        const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
        writeFileSync(join(repo, 'big.asl.json'), oversizedAsl());
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'head');

        fetchExecutionForOverlayMock.mockResolvedValue({
            events: [],
            executionArn: 'arn:aws:states:us-east-1:1:execution:x:run-1',
            status: 'SUCCEEDED',
        });

        const { calls: fetchCalls, fetchImpl } = makeFetchStub([]);
        const result = await runGitlabComment({
            ...baseParams,
            cwd: repo,
            env: {
                CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
                CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
                CI_MERGE_REQUEST_IID: '7',
                CI_MERGE_REQUEST_PROJECT_ID: '42',
                GITLAB_TOKEN: 'tok',
            },
            executionMode: 'latest',
            fetchImpl,
            outputDir,
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });

        expect(result.exitCode).toBe(0);
        expect(fetchExecutionForOverlayMock).toHaveBeenCalled();
        const postCall = fetchCalls.find((call) => call.init?.method === 'POST');
        expect(postCall).toBeDefined();
        const posted = JSON.parse(postCall!.init!.body as string) as { body: string };
        // The overlay section still appears (with its header/status line), but
        // without its own fenced Mermaid block — the fix under test: an
        // oversized overlay diagram no longer bypasses the budget that already
        // pushed the changed-file diagrams to SVG fallback.
        expect(posted.body).toContain('Execution overlay');
        expect(posted.body).toContain('Execution diagram omitted');
        expect(posted.body.match(/```mermaid/g)).toBeNull();
    });

    it("MAX_INLINE_MERMAID_CHARS leaves headroom under GitLab's shared 2000-char page budget", () => {
        expect(MAX_INLINE_MERMAID_CHARS).toBeLessThan(2000);
    });
});
