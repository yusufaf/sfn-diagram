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

// These tests spawn the built CLI, so they need dist/cli.js. The build runs
// before tests in CI; locally, `pnpm run build` first or they are skipped.
const cliPath = resolve(__dirname, '..', 'dist', 'cli.js');
const hasBuild = existsSync(cliPath);

function runCli(
    entry: string,
    args: string[],
): { status: number | null; stdout: string } {
    const result = spawnSync(process.execPath, [entry, ...args], {
        encoding: 'utf-8',
    });
    return { status: result.status, stdout: result.stdout };
}

function tryCreateSymlink(target: string, linkPath: string): boolean {
    try {
        symlinkSync(target, linkPath, 'file');
        return true;
    } catch {
        // Creating file symlinks needs a privilege or Developer Mode on
        // Windows; the CI smoke test on Linux covers that path unconditionally.
        return false;
    }
}

describe.skipIf(!hasBuild)('CLI entry guard', () => {
    it('runs when invoked by its real path', () => {
        const result = runCli(cliPath, ['--version']);
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).not.toBe('');
    });

    it('runs when invoked through a symlink, the way npm links the bin', () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-entry-'));
        try {
            const linkPath = join(tempDir, 'sfn-diagram');
            if (!tryCreateSymlink(cliPath, linkPath)) {
                return;
            }
            const result = runCli(linkPath, ['--version']);
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe(
                runCli(cliPath, ['--version']).stdout.trim(),
            );
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('does nothing when imported rather than executed', () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-entry-'));
        try {
            const importer = join(tempDir, 'importer.mjs');
            writeFileSync(
                importer,
                `import ${JSON.stringify(
                    'file:///' + cliPath.replace(/\\/g, '/').replace(/^\//, ''),
                )};\nconsole.log('imported');\n`,
            );
            const result = runCli(importer, ['--version']);
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe('imported');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
