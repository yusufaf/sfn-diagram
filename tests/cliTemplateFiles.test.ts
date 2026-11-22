import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

    // ENOTDIR on POSIX, ENOENT on Windows: the same message either way.
    it('reports a path through a file as missing', () => {
        expect(() => readFile({ path: 'sm/x.asl.json/inner' })).toThrow(
            `${join(tempDir, 'a', 'sm', 'x.asl.json', 'inner')} does not exist`,
        );
    });
});
