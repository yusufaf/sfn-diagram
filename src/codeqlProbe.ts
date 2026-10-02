/**
 * TEMPORARY probe file. Exists only to prove the CodeQL workflow reports a real
 * finding rather than passing vacuously. Deleted before the PR merges.
 *
 * Nothing imports this; it is not exported from the barrel.
 */
import { execSync } from 'node:child_process';

/** Should trip js/shell-command-injection-from-environment. */
export function probeShellInjection(): void {
    const target = process.argv[2];
    execSync(`ls ${target}`);
}

/** Should trip js/code-injection. */
export function probeCodeInjection(): unknown {
    const payload = process.argv[3];
    // eslint-disable-next-line no-eval
    return eval(payload);
}
