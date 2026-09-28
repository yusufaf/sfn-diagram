import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Filenames the CLI looks for, in the order they win a tie within one directory.
 *
 * `.sfn-diagramrc` has no extension and is parsed as YAML, which accepts JSON too
 * (YAML 1.2 is a JSON superset), so one parser covers every name here.
 */
export const CONFIG_FILENAMES: readonly string[] = [
    'sfn-diagram.config.json',
    'sfn-diagram.config.yaml',
    'sfn-diagram.config.yml',
    '.sfn-diagramrc',
    '.sfn-diagramrc.json',
    '.sfn-diagramrc.yaml',
];

/**
 * A config file that could not be found, parsed, or validated.
 *
 * Carries no exit code: a bad file is a runtime failure (exit 1) under the CLI's
 * exit-code convention, never a usage error, so there is nothing per-instance to
 * choose. `run()` maps it to `EXIT_FAILURE`.
 */
export class CliConfigError extends Error {}

/** Parameters for {@link discoverConfigPath}. */
export interface DiscoverConfigPathParams {
    /** Directory to start from; the search walks up from here. */
    startDir: string;
}

/** Whether `path` exists and is a regular file. */
function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/** Whether `path` exists at all, as a file or a directory. */
function exists(path: string): boolean {
    try {
        statSync(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the nearest config file at or above `startDir`.
 *
 * Walks up one directory at a time, checking {@link CONFIG_FILENAMES} in order within
 * each, and stops after the first directory that contains a `.git` entry — a config
 * belongs to a project, and without that stop the search would climb into a developer's
 * home directory and pick up an unrelated file. `.git` is checked as an entry of any
 * kind, since a worktree's `.git` is a file rather than a directory.
 *
 * The walk starts at the working directory rather than at the input file's directory,
 * so `sfn-diagram sub/dir/machine.asl.json` does not pick up
 * `sub/dir/sfn-diagram.config.json`. That keeps one invocation's configuration
 * independent of which input it happens to name.
 *
 * @param params - Search parameters
 * @param params.startDir - Directory to start from
 *
 * @returns The absolute path of the nearest config file, or `null` if there is none.
 *
 * @example
 * ```typescript
 * discoverConfigPath({ startDir: process.cwd() }); // '/repo/sfn-diagram.config.json'
 * ```
 */
export function discoverConfigPath(
    params: DiscoverConfigPathParams,
): string | null {
    const { startDir } = params;
    let directory = resolve(startDir);

    for (;;) {
        for (const filename of CONFIG_FILENAMES) {
            const candidate = join(directory, filename);
            if (isFile(candidate)) return candidate;
        }
        // A repository root ends the search, after its own files have been checked.
        if (exists(join(directory, '.git'))) return null;

        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}
