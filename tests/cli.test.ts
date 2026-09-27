import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
        expect(parseArgs(['in.json', '--output', 'out.svg']).output).toBe(
            'out.svg',
        );
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
        expect(() => parseArgs(['in.json', '--format', 'gif'])).toThrowError(
            CliError,
        );
        try {
            parseArgs(['in.json', '--format', 'gif']);
        } catch (error) {
            expect((error as CliError).exitCode).toBe(2);
        }
    });

    it('carries an unrecognised --theme through as a file path', () => {
        // `--theme` accepts light, dark, or a path, so the parser can no longer tell a
        // typo from a filename; `run()` reports it when the read fails.
        expect(parseArgs(['in.json', '--theme', 'neon'])).toMatchObject({
            theme: 'light',
            themeFile: 'neon',
        });
    });

    it('rejects an invalid --layout', () => {
        expect(() => parseArgs(['in.json', '--layout', 'ZZ'])).toThrowError(
            /Invalid --layout/,
        );
    });

    it('rejects an unknown flag', () => {
        expect(() => parseArgs(['in.json', '--nope'])).toThrowError(
            /Unknown flag/,
        );
    });

    it('rejects a second positional argument', () => {
        expect(() => parseArgs(['a.json', 'b.json'])).toThrowError(
            /Unexpected positional/,
        );
    });

    it('errors when a flag is missing its value', () => {
        expect(() => parseArgs(['in.json', '--format'])).toThrowError(
            /requires a value/,
        );
    });

    it('parses --check', () => {
        expect(parseArgs(['in.json']).check).toBe(false);
        expect(parseArgs(['in.json', '--check']).check).toBe(true);
    });

    it('parses --diff and --execution', () => {
        expect(parseArgs(['head.json', '--diff', 'base.json']).diff).toBe(
            'base.json',
        );
        expect(
            parseArgs(['head.json', '--execution', 'history.json']).execution,
        ).toBe('history.json');
    });

    it('parses the icon flags', () => {
        const args = parseArgs([
            'in.json',
            '--show-icons',
            '--icon-position',
            'top',
            '--icon-size',
            '32',
        ]);
        expect(args).toMatchObject({
            iconPosition: 'top',
            iconSize: 32,
            showIcons: true,
        });
    });

    it('leaves icon options unset by default', () => {
        const args = parseArgs(['in.json']);
        expect(args).toMatchObject({
            diff: null,
            execution: null,
            hideVariables: false,
            iconPosition: null,
            iconSize: null,
            showIcons: false,
        });
    });

    it('parses --hide-variables', () => {
        expect(parseArgs(['in.json', '--hide-variables']).hideVariables).toBe(
            true,
        );
    });

    it('rejects an invalid --icon-position', () => {
        expect(() =>
            parseArgs(['in.json', '--icon-position', 'below']),
        ).toThrowError(/Invalid --icon-position/);
    });

    it('rejects a non-numeric --icon-size', () => {
        expect(() => parseArgs(['in.json', '--icon-size', 'big'])).toThrowError(
            /Invalid --icon-size/,
        );
    });

    it('rejects a non-positive --icon-size', () => {
        expect(() => parseArgs(['in.json', '--icon-size', '0'])).toThrowError(
            /Invalid --icon-size/,
        );
    });

    it('parses --collapse as a bare flag (collapse all)', () => {
        expect(parseArgs(['in.json', '--collapse']).collapse).toBe(true);
    });

    it('parses --collapse=Name1,Name2 as a name list', () => {
        expect(
            parseArgs(['in.json', '--collapse=Name1,Name2']).collapse,
        ).toEqual(['Name1', 'Name2']);
    });

    it('keeps a backslash-escaped comma inside a --collapse state name', () => {
        expect(
            parseArgs(['in.json', '--collapse=Fetch\\, then merge,Other'])
                .collapse,
        ).toEqual(['Fetch, then merge', 'Other']);
    });

    it('never swallows the input path as a --collapse value', () => {
        const args = parseArgs(['--collapse', 'state.asl.json']);
        expect(args.collapse).toBe(true);
        expect(args.input).toBe('state.asl.json');
    });

    it('defaults --collapse to null (not passed)', () => {
        expect(parseArgs(['in.json']).collapse).toBeNull();
    });

    it('accepts an inline --format=value', () => {
        expect(parseArgs(['in.json', '--format=svg']).format).toBe('svg');
    });

    it('treats everything after -- as positional', () => {
        expect(parseArgs(['--', '-weird.json']).input).toBe('-weird.json');
    });

    it('accepts grouped short flags', () => {
        const args = parseArgs(['-hv']);
        expect(args.showHelp).toBe(true);
        expect(args.showVersion).toBe(true);
    });

    it('does not let --collapse swallow a following flag value', () => {
        const args = parseArgs(['--collapse', '--format', 'svg', 'x.json']);
        expect(args.collapse).toBe(true);
        expect(args.format).toBe('svg');
        expect(args.input).toBe('x.json');
    });

    it('treats an explicit --collapse= (empty) as collapsing nothing', () => {
        expect(parseArgs(['in.json', '--collapse=']).collapse).toEqual([]);
    });

    it('treats a literal --collapse positional after -- as a filename, not a flag', () => {
        const args = parseArgs(['--', '--collapse']);
        expect(args.collapse).toBeNull();
        expect(args.input).toBe('--collapse');
    });

    it('rejects a value on a boolean flag with a clear message', () => {
        expect(() => parseArgs(['in.json', '--hide-catch=true'])).toThrowError(
            /does not take a value/,
        );
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
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
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
        const code = await run([
            simpleFixture,
            '--format',
            'mermaid',
            '-o',
            outPath,
        ]);
        expect(code).toBe(0);
        expect(readFileSync(outPath, 'utf-8')).toContain('stateDiagram-v2');
    });

    it('honors --theme and --layout for SVG', async () => {
        const code = await run([
            simpleFixture,
            '--theme',
            'dark',
            '--layout',
            'LR',
        ]);
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

    it('--check reports a clean definition on stderr and exits 0 with nothing on stdout', async () => {
        const code = await run([simpleFixture, '--check']);
        expect(code).toBe(0);
        expect(stdoutData).toBe('');
        expect(stderrData).toBe('No problems found\n');
    });

    it('--check exits 0 on warnings only, listing each one', async () => {
        const inputPath = join(tempDir, 'warn.asl.json');
        writeFileSync(
            inputPath,
            JSON.stringify({
                StartAt: 'A',
                States: {
                    A: { Type: 'Pass', End: true },
                    Orphan: { Type: 'Pass', End: true },
                },
            }),
        );
        const code = await run([inputPath, '--check']);
        expect(code).toBe(0);
        expect(stderrData).toContain(
            'warning /States/Orphan  State "Orphan" is unreachable from StartAt "A"  [unreachable-state]',
        );
        expect(stderrData).toContain('0 errors, 1 warning\n');
    });

    it('--check exits 1 on an error-severity finding', async () => {
        const inputPath = join(tempDir, 'bad.asl.json');
        writeFileSync(
            inputPath,
            JSON.stringify({
                StartAt: 'A',
                States: { A: { Type: 'Pass', End: true, Next: 'A' } },
            }),
        );
        const code = await run([inputPath, '--check']);
        expect(code).toBe(1);
        expect(stderrData).toContain(
            'error   /States/A/Next  State "A" sets both "End: true" and "Next"  [end-with-next]',
        );
        expect(stderrData).toContain('1 error, 0 warnings\n');
        expect(stdoutData).toBe('');
    });

    it('--check reports invalid JSON as a diagnostic rather than a read failure', async () => {
        const inputPath = join(tempDir, 'broken.asl.json');
        writeFileSync(inputPath, '{ not valid json');
        const code = await run([inputPath, '--check']);
        expect(code).toBe(1);
        expect(stderrData).toContain('[invalid-json]');
    });

    it('--check refuses --diff, --execution and --output', async () => {
        for (const extra of [
            ['--diff', simpleFixture],
            ['--execution', simpleFixture],
            ['-o', 'x.svg'],
        ]) {
            stderrData = '';
            const code = await run([simpleFixture, '--check', ...extra]);
            expect(code).toBe(1);
            expect(stderrData).toContain('--check lints the input only');
        }
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
        expect(withCatch).toContain('class H failState');

        stdoutData = '';
        const withoutCode = await run([
            inputPath,
            '--format',
            'mermaid',
            '--hide-catch',
        ]);
        expect(withoutCode).toBe(0);
        expect(stdoutData).not.toContain('class H failState');
        expect(stdoutData).not.toBe(withCatch);
    });

    it('--format html emits a self-contained viewer', async () => {
        const code = await run([simpleFixture, '--format', 'html']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<!DOCTYPE html>');
        expect(stdoutData).toContain('data-sfn-zoom');
    });

    it('writes HTML to a file with -o', async () => {
        const outPath = join(tempDir, 'out.html');
        const code = await run([
            simpleFixture,
            '--format',
            'html',
            '-o',
            outPath,
        ]);
        expect(code).toBe(0);
        const written = readFileSync(outPath, 'utf-8');
        expect(written).toContain('<!DOCTYPE html>');
        expect(stdoutData).toBe('');
    });

    it('--collapse shrinks the SVG output for a Parallel state machine', async () => {
        const asl = JSON.stringify({
            StartAt: 'FanOut',
            States: {
                FanOut: {
                    Type: 'Parallel',
                    Branches: [
                        {
                            StartAt: 'Branch1',
                            States: {
                                Branch1: {
                                    Type: 'Task',
                                    Resource: 'arn:b1',
                                    End: true,
                                },
                            },
                        },
                        {
                            StartAt: 'Branch2',
                            States: {
                                Branch2: {
                                    Type: 'Task',
                                    Resource: 'arn:b2',
                                    End: true,
                                },
                            },
                        },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        });
        const inputPath = join(tempDir, 'parallel.asl.json');
        writeFileSync(inputPath, asl);

        const codeWithout = await run([inputPath]);
        const withoutSvg = stdoutData;
        stdoutData = '';
        const codeWith = await run([inputPath, '--collapse']);

        expect(codeWithout).toBe(0);
        expect(codeWith).toBe(0);
        expect(stdoutData).toContain('2 states');
        expect(stdoutData.length).toBeLessThan(withoutSvg.length);
    });

    it('--format mermaid --collapse drops the branch states from the output', async () => {
        const asl = JSON.stringify({
            StartAt: 'FanOut',
            States: {
                FanOut: {
                    Type: 'Parallel',
                    Branches: [
                        {
                            StartAt: 'Branch1',
                            States: {
                                Branch1: {
                                    Type: 'Task',
                                    Resource: 'arn:b1',
                                    End: true,
                                },
                            },
                        },
                        {
                            StartAt: 'Branch2',
                            States: {
                                Branch2: {
                                    Type: 'Task',
                                    Resource: 'arn:b2',
                                    End: true,
                                },
                            },
                        },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        });
        const inputPath = join(tempDir, 'parallel.asl.json');
        writeFileSync(inputPath, asl);

        const code = await run([
            inputPath,
            '--format',
            'mermaid',
            '--collapse',
        ]);

        expect(code).toBe(0);
        expect(stdoutData).not.toContain('Branch1');
        expect(stdoutData).not.toContain('Branch2');
        expect(stdoutData).toContain('FanOut');
    });
});

describe('stdin handling', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    const originalStdin = process.stdin;
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        originalIsTTY = process.stdin.isTTY;
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        Object.defineProperty(process, 'stdin', {
            value: originalStdin,
            configurable: true,
        });
        Object.defineProperty(process.stdin, 'isTTY', {
            value: originalIsTTY,
            configurable: true,
        });
    });

    it('prints help and exits 2 on a bare invocation with a TTY, without reading stdin', async () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        });

        const code = await run([]);

        expect(code).toBe(2);
        expect(stderrData).toContain('Usage:');
    });

    it('still reads stdin when input is piped (not a TTY)', async () => {
        const asl = readFileSync(simpleFixture, 'utf-8');
        Object.defineProperty(process, 'stdin', {
            value: Readable.from([Buffer.from(asl)]),
            configurable: true,
        });

        const code = await run([]);

        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
    });

    it('reads stdin for an explicit "-" even on a TTY', async () => {
        const asl = readFileSync(simpleFixture, 'utf-8');
        Object.defineProperty(process, 'stdin', {
            value: Readable.from([Buffer.from(asl)]),
            configurable: true,
        });
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        });

        const code = await run(['-']);

        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
    });
});

