import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemplateFileReader } from '../src/cliTemplateFiles';

describe('createTemplateFileReader', () => {
    let tempDir: string;
    let readFile: ReturnType<typeof createTemplateFileReader>;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-template-files-'));
        mkdirSync(join(tempDir, 'a', 'sm'), { recursive: true });
        writeFileSync(join(tempDir, 'a', 'template.yaml'), 'Resources: {}\n');
        writeFileSync(join(tempDir, 'a', 'sm', 'x.asl.json'), '{"StartAt":"A"}');
        readFile = createTemplateFileReader({ templatePath: join(tempDir, 'a', 'template.yaml') });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("reads a path relative to the template's directory", () => {
        expect(readFile({ path: 'sm/x.asl.json' })).toBe('{"StartAt":"A"}');
    });

    it('names the absolute path when the file does not exist', () => {
        expect(() => readFile({ path: 'nope.json' })).toThrow(
            `${join(tempDir, 'a', 'nope.json')} does not exist`,
        );
    });

    it('refuses a directory', () => {
        mkdirSync(join(tempDir, 'a', 'dir'));
        expect(() => readFile({ path: 'dir' })).toThrow(`${join(tempDir, 'a', 'dir')} is not a file`);
    });

    // A blocking open of a FIFO waits for a writer, so a regression hangs until the test
    // times out. Windows has no FIFOs in the file system.
    it.skipIf(process.platform === 'win32')('refuses a FIFO without waiting for a writer', () => {
        const fifoPath = join(tempDir, 'a', 'pipe');
        execFileSync('mkfifo', [fifoPath]);
        expect(() => readFile({ path: 'pipe' })).toThrow(`${fifoPath} is not a file`);
    });

    it('refuses a file over the size limit without reading it', () => {
        const hugePath = join(tempDir, 'a', 'huge.log');
        writeFileSync(hugePath, '');
        // Sparse, so the test writes no real data.
        truncateSync(hugePath, 10 * 1024 * 1024 + 1);
        expect(() => readFile({ path: 'huge.log' })).toThrow(
            `${hugePath} is 10485761 bytes, over the 10485760-byte limit for a definition file`,
        );
    });

    // ENOTDIR on POSIX, ENOENT on Windows: the same message either way.
    it('reports a path through a file as missing', () => {
        expect(() => readFile({ path: 'sm/x.asl.json/inner' })).toThrow(
            `${join(tempDir, 'a', 'sm', 'x.asl.json', 'inner')} does not exist`,
        );
    });
});
