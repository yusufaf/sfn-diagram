/**
 * Git-based changed-file discovery for CI integrations that don't have (or
 * don't want to need) a forge API token — notably GitLab, where posting a
 * comment needs a token but reading the diff never should. Node-only.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchesPatterns } from './buildReport';

// Git sets GIT_DIR (and friends) in the environment of any process it invokes
// as a hook — including this project's own pre-commit hook, which runs the
// test suite that exercises this module. Without stripping them,
// execFileSync('git', ..., { cwd }) silently ignores `cwd` and operates on
// the invoking repository instead (per git's own docs: "If GIT_DIR is set
// but GIT_WORK_TREE is not, the current working directory is regarded as the
// top level of your working tree") — so a caller working against a temp
// clone, or any repo other than the ambient one, ends up reading and writing
// the wrong repository. Every git invocation in this module goes through
// `gitEnv()` to close that off.
const GIT_ENV_VARS_TO_STRIP = [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_PREFIX',
    'GIT_WORK_TREE',
];

/**
 * An env object safe to pass to a spawned `git` command — a copy of
 * `process.env` with any inherited GIT_DIR/GIT_WORK_TREE (and friends)
 * stripped. Exported so tests building their own throwaway git fixtures can
 * reuse the exact same list rather than keeping a second copy in sync.
 */
export function gitEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of GIT_ENV_VARS_TO_STRIP) delete env[key];
    return env;
}

export interface ChangedAslFile {
    /** Path to read the "before" content at (via `git show <baseRef>:<basePath>`); differs from `filename` only for a rename. */
    basePath: string;
    filename: string;
    status: 'added' | 'modified' | 'removed';
}

export interface GetChangedAslFilesParams {
    /** The merge/pull request's base ref (a SHA or ref name) to diff against `HEAD`. */
    baseRef: string;
    cwd?: string;
    patterns: string[];
}

/**
 * Lists files changed between `baseRef` and `HEAD` (three-dot: against their
 * merge base, matching how GitHub/GitLab compute a PR/MR diff) that match the
 * given glob patterns.
 *
 * @throws if `git diff` fails — most commonly a `baseRef` the checkout doesn't
 * have, which usually means the pipeline needs a deeper clone (`GIT_DEPTH: 0`
 * or `fetch-depth: 0`).
 */
export function getChangedAslFiles(
    params: GetChangedAslFilesParams,
): ChangedAslFile[] {
    const { baseRef, cwd = process.cwd(), patterns } = params;

    const output = execFileSync(
        'git',
        ['diff', '--name-status', '--diff-filter=ACDMR', `${baseRef}...HEAD`],
        { cwd, encoding: 'utf-8', env: gitEnv() },
    );

    const files: ChangedAslFile[] = [];
    for (const line of output.split('\n')) {
        if (!line.trim()) continue;

        const fields = line.split('\t');
        const statusCode = fields[0][0];
        // A rename/copy line is `R100\told\tnew` (three fields); everything
        // else is `X\tpath` (two fields).
        const [basePath, filename] =
            statusCode === 'R' || statusCode === 'C'
                ? [fields[1], fields[2]]
                : [fields[1], fields[1]];

        if (!matchesPatterns(filename, patterns)) continue;

        const status: ChangedAslFile['status'] =
            statusCode === 'A'
                ? 'added'
                : statusCode === 'D'
                  ? 'removed'
                  : 'modified';
        files.push({ basePath, filename, status });
    }

    return files;
}

/** Reads a file's content at a git ref via `git show`, or `null` if it doesn't exist there. */
export function readFileAtGitRef(params: {
    cwd?: string;
    path: string;
    ref: string;
}): string | null {
    const { cwd = process.cwd(), path, ref } = params;
    try {
        return execFileSync('git', ['show', `${ref}:${path}`], {
            cwd,
            encoding: 'utf-8',
            env: gitEnv(),
        });
    } catch {
        return null;
    }
}

/** Reads a file from the working tree, or `null` if it doesn't exist (e.g. a deleted file at HEAD). */
export function readWorkingTreeFile(params: {
    cwd?: string;
    path: string;
}): string | null {
    const { cwd = process.cwd(), path } = params;
    try {
        return readFileSync(resolve(cwd, path), 'utf-8');
    } catch {
        return null;
    }
}
