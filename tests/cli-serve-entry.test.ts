import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// These tests spawn the built bin, so they need dist/bin.js. The build runs before
// tests in CI; locally, `pnpm run build` first or they are skipped.
const binPath = resolve(__dirname, '..', 'dist', 'bin.js');
const fixture = join(__dirname, 'fixtures', 'simple.asl.json');

describe.skipIf(!existsSync(binPath))('sfn-diagram serve from the built bin', { timeout: 60_000 }, () => {
    let workDir: string;
    let child: ChildProcess;
    let base: string;

    beforeAll(async () => {
        // An empty directory, so no config file is found above it.
        workDir = mkdtempSync(join(tmpdir(), 'sfn-serve-entry-'));
        child = spawn(process.execPath, [binPath, 'serve', '--port', '0'], {
            cwd: workDir,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        base = await new Promise<string>((resolveBase, reject) => {
            let stderr = '';
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
                const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
                if (match) resolveBase(match[1]);
            });
            child.once('exit', (code) => reject(new Error(`serve exited with ${code}: ${stderr}`)));
        });
    }, 60_000);

    afterAll(async () => {
        // Windows keeps the directory locked while the server's cwd is inside it.
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
            child.kill();
            await exited;
        }
        rmSync(workDir, { force: true, recursive: true });
    });

    it('answers /healthz', async () => {
        const response = await fetch(`${base}/healthz`);
        expect(response.status).toBe(200);
    });

    it('renders svg byte for byte like the CLI', async () => {
        const cli = spawnSync(process.execPath, [binPath, fixture, '--format', 'svg'], {
            cwd: workDir,
            encoding: 'utf-8',
        });
        expect(cli.status).toBe(0);
        const response = await fetch(`${base}/render?format=svg`, {
            body: readFileSync(fixture),
            method: 'POST',
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(cli.stdout);
    });
});
