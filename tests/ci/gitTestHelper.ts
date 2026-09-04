import { execFileSync } from 'node:child_process';
import { gitEnv } from '../../src/ci/changedFiles';

/**
 * Runs `git` scoped to `cwd`, immune to an inherited GIT_DIR/GIT_WORK_TREE.
 * Reuses the exact same sanitization `src/ci/changedFiles.ts` applies to its
 * own git calls — see the comment there. A run of these tests once
 * corrupted this branch's history mid-development when this helper didn't.
 */
export function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', env: gitEnv() });
}
