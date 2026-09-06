import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// These tests spawn the built CLI, so they need dist/cli.js. The build runs
// before tests in CI; locally, `pnpm run build` first or they are skipped.
const cliPath = resolve(__dirname, '..', 'dist', 'cli.js');
const hasBuild = existsSync(cliPath);

interface RunCliParams {
    args: string[];
    entry: string;
    nodeFlags?: string[];
}

interface RunCliResult {
    status: number | null;
    stderr: string;
    stdout: string;
}

function runCli({ args, entry, nodeFlags = [] }: RunCliParams): RunCliResult {
    const result = spawnSync(process.execPath, [...nodeFlags, entry, ...args], {
        encoding: 'utf-8',
    });
    return {
        status: result.status,
        stderr: result.stderr,
        stdout: result.stdout,
    };
}

interface TryCreateSymlinkParams {
    linkPath: string;
    target: string;
}

function tryCreateSymlink({
    linkPath,
    target,
}: TryCreateSymlinkParams): boolean {
    try {
        symlinkSync(target, linkPath, 'file');
        return true;
    } catch {
        // Creating file symlinks needs a privilege or Developer Mode on
        // Windows; the CI smoke test on Linux covers that path unconditionally.
        return false;
    }
}

// dist/cli.js keeps its runtime dependencies external, so a symlink to it must
// live where Node's resolution can still walk up to the repo's node_modules:
// under --preserve-symlinks-main, Node resolves those imports relative to the
// symlink, not the real file, and a symlink in the OS temp dir cannot find them.
const symlinkParentDir = resolve(__dirname, '..', 'node_modules');

function withTempDir<T>(
    parentDir: string,
    callback: (tempDir: string) => T,
): T {
    const tempDir = mkdtempSync(join(parentDir, '.sfn-cli-entry-'));
    try {
        return callback(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

// Spawning Node on the bundle takes seconds on a loaded machine; the default
// 5s budget is too tight.
describe.skipIf(!hasBuild)('CLI entry guard', { timeout: 30_000 }, () => {
    const expectedVersion = () => {
        const direct = runCli({ args: ['--version'], entry: cliPath });
        expect(direct.status, direct.stderr).toBe(0);
        return direct.stdout.trim();
    };

    it('runs when invoked by its real path', () => {
        expect(expectedVersion()).not.toBe('');
    });

    it('runs when invoked through a symlink, the way npm links the bin', (context) => {
        withTempDir(symlinkParentDir, (tempDir) => {
            const linkPath = join(tempDir, 'sfn-diagram');
            if (!tryCreateSymlink({ linkPath, target: cliPath })) {
                context.skip();
                return;
            }
            const result = runCli({ args: ['--version'], entry: linkPath });
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(expectedVersion());
        });
    });

    it('runs through a symlink under --preserve-symlinks-main', (context) => {
        withTempDir(symlinkParentDir, (tempDir) => {
            const linkPath = join(tempDir, 'sfn-diagram');
            if (!tryCreateSymlink({ linkPath, target: cliPath })) {
                context.skip();
                return;
            }
            const result = runCli({
                args: ['--version'],
                entry: linkPath,
                nodeFlags: ['--preserve-symlinks-main'],
            });
            expect(result.status, result.stderr).toBe(0);
            // The guard must fire; the version itself resolves package.json
            // relative to the symlink here, so only check that it ran.
            expect(result.stdout.trim()).not.toBe('');
        });
    });

    it('does nothing when imported rather than executed', () => {
        withTempDir(tmpdir(), (tempDir) => {
            const importer = join(tempDir, 'importer.mjs');
            writeFileSync(
                importer,
                `import ${JSON.stringify(pathToFileURL(cliPath).href)};\n` +
                    `console.log('imported');\n`,
            );
            const result = runCli({ args: ['--version'], entry: importer });
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout.trim()).toBe('imported');
        });
    });
});
