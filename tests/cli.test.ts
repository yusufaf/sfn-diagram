import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError, parseArgs, run } from '../src/cli';

const simpleFixture = join(__dirname, 'fixtures', 'simple.asl.json');

describe('parseArgs', () => {
    it('applies sensible defaults', () => {
        const args = parseArgs(['state.asl.json']);
        expect(args).toMatchObject({
            format: 'svg',
            input: 'state.asl.json',
            layout: 'TB',
            output: null,
            showHelp: false,
            showVersion: false,
            theme: 'light',
        });
    });

    it('parses --format, -o, --theme and --layout', () => {
        const args = parseArgs([
            'in.json',
            '--format',
            'mermaid',
            '-o',
            'out.mmd',
            '--theme',
            'dark',
            '--layout',
            'LR',
        ]);
        expect(args).toMatchObject({
            format: 'mermaid',
            input: 'in.json',
            layout: 'LR',
            output: 'out.mmd',
            theme: 'dark',
        });
    });

    it('accepts --output as an alias for -o', () => {
        expect(parseArgs(['in.json', '--output', 'out.svg']).output).toBe('out.svg');
    });

    it('sets showHelp for -h and --help', () => {
        expect(parseArgs(['-h']).showHelp).toBe(true);
        expect(parseArgs(['--help']).showHelp).toBe(true);
    });

    it('sets showVersion for -v and --version', () => {
        expect(parseArgs(['-v']).showVersion).toBe(true);
        expect(parseArgs(['--version']).showVersion).toBe(true);
    });

    it('treats "-" as the stdin input', () => {
        expect(parseArgs(['-']).input).toBe('-');
    });

    it('rejects an invalid --format with exit code 2', () => {
        expect(() => parseArgs(['in.json', '--format', 'gif'])).toThrowError(CliError);
        try {
            parseArgs(['in.json', '--format', 'gif']);
        } catch (error) {
            expect((error as CliError).exitCode).toBe(2);
        }
    });

    it('rejects an invalid --theme', () => {
        expect(() => parseArgs(['in.json', '--theme', 'neon'])).toThrowError(/Invalid --theme/);
    });

    it('rejects an invalid --layout', () => {
        expect(() => parseArgs(['in.json', '--layout', 'ZZ'])).toThrowError(/Invalid --layout/);
    });

    it('rejects an unknown flag', () => {
        expect(() => parseArgs(['in.json', '--nope'])).toThrowError(/Unknown flag/);
    });

    it('rejects a second positional argument', () => {
        expect(() => parseArgs(['a.json', 'b.json'])).toThrowError(/Unexpected positional/);
    });

    it('errors when a flag is missing its value', () => {
        expect(() => parseArgs(['in.json', '--format'])).toThrowError(/requires a value/);
    });
});

describe('run', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdoutData += chunk.toString();
            return true;
        });
        stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderrData += chunk.toString();
            return true;
        });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-'));
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes SVG to stdout by default', async () => {
        const code = await run([simpleFixture]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
    });

    it('writes SVG to a file with -o', async () => {
        const outPath = join(tempDir, 'out.svg');
        const code = await run([simpleFixture, '-o', outPath]);
        expect(code).toBe(0);
        expect(readFileSync(outPath, 'utf-8')).toContain('<svg');
        expect(stdoutData).toBe('');
    });

    it('writes Mermaid to stdout', async () => {
        const code = await run([simpleFixture, '--format', 'mermaid']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('stateDiagram-v2');
    });

    it('writes Mermaid to a file with -o', async () => {
        const outPath = join(tempDir, 'out.mmd');
        const code = await run([simpleFixture, '--format', 'mermaid', '-o', outPath]);
        expect(code).toBe(0);
        expect(readFileSync(outPath, 'utf-8')).toContain('stateDiagram-v2');
    });

    it('honors --theme and --layout for SVG', async () => {
        const code = await run([simpleFixture, '--theme', 'dark', '--layout', 'LR']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
    });

    it('prints help and exits 0', async () => {
        const code = await run(['--help']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('Usage:');
    });

    it('prints a version and exits 0', async () => {
        const code = await run(['--version']);
        expect(code).toBe(0);
        expect(stdoutData.trim()).toMatch(/^\d+\.\d+\.\d+|unknown$/);
    });

    it('returns exit code 2 for an invalid flag value', async () => {
        const code = await run([simpleFixture, '--format', 'gif']);
        expect(code).toBe(2);
        expect(stderrData).toContain('Invalid --format');
    });

    it('requires --output when --format is png', async () => {
        const code = await run([simpleFixture, '--format', 'png']);
        expect(code).toBe(1);
        expect(stderrData).toContain('--output is required');
    });

    it('returns exit code 1 when the input file is missing', async () => {
        const code = await run([join(tempDir, 'does-not-exist.json')]);
        expect(code).toBe(1);
        expect(stderrData).toContain('Failed to read input');
    });

    it('returns exit code 1 for invalid ASL', async () => {
        const badPath = join(tempDir, 'bad.asl.json');
        writeFileSync(badPath, '{ not valid json');
        const code = await run([badPath]);
        expect(code).toBe(1);
        expect(stderrData).toContain('Error:');
    });

    it('--hide-catch removes error-handler nodes from output', async () => {
        const asl = JSON.stringify({
            StartAt: 'T',
            States: {
                T: {
                    Type: 'Task',
                    Resource: 'arn:x',
                    Next: 'Done',
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'H' }],
                },
                H: { Type: 'Fail', Error: 'x' },
                Done: { Type: 'Succeed' },
            },
        });
        const inputPath = join(tempDir, 'catch.asl.json');
        writeFileSync(inputPath, asl);

        const withCatchCode = await run([inputPath, '--format', 'mermaid']);
        const withCatch = stdoutData;
        expect(withCatchCode).toBe(0);
        expect(withCatch).toContain('H');

        stdoutData = '';
        const withoutCode = await run([inputPath, '--format', 'mermaid', '--hide-catch']);
        expect(withoutCode).toBe(0);
        expect(stdoutData).not.toContain(' H\n');
    });
});
