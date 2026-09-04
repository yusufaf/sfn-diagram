import { execFileSync } from 'node:child_process';

// See the matching comment in src/ci/changedFiles.ts: git sets GIT_DIR (and
// friends) in the environment of any process it invokes as a hook, including
// this repo's own pre-commit hook that runs this very test suite. Without
// stripping them, a git command run against a throwaway temp repo would
// silently operate on the real repository instead — which is exactly how a
// run of these tests once corrupted this branch's history mid-development.
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

function sanitizedGitEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of GIT_ENV_VARS_TO_STRIP) delete env[key];
    return env;
}

/** Runs `git` scoped to `cwd`, immune to an inherited GIT_DIR/GIT_WORK_TREE. */
export function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', env: sanitizedGitEnv() });
}