describe('diff, execution and icon flags', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;

    const variablesFixture = join(__dirname, 'fixtures', 'variables.asl.json');
    const executionFixture = join(
        __dirname,
        'fixtures',
        'execution-success.json',
    );

    const baseAsl = JSON.stringify({
        StartAt: 'StepA',
        States: {
            StepA: { Type: 'Pass', Next: 'StepB' },
            StepB: { Type: 'Pass', Next: 'StepC' },
            StepC: { Type: 'Succeed' },
        },
    });
    const headAsl = JSON.stringify({
        StartAt: 'StepA',
        States: {
            StepA: { Type: 'Pass', Next: 'NewStep' },
            NewStep: { Type: 'Pass', Next: 'StepB' },
            StepB: { Type: 'Wait', Seconds: 5, End: true },
        },
    });
    const lambdaAsl = JSON.stringify({
        StartAt: 'ProcessData',
        States: {
            ProcessData: {
                Type: 'Task',
                Resource:
                    'arn:aws:lambda:us-east-1:123456789012:function:ProcessData',
                End: true,
            },
        },
    });

    const write = (name: string, content: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, content);
        return path;
    };

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-flags-'));
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('--diff renders an SVG with per-state diff colors', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
        // added green, modified yellow, removed red
        expect(stdoutData).toContain('#c8e6c9');
        expect(stdoutData).toContain('#fff9c4');
        expect(stdoutData).toContain('#ffcdd2');
    });

    it('--diff prints a change summary to stderr', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
        ]);
        expect(code).toBe(0);
        expect(stderrData).toContain('Added');
        expect(stderrData).toContain('NewStep');
        expect(stderrData).toContain('Modified');
        expect(stderrData).toContain('StepB');
        expect(stderrData).toContain('Removed');
        expect(stderrData).toContain('StepC');
    });

    it('--diff with --format mermaid emits diff classes', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '--format',
            'mermaid',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('classDef diffAdded');
        expect(stdoutData).toContain('class NewStep diffAdded');
    });

    it('--diff writes to a file with -o', async () => {
        const outPath = join(tempDir, 'diff.svg');
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '-o',
            outPath,
        ]);
        expect(code).toBe(0);
        expect(readFileSync(outPath, 'utf-8')).toContain('<svg');
        expect(stdoutData).toBe('');
    });

    it('returns exit code 1 when the --diff baseline is missing', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            join(tempDir, 'nope.json'),
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain('Failed to read --diff baseline');
    });

    it('--execution renders an SVG overlay', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            executionFixture,
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
        // succeeded states are green
        expect(stdoutData).toContain('#c8e6c9');
    });

    it('--diff with --format html emits an interactive document', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '--format',
            'html',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<!DOCTYPE html>');
        expect(stdoutData).toContain('data-sfn-zoom'); // viewer toolbar
        expect(stdoutData).toContain('data-state-id="NewStep"');
        // Diff colours survive the wrapping.
        expect(stdoutData).toContain('<svg');
        // The change summary still goes to stderr, not into the document.
        expect(stderrData).toContain('NewStep');
    });

    it('--execution with --format html emits an interactive document', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            executionFixture,
            '--format',
            'html',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<!DOCTYPE html>');
        expect(stdoutData).toContain('data-sfn-zoom');
        // succeeded states are still green under the overlay
        expect(stdoutData).toContain('#c8e6c9');
        expect(stderrData).toContain('succeeded');
    });

    it('--diff and --execution with --format html get clickable edges too', async () => {
        const diffCode = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '--format',
            'html',
        ]);
        expect(diffCode).toBe(0);
        expect(stdoutData).toContain('id="sfn-edge-data"');
        expect(stdoutData).toContain('data-edge-hit-area');

        stdoutData = '';
        stderrData = '';

        const executionCode = await run([
            simpleFixture,
            '--execution',
            executionFixture,
            '--format',
            'html',
        ]);
        expect(executionCode).toBe(0);
        expect(stdoutData).toContain('id="sfn-edge-data"');
        expect(stdoutData).toContain('data-edge-hit-area');
    });

    it('--format svg keeps the interactive-only hit areas out', async () => {
        const code = await run([simpleFixture, '--format', 'svg']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('data-edge-id');
        expect(stdoutData).not.toContain('data-edge-hit-area');
    });

    it('--format html embeds state data for the detail panel', async () => {
        const code = await run([simpleFixture, '--format', 'html']);
        expect(code).toBe(0);
        const match = stdoutData.match(
            /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        expect(JSON.parse(match![1])).toHaveProperty('Process');
    });

    it('--execution prints a status summary to stderr', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            executionFixture,
        ]);
        expect(code).toBe(0);
        expect(stderrData).toContain('succeeded');
        expect(stderrData).toContain('Process');
    });

    it('--execution with --format mermaid emits execution classes', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            executionFixture,
            '--format',
            'mermaid',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('classDef execSucceeded');
        expect(stdoutData).toContain('class Process execSucceeded');
    });

    it('returns exit code 1 when the --execution history is missing', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            join(tempDir, 'nope.json'),
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain('Failed to read --execution history');
    });

    it('rejects --diff combined with --execution', async () => {
        const code = await run([
            simpleFixture,
            '--diff',
            write('base.json', baseAsl),
            '--execution',
            executionFixture,
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain(
            '--diff and --execution cannot be combined',
        );
    });

    it('rejects --diff with a format that has no diff renderer', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '--format',
            'png',
            '-o',
            join(tempDir, 'out.png'),
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain(
            '--diff supports --format svg, mermaid or html',
        );
    });

    it('rejects --execution with a format that has no overlay renderer', async () => {
        const code = await run([
            simpleFixture,
            '--execution',
            executionFixture,
            '--format',
            'png',
            '-o',
            join(tempDir, 'out.png'),
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain(
            '--execution supports --format svg, mermaid or html',
        );
    });

    it('--show-icons renders AWS service icons', async () => {
        const inputPath = write('lambda.asl.json', lambdaAsl);

        const withoutCode = await run([inputPath]);
        expect(withoutCode).toBe(0);
        expect(stdoutData).not.toContain('<image');

        stdoutData = '';
        const code = await run([inputPath, '--show-icons']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<image');
        expect(stdoutData).toContain('AWSLambda.svg');
    });

    it('--icon-size changes the rendered icon dimensions', async () => {
        const inputPath = write('lambda.asl.json', lambdaAsl);
        const code = await run([
            inputPath,
            '--show-icons',
            '--icon-size',
            '40',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('width="40"');
        expect(stdoutData).toContain('height="40"');
    });

    it('--hide-variables drops Assign annotations from the diagram', async () => {
        const withCode = await run([variablesFixture]);
        expect(withCode).toBe(0);
        expect(stdoutData).toContain('$orderId');

        stdoutData = '';
        const code = await run([variablesFixture, '--hide-variables']);
        expect(code).toBe(0);
        expect(stdoutData).not.toContain('$orderId');
    });
});

describe('CFN template input', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;

    const writeTemplate = (name: string, content: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, content);
        return path;
    };

    const cfnJson = JSON.stringify({
        Resources: {
            M: {
                Type: 'AWS::StepFunctions::StateMachine',
                Properties: {
                    DefinitionString: {
                        'Fn::Join': [
                            '',
                            [
                                '{"StartAt":"Run","States":{"Run":{"Type":"Task","Resource":"arn:',
                                { Ref: 'AWS::Partition' },
                                ':x","Next":"Done"},"Done":{"Type":"Succeed"}}}',
                            ],
                        ],
                    },
                },
            },
        },
    });

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-cfn-'));
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('parses --resolve-cfn and --resource', () => {
        const args = parseArgs([
            't.json',
            '--resolve-cfn',
            '--resource',
            'MyMachine',
        ]);
        expect(args.resolveCfn).toBe(true);
        expect(args.resource).toBe('MyMachine');
    });

    it('auto-detects a template and renders its ASL', async () => {
        const inputPath = writeTemplate('template.json', cfnJson);
        const code = await run([inputPath, '--format', 'mermaid']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('Run');
        expect(stdoutData).toContain('Done');
    });

    it('resolves a YAML template with --resolve-cfn', async () => {
        const yamlTemplate = [
            'Resources:',
            '  Machine:',
            '    Type: AWS::StepFunctions::StateMachine',
            '    Properties:',
            '      DefinitionString: !Sub |',
            '        {"StartAt":"Go","States":{"Go":{"Type":"Pass","End":true}}}',
        ].join('\n');
        const inputPath = writeTemplate('template.yaml', yamlTemplate);
        const code = await run([
            inputPath,
            '--resolve-cfn',
            '--format',
            'mermaid',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('Go');
    });

    it('errors with resource ids when multiple machines and no --resource', async () => {
        const multi = JSON.stringify({
            Resources: {
                A: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString:
                            '{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}',
                    },
                },
                B: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString:
                            '{"StartAt":"B","States":{"B":{"Type":"Succeed"}}}',
                    },
                },
            },
        });
        const inputPath = writeTemplate('multi.json', multi);
        const code = await run([inputPath, '--format', 'mermaid']);
        expect(code).toBe(1);
        expect(stderrData).toMatch(/A.*B|B.*A/s);
    });

    it('selects a machine with --resource', async () => {
        const multi = JSON.stringify({
            Resources: {
                A: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString:
                            '{"StartAt":"Alpha","States":{"Alpha":{"Type":"Succeed"}}}',
                    },
                },
                B: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString:
                            '{"StartAt":"Beta","States":{"Beta":{"Type":"Succeed"}}}',
                    },
                },
            },
        });
        const inputPath = writeTemplate('multi.json', multi);
        const code = await run([
            inputPath,
            '--format',
            'mermaid',
            '--resource',
            'B',
        ]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('Beta');
        expect(stdoutData).not.toContain('Alpha');
    });

    it('leaves plain ASL input untouched', async () => {
        const code = await run([simpleFixture, '--format', 'mermaid']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('stateDiagram-v2');
    });
});

describe('standalone binary build info', () => {
    const buildGlobal = globalThis as { __SFN_DIAGRAM_BUILD__?: unknown };
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        buildGlobal.__SFN_DIAGRAM_BUILD__ = {
            standalone: true,
            version: '9.9.9',
        };
    });

    afterEach(() => {
        delete buildGlobal.__SFN_DIAGRAM_BUILD__;
        stdout.mockRestore();
        stderr.mockRestore();
    });

    it('reports the baked-in version instead of reading package.json', async () => {
        const code = await run(['--version']);
        expect(code).toBe(0);
        expect(stdoutData).toBe('9.9.9\n');
    });

    it('refuses --format png with a pointer to the npm package', async () => {
        const code = await run([
            simpleFixture,
            '--format',
            'png',
            '-o',
            'out.png',
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain('not available in the standalone binary');
        expect(stderrData).toContain('@resvg/resvg-js');
    });

    it('still renders SVG', async () => {
        const code = await run([simpleFixture]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
    });
});

const choiceFixture = join(__dirname, 'fixtures', 'choice.asl.json');
const errorHandlingFixture = join(
    __dirname,
    'fixtures',
    'error-handling.asl.json',
);
const executionHistoryFixture = join(
    __dirname,
    'fixtures',
    'execution-success.json',
);

/** The root `<svg>`'s own `width`, ignoring the background rect's. */
function svgWidth(svg: string): number {
    const match = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
    if (!match) throw new Error('no <svg width> found');
    return Number(match[1]);
}

/** The root `<svg>`'s own `height`. */
function svgHeight(svg: string): number {
    const match = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
    if (!match) throw new Error('no <svg height> found');
    return Number(match[1]);
}

/**
 * Tag name of the shape element drawn for the Choice state — `rect` under the
 * `aws-standard` preset, `path` (a diamond) under `enhanced`. Throws rather than
 * returning a miss, so a structural change surfaces as a failure instead of an
 * assertion that quietly holds for the wrong reason.
 */
function choiceNodeShape(svg: string): string {
    const match =
        /data-state-type="Choice"[^>]*>(?:<title>[^<]*<\/title>)?<(\w+)/.exec(
            svg,
        );
    if (!match) throw new Error('no Choice node shape found');
    return match[1];
}

describe('parseArgs: DiagramOptions flags', () => {
    it('leaves every new option unset by default', () => {
        expect(parseArgs(['in.json'])).toMatchObject({
            backgroundColor: null,
            catchLabelStyle: null,
            diagramDescription: null,
            diagramTitle: null,
            edgeStyle: null,
            hideComments: false,
            nodeHeight: null,
            nodeSeparation: null,
            nodeWidth: null,
            padding: null,
            rankSeparation: null,
            showStateTypes: false,
            stylePreset: null,
            themeFile: null,
        });
    });

    it('parses the enum flags', () => {
        expect(
            parseArgs([
                'in.json',
                '--edge-style',
                'straight',
                '--style-preset',
                'enhanced',
                '--catch-label-style',
                'catch-number',
            ]),
        ).toMatchObject({
            catchLabelStyle: 'catch-number',
            edgeStyle: 'straight',
            stylePreset: 'enhanced',
        });
    });

    it.each([
        ['--edge-style', 'wiggly'],
        ['--style-preset', 'fancy'],
        ['--catch-label-style', 'numbers'],
    ])('rejects an invalid %s with exit code 2', (flag, value) => {
        try {
            parseArgs(['in.json', flag, value]);
            expect.unreachable(`${flag} ${value} should not parse`);
        } catch (error) {
            expect(error).toBeInstanceOf(CliError);
            expect((error as CliError).exitCode).toBe(2);
            expect((error as CliError).message).toContain(
                `Invalid ${flag}: ${value}`,
            );
        }
    });

    it('parses the pixel flags as numbers', () => {
        expect(
            parseArgs([
                'in.json',
                '--node-width',
                '200',
                '--node-height',
                '90',
                '--node-separation',
                '120',
                '--rank-separation',
                '140',
                '--padding',
                '64',
            ]),
        ).toMatchObject({
            nodeHeight: 90,
            nodeSeparation: 120,
            nodeWidth: 200,
            padding: 64,
            rankSeparation: 140,
        });
    });

    const pixelFlags = [
        '--node-width',
        '--node-height',
        '--node-separation',
        '--rank-separation',
        '--padding',
    ];

    it.each(pixelFlags)('rejects a non-numeric %s', (flag) => {
        expect(() => parseArgs(['in.json', `${flag}=wide`])).toThrowError(
            `Invalid ${flag}: wide`,
        );
    });

    it.each(pixelFlags)('rejects a negative %s', (flag) => {
        expect(() => parseArgs(['in.json', `${flag}=-5`])).toThrowError(
            /Expected a/,
        );
    });

    // Parsing only. `run: DiagramOptions flags` asserts that a parsed 0 actually
    // reaches the renderer, which it did not before: the consumers used `||`, so an
    // explicit 0 was silently replaced by the default.
    it('accepts 0 for the separations and padding but not for node dimensions', () => {
        expect(
            parseArgs(['in.json', '--node-separation', '0']).nodeSeparation,
        ).toBe(0);
        expect(
            parseArgs(['in.json', '--rank-separation', '0']).rankSeparation,
        ).toBe(0);
        expect(parseArgs(['in.json', '--padding', '0']).padding).toBe(0);

        expect(() => parseArgs(['in.json', '--node-width', '0'])).toThrowError(
            /Expected a positive number of pixels/,
        );
        expect(() => parseArgs(['in.json', '--node-height', '0'])).toThrowError(
            /Expected a positive number of pixels/,
        );
    });

    it.each([
        '--background-color',
        '--diagram-description',
        '--diagram-title',
        '--theme',
    ])('rejects a blank %s', (flag) => {
        try {
            parseArgs(['in.json', `${flag}=`]);
            expect.unreachable(`${flag}= should not parse`);
        } catch (error) {
            expect(error).toBeInstanceOf(CliError);
            expect((error as CliError).exitCode).toBe(2);
            expect((error as CliError).message).toBe(
                `Invalid ${flag}: expected a non-empty value`,
            );
        }
    });

    it('keeps the pre-existing --icon-size wording after the shared validator', () => {
        expect(() => parseArgs(['in.json', '--icon-size', 'big'])).toThrowError(
            'Invalid --icon-size: big. Expected a positive number of pixels',
        );
    });

    it('parses the text and colour flags verbatim', () => {
        expect(
            parseArgs([
                'in.json',
                '--diagram-title',
                'Order pipeline',
                '--diagram-description',
                'Two states, one transition',
                '--background-color',
                '#ff0000',
            ]),
        ).toMatchObject({
            backgroundColor: '#ff0000',
            diagramDescription: 'Two states, one transition',
            diagramTitle: 'Order pipeline',
        });
    });

    it('sets the boolean flags', () => {
        expect(parseArgs(['in.json', '--hide-comments']).hideComments).toBe(
            true,
        );
        expect(
            parseArgs(['in.json', '--show-state-types']).showStateTypes,
        ).toBe(true);
    });

    it('keeps --theme light|dark on the enum, with no theme file', () => {
        expect(parseArgs(['in.json', '--theme', 'light'])).toMatchObject({
            theme: 'light',
            themeFile: null,
        });
        expect(parseArgs(['in.json', '--theme', 'dark'])).toMatchObject({
            theme: 'dark',
            themeFile: null,
        });
    });

    it('treats any other --theme value as a path, without touching the filesystem', () => {
        // parseArgs does no IO, so a path that does not exist still parses; the read,
        // and its failure, belong to run().
        expect(
            parseArgs(['in.json', '--theme', './nope/brand.json']),
        ).toMatchObject({
            themeFile: './nope/brand.json',
        });
    });
});

describe('run: DiagramOptions flags', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;

    beforeEach(() => {
        stdoutData = '';
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation((chunk) => {
                stdoutData += chunk.toString();
                return true;
            });
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-options-'));
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** Every `d=` attribute in the rendered SVG. */
    const pathData = (svg: string): string[] =>
        [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);

    it('--edge-style straight drops the cubic curve commands the default emits', async () => {
        expect(await run([choiceFixture])).toBe(0);
        const curved = pathData(stdoutData).filter((data) =>
            data.includes('C'),
        );
        expect(curved.length).toBeGreaterThan(0);

        stdoutData = '';
        expect(await run([choiceFixture, '--edge-style', 'straight'])).toBe(0);
        expect(
            pathData(stdoutData).filter((data) => data.includes('C')),
        ).toEqual([]);
    });

    it('--style-preset enhanced draws a Choice state as a diamond instead of a rect', async () => {
        expect(await run([choiceFixture])).toBe(0);
        expect(choiceNodeShape(stdoutData)).toBe('rect');

        stdoutData = '';
        expect(await run([choiceFixture, '--style-preset', 'enhanced'])).toBe(
            0,
        );
        expect(choiceNodeShape(stdoutData)).toBe('path');
    });

    it('--catch-label-style catch-number labels Catch edges by ordinal', async () => {
        expect(await run([errorHandlingFixture])).toBe(0);
        expect(stdoutData).toContain('States.TaskFailed');
        expect(stdoutData).not.toContain('Catch #1');

        stdoutData = '';
        expect(
            await run([
                errorHandlingFixture,
                '--catch-label-style',
                'catch-number',
            ]),
        ).toBe(0);
        expect(stdoutData).toContain('Catch #1');
        expect(stdoutData).not.toContain('States.TaskFailed');
    });

    it('--show-state-types labels each node with its state type', async () => {
        expect(await run([simpleFixture])).toBe(0);
        expect(stdoutData).not.toContain('>Pass<');

        stdoutData = '';
        expect(await run([simpleFixture, '--show-state-types'])).toBe(0);
        expect(stdoutData).toContain('>Pass<');
    });

    it('--hide-comments falls back to the state name as the node label', async () => {
        const inputPath = join(tempDir, 'commented.asl.json');
        writeFileSync(
            inputPath,
            JSON.stringify({
                StartAt: 'First',
                States: {
                    First: {
                        Comment: 'Explains itself',
                        Next: 'Second',
                        Type: 'Pass',
                    },
                    Second: { End: true, Type: 'Pass' },
                },
            }),
        );

        expect(await run([inputPath])).toBe(0);
        expect(stdoutData).toContain('Explains itself');

        stdoutData = '';
        expect(await run([inputPath, '--hide-comments'])).toBe(0);
        expect(stdoutData).not.toContain('Explains itself');
        expect(stdoutData).toContain('First');
    });

    it('--node-width and --node-height resize the nodes', async () => {
        expect(await run([simpleFixture, '-o', join(tempDir, 'a.svg')])).toBe(
            0,
        );
        const base = readFileSync(join(tempDir, 'a.svg'), 'utf-8');

        expect(
            await run([
                simpleFixture,
                '--node-width',
                '240',
                '--node-height',
                '120',
                '-o',
                join(tempDir, 'b.svg'),
            ]),
        ).toBe(0);
        const resized = readFileSync(join(tempDir, 'b.svg'), 'utf-8');

        expect(svgWidth(resized)).toBeGreaterThan(svgWidth(base));
        expect(svgHeight(resized)).toBeGreaterThan(svgHeight(base));
    });

    it('--node-separation and --rank-separation spread the graph out', async () => {
        expect(await run([choiceFixture, '-o', join(tempDir, 'a.svg')])).toBe(
            0,
        );
        const base = readFileSync(join(tempDir, 'a.svg'), 'utf-8');

        expect(
            await run([
                choiceFixture,
                '--node-separation',
                '150',
                '-o',
                join(tempDir, 'b.svg'),
            ]),
        ).toBe(0);
        expect(
            svgWidth(readFileSync(join(tempDir, 'b.svg'), 'utf-8')),
        ).toBeGreaterThan(svgWidth(base));

        expect(
            await run([
                choiceFixture,
                '--rank-separation',
                '150',
                '-o',
                join(tempDir, 'c.svg'),
            ]),
        ).toBe(0);
        expect(
            svgHeight(readFileSync(join(tempDir, 'c.svg'), 'utf-8')),
        ).toBeGreaterThan(svgHeight(base));
    });

    it('--padding grows the canvas by twice the extra padding on each axis', async () => {
        expect(
            await run([
                simpleFixture,
                '--padding',
                '20',
                '-o',
                join(tempDir, 'a.svg'),
            ]),
        ).toBe(0);
        const base = readFileSync(join(tempDir, 'a.svg'), 'utf-8');

        expect(
            await run([
                simpleFixture,
                '--padding',
                '70',
                '-o',
                join(tempDir, 'b.svg'),
            ]),
        ).toBe(0);
        const padded = readFileSync(join(tempDir, 'b.svg'), 'utf-8');

        expect(svgWidth(padded)).toBe(svgWidth(base) + 100);
        expect(svgHeight(padded)).toBe(svgHeight(base) + 100);
    });

    it('--padding 0, --node-separation 0 and --rank-separation 0 reach the renderer', async () => {
        // The consumers used `||`, so an explicit 0 rendered at the default and the
        // flags were inert. Each of these must shrink the canvas below the default.
        expect(
            await run([choiceFixture, '-o', join(tempDir, 'base.svg')]),
        ).toBe(0);
        const base = readFileSync(join(tempDir, 'base.svg'), 'utf-8');

        expect(
            await run([
                choiceFixture,
                '--padding',
                '0',
                '-o',
                join(tempDir, 'p.svg'),
            ]),
        ).toBe(0);
        const noPadding = readFileSync(join(tempDir, 'p.svg'), 'utf-8');
        expect(svgWidth(noPadding)).toBe(svgWidth(base) - 40);
        expect(svgHeight(noPadding)).toBe(svgHeight(base) - 40);

        expect(
            await run([
                choiceFixture,
                '--node-separation',
                '0',
                '-o',
                join(tempDir, 'n.svg'),
            ]),
        ).toBe(0);
        expect(
            svgWidth(readFileSync(join(tempDir, 'n.svg'), 'utf-8')),
        ).toBeLessThan(svgWidth(base));

        expect(
            await run([
                choiceFixture,
                '--rank-separation',
                '0',
                '-o',
                join(tempDir, 'r.svg'),
            ]),
        ).toBe(0);
        expect(
            svgHeight(readFileSync(join(tempDir, 'r.svg'), 'utf-8')),
        ).toBeLessThan(svgHeight(base));
    });

    it('--theme and --layout reach the Mermaid diff path', async () => {
        const themePath = join(tempDir, 'diff-theme.json');
        writeFileSync(
            themePath,
            JSON.stringify({ nodeColors: { Pass: { fill: '#abcabc' } } }),
        );

        expect(
            await run([
                simpleFixture,
                '--format',
                'mermaid',
                '--diff',
                simpleFixture,
                '--layout',
                'LR',
                '--theme',
                themePath,
            ]),
        ).toBe(0);
        expect(stdoutData).toContain('direction LR');
        expect(stdoutData).toContain('#abcabc');
    });

    it('--diagram-title and --diagram-description set the accessible text', async () => {
        expect(
            await run([
                simpleFixture,
                '--diagram-title',
                'Order pipeline',
                '--diagram-description',
                'Two states, one transition',
            ]),
        ).toBe(0);
        expect(stdoutData).toContain('<title>Order pipeline</title>');
        expect(stdoutData).toContain('aria-label="Order pipeline"');
        expect(stdoutData).toContain('<desc>Two states, one transition</desc>');
    });

    it('--catch-label-style reaches the Mermaid renderer too', async () => {
        expect(await run([errorHandlingFixture, '--format', 'mermaid'])).toBe(
            0,
        );
        expect(stdoutData).toContain('Error: States.TaskFailed');

        stdoutData = '';
        expect(
            await run([
                errorHandlingFixture,
                '--format',
                'mermaid',
                '--catch-label-style',
                'catch-number',
            ]),
        ).toBe(0);
        expect(stdoutData).toContain('stateDiagram-v2');
        // Mermaid escapes `#` as the HTML entity, so the label reads `Catch #35;1`.
        expect(stdoutData).toContain('Catch #35;1');
        expect(stdoutData).not.toContain('States.TaskFailed');
    });

    it('--hide-comments reaches the Mermaid renderer too', async () => {
        const inputPath = join(tempDir, 'commented.asl.json');
        writeFileSync(
            inputPath,
            JSON.stringify({
                StartAt: 'First',
                States: {
                    First: {
                        Comment: 'Explains itself',
                        Next: 'Second',
                        Type: 'Pass',
                    },
                    Second: { End: true, Type: 'Pass' },
                },
            }),
        );

        expect(await run([inputPath, '--format', 'mermaid'])).toBe(0);
        expect(stdoutData).toContain('First: Explains itself');

        stdoutData = '';
        expect(
            await run([inputPath, '--format', 'mermaid', '--hide-comments']),
        ).toBe(0);
        expect(stdoutData).not.toContain('Explains itself');
    });

    it('--background-color reaches PNG export when the theme is transparent', async () => {
        const themePath = join(tempDir, 'transparent.json');
        writeFileSync(
            themePath,
            JSON.stringify({ background: 'transparent', base: 'light' }),
        );

        const plainPath = join(tempDir, 'plain.png');
        const redPath = join(tempDir, 'red.png');
        expect(
            await run([
                simpleFixture,
                '--format',
                'png',
                '--theme',
                themePath,
                '-o',
                plainPath,
            ]),
        ).toBe(0);
        expect(
            await run([
                simpleFixture,
                '--format',
                'png',
                '--theme',
                themePath,
                '--background-color',
                '#ff0000',
                '-o',
                redPath,
            ]),
        ).toBe(0);

        expect(readFileSync(redPath).equals(readFileSync(plainPath))).toBe(
            false,
        );
    });

    describe('--theme with a custom theme file', () => {
        it('applies the file, overriding the built-in theme', async () => {
            const themePath = join(tempDir, 'brand.json');
            writeFileSync(
                themePath,
                JSON.stringify({
                    background: '#123456',
                    base: 'light',
                    textColor: '#abcdef',
                }),
            );

            expect(await run([simpleFixture, '--theme', themePath])).toBe(0);
            expect(stdoutData).toContain('#123456');
            expect(stdoutData).toContain('#abcdef');
        });

        it('honours a relative path', async () => {
            const themePath = join(tempDir, 'relative.json');
            writeFileSync(themePath, JSON.stringify({ background: '#654321' }));
            const cwd = process.cwd();
            try {
                process.chdir(tempDir);
                expect(
                    await run([simpleFixture, '--theme', './relative.json']),
                ).toBe(0);
            } finally {
                process.chdir(cwd);
            }
            expect(stdoutData).toContain('#654321');
        });

        it('exits 2 when the file is missing', async () => {
            expect(
                await run([
                    simpleFixture,
                    '--theme',
                    join(tempDir, 'absent.json'),
                ]),
            ).toBe(2);
            expect(stderrData).toContain('Cannot read theme file');
            expect(stdoutData).toBe('');
        });

        it('exits 2 on malformed JSON', async () => {
            const themePath = join(tempDir, 'broken.json');
            writeFileSync(themePath, '{ "background": ');
            expect(await run([simpleFixture, '--theme', themePath])).toBe(2);
            expect(stderrData).toContain('Cannot read theme file');
        });

        it('exits 2 when the JSON is not an object', async () => {
            const themePath = join(tempDir, 'array.json');
            writeFileSync(themePath, '["light"]');
            expect(await run([simpleFixture, '--theme', themePath])).toBe(2);
            expect(stderrData).toContain('Cannot read theme file');
        });

        it('fails before the Mermaid, diff and execution paths run', async () => {
            // Resolution sits ahead of the format branching, so a bad theme file is
            // reported once rather than per output path. This says nothing about where
            // the resolved theme lands — the test below is the one that proves Mermaid
            // receives it.
            const themePath = join(tempDir, 'bad.json');
            writeFileSync(themePath, 'not json');

            expect(
                await run([
                    simpleFixture,
                    '--format',
                    'mermaid',
                    '--theme',
                    themePath,
                ]),
            ).toBe(2);
            expect(
                await run([
                    simpleFixture,
                    '--diff',
                    simpleFixture,
                    '--theme',
                    themePath,
                ]),
            ).toBe(2);
            expect(
                await run([
                    simpleFixture,
                    '--execution',
                    executionHistoryFixture,
                    '--theme',
                    themePath,
                ]),
            ).toBe(2);
        });

        it('applies the file on the Mermaid path', async () => {
            const themePath = join(tempDir, 'mermaid-theme.json');
            writeFileSync(
                themePath,
                JSON.stringify({ nodeColors: { Pass: { fill: '#abcabc' } } }),
            );
            expect(
                await run([
                    simpleFixture,
                    '--format',
                    'mermaid',
                    '--theme',
                    themePath,
                ]),
            ).toBe(0);
            expect(stdoutData).toContain('#abcabc');
        });
    });
});

describe('flag surface documentation', () => {
    const cliSource = readFileSync(
        join(__dirname, '..', 'src', 'cli.ts'),
        'utf-8',
    );

    const helpText = (() => {
        const match = /const HELP_TEXT = `([\s\S]*?)\n`;/.exec(cliSource);
        if (!match) throw new Error('HELP_TEXT not found in src/cli.ts');
        return match[1];
    })();

    const specKeys = (() => {
        const match = /const OPTION_SPEC = \{([\s\S]*?)\n\} as const;/.exec(
            cliSource,
        );
        if (!match) throw new Error('OPTION_SPEC not found in src/cli.ts');
        return [...match[1].matchAll(/^\s*'?([a-z][a-z-]*)'?:\s*\{/gm)].map(
            (entry) => entry[1],
        );
    })();

    const cliGuide = readFileSync(
        join(
            __dirname,
            '..',
            'site',
            'src',
            'content',
            'docs',
            'guides',
            'cli.mdx',
        ),
        'utf-8',
    );

    it('found the flag list it is about to check', () => {
        // Guards the regexes above: renaming OPTION_SPEC or HELP_TEXT would otherwise
        // leave this whole describe asserting nothing at all.
        expect(specKeys.length).toBeGreaterThan(25);
        expect(specKeys).toContain('format');
        expect(specKeys).toContain('edge-style');
        expect(specKeys).toContain('theme');
        expect(helpText).toContain('Options:');
    });

    it.each(specKeys)('--%s appears in --help', (flag) => {
        expect(helpText).toContain(`--${flag}`);
    });

    it.each(specKeys)('--%s appears in the CLI guide', (flag) => {
        expect(cliGuide).toContain(`--${flag}`);
    });

    it('documents no flag the parser would reject', () => {
        const documented = new Set(
            [...cliGuide.matchAll(/`--([a-z][a-z-]*)/g)].map(
                (entry) => entry[1],
            ),
        );
        // `comment gitlab` has its own parser and its own help text.
        const subcommandFlags = new Set([
            'asl-glob',
            'aws-region',
            'comment-tag',
            'execution-mode',
            'output-dir',
            'state-machine-arn',
        ]);
        const unknown = [...documented].filter(
            (flag) => !specKeys.includes(flag) && !subcommandFlags.has(flag),
        );
        expect(unknown).toEqual([]);
    });
});
