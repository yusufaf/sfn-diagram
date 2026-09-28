import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CliError, parseArgs, reportUnexpectedError, run } from '../src/cli';

const simpleFixture = join(__dirname, 'fixtures', 'simple.asl.json');

describe('parseArgs', () => {
    it('reports an absent option rather than substituting a default', () => {
        // The defaults live in resolveCliOptions now, so that `--layout TB` can
        // override a config file that says otherwise. parseArgs reports absence.
        const args = parseArgs(['state.asl.json']);
        expect(args).toMatchObject({
            format: null,
            inputs: ['state.asl.json'],
            layout: null,
            output: null,
            showHelp: false,
            showVersion: false,
            theme: null,
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
            inputs: ['in.json'],
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
        expect(parseArgs(['-']).inputs).toEqual(['-']);
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
            theme: null,
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

    it('accepts a second positional, which used to be rejected', () => {
        // Several inputs are the point of --out-dir; the old "Unexpected positional
        // argument" error is gone.
        expect(parseArgs(['a.json', 'b.json']).inputs).toEqual([
            'a.json',
            'b.json',
        ]);
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
            iconPosition: null,
            iconSize: null,
            showIcons: null,
            showVariables: null,
        });
    });

    it('parses --hide-variables', () => {
        expect(parseArgs(['in.json', '--hide-variables']).showVariables).toBe(
            false,
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
        expect(args.inputs).toEqual(['state.asl.json']);
    });

    it('defaults --collapse to null (not passed)', () => {
        expect(parseArgs(['in.json']).collapse).toBeNull();
    });

    it('accepts an inline --format=value', () => {
        expect(parseArgs(['in.json', '--format=svg']).format).toBe('svg');
    });

    it('treats everything after -- as positional', () => {
        expect(parseArgs(['--', '-weird.json']).inputs).toEqual([
            '-weird.json',
        ]);
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
        expect(args.inputs).toEqual(['x.json']);
    });

    it('treats an explicit --collapse= (empty) as collapsing nothing', () => {
        expect(parseArgs(['in.json', '--collapse=']).collapse).toEqual([]);
    });

    it('treats a literal --collapse positional after -- as a filename, not a flag', () => {
        const args = parseArgs(['--', '--collapse']);
        expect(args.collapse).toBeNull();
        expect(args.inputs).toEqual(['--collapse']);
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
            expect(code).toBe(2);
            expect(stderrData).toContain('--check lints the input only');
        }
    });

    it('returns exit code 2 for an invalid flag value', async () => {
        const code = await run([simpleFixture, '--format', 'gif']);
        expect(code).toBe(2);
        expect(stderrData).toContain('Invalid --format');
    });

    it('requires --output or --out-dir when --format is png', async () => {
        const code = await run([simpleFixture, '--format', 'png']);
        expect(code).toBe(2);
        expect(stderrData).toContain('--output or --out-dir is required');
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
        expect(code).toBe(2);
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
        expect(code).toBe(2);
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
        expect(code).toBe(2);
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
        expect(code).toBe(2);
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
            includeComments: null,
            nodeHeight: null,
            nodeSeparation: null,
            nodeWidth: null,
            padding: null,
            rankSeparation: null,
            showStateTypes: null,
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
        expect(parseArgs(['in.json', '--hide-comments']).includeComments).toBe(
            false,
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

        // An unreadable or unusable theme file is a runtime failure (1), matching an
        // unreadable input or --diff baseline. Only a blank --theme is a usage
        // error, and parseArgs rejects that before any read happens.
        it('exits 1 when the file is missing, naming the accepted forms', async () => {
            expect(
                await run([
                    simpleFixture,
                    '--theme',
                    join(tempDir, 'absent.json'),
                ]),
            ).toBe(1);
            expect(stderrData).toContain('Cannot read theme file');
            expect(stderrData).toContain(
                '--theme takes light, dark, or a path',
            );
            expect(stdoutData).toBe('');
        });

        it('exits 1 on malformed JSON', async () => {
            const themePath = join(tempDir, 'broken.json');
            writeFileSync(themePath, '{ "background": ');
            expect(await run([simpleFixture, '--theme', themePath])).toBe(1);
            expect(stderrData).toContain('Cannot read theme file');
        });

        it('exits 1 when the JSON is not an object', async () => {
            const themePath = join(tempDir, 'array.json');
            writeFileSync(themePath, '["light"]');
            expect(await run([simpleFixture, '--theme', themePath])).toBe(1);
            expect(stderrData).toContain('Cannot read theme file');
        });

        it('fails on the Mermaid, diff and execution paths too', async () => {
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
            ).toBe(1);
            expect(
                await run([
                    simpleFixture,
                    '--diff',
                    simpleFixture,
                    '--theme',
                    themePath,
                ]),
            ).toBe(1);
            expect(
                await run([
                    simpleFixture,
                    '--execution',
                    executionHistoryFixture,
                    '--theme',
                    themePath,
                ]),
            ).toBe(1);
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

describe('exit code convention', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stderrData: string;
    let tempDir: string;

    beforeEach(() => {
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => true);
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-exit-'));
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    const write = (name: string, contents: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, contents);
        return path;
    };

    const simpleAsl = JSON.stringify({
        StartAt: 'Only',
        States: { Only: { End: true, Type: 'Pass' } },
    });

    describe('2 — the invocation itself was wrong', () => {
        it.each([
            ['an unknown flag', ['--nope']],
            ['a second positional', ['b.asl.json']],
            ['an invalid enum value', ['--format', 'gif']],
            ['a flag missing its value', ['--format']],
            ['a value on a boolean flag', ['--hide-catch=true']],
            ['a non-numeric pixel value', ['--padding', 'wide']],
            ['a blank text value', ['--diagram-title=']],
        ])('%s', async (_label, extra) => {
            const input = write('in.asl.json', simpleAsl);
            expect(await run([input, ...extra])).toBe(2);
        });

        it.each([
            [
                '--diff with --execution',
                (input: string) => [
                    input,
                    '--diff',
                    input,
                    '--execution',
                    input,
                ],
            ],
            [
                '--check with --output',
                (input: string) => [input, '--check', '-o', 'out.svg'],
            ],
            [
                '--check with --diff',
                (input: string) => [input, '--check', '--diff', input],
            ],
            [
                '--diff with a format that cannot render one',
                (input: string) => [
                    input,
                    '--diff',
                    input,
                    '--format',
                    'png',
                    '-o',
                    'o.png',
                ],
            ],
            [
                '--execution with a format that cannot render one',
                (input: string) => [
                    input,
                    '--execution',
                    input,
                    '--format',
                    'png',
                    '-o',
                    'o.png',
                ],
            ],
            [
                '--format png without --output',
                (input: string) => [input, '--format', 'png'],
            ],
        ])('%s', async (_label, build) => {
            const input = write('in.asl.json', simpleAsl);
            expect(await run(build(input))).toBe(2);
            expect(stderrData).not.toBe('');
        });

        it('comment gitlab: --execution-mode without --state-machine-arn', async () => {
            expect(
                await run(['comment', 'gitlab', '--execution-mode', 'latest']),
            ).toBe(2);
            expect(stderrData).toContain('--state-machine-arn is required');
        });
    });

    describe('1 — the invocation was valid and something went wrong', () => {
        it('an input file that does not exist', async () => {
            expect(await run([join(tempDir, 'absent.asl.json')])).toBe(1);
            expect(stderrData).toContain('Failed to read input');
        });

        it('an input file that is not JSON', async () => {
            expect(await run([write('bad.asl.json', 'not json at all')])).toBe(
                1,
            );
        });

        it('an input file that is JSON but not a state machine', async () => {
            expect(await run([write('empty.asl.json', '{}')])).toBe(1);
        });

        it('a --diff baseline that does not exist', async () => {
            const input = write('in.asl.json', simpleAsl);
            expect(
                await run([input, '--diff', join(tempDir, 'absent.json')]),
            ).toBe(1);
            expect(stderrData).toContain('Failed to read --diff baseline');
        });

        it('an --execution history that does not exist', async () => {
            const input = write('in.asl.json', simpleAsl);
            expect(
                await run([input, '--execution', join(tempDir, 'absent.json')]),
            ).toBe(1);
            expect(stderrData).toContain('Failed to read --execution history');
        });

        it('a template with several state machines and no --resource', async () => {
            const template = write(
                'template.json',
                JSON.stringify({
                    Resources: {
                        First: {
                            Properties: { DefinitionString: simpleAsl },
                            Type: 'AWS::StepFunctions::StateMachine',
                        },
                        Second: {
                            Properties: { DefinitionString: simpleAsl },
                            Type: 'AWS::StepFunctions::StateMachine',
                        },
                    },
                }),
            );
            expect(await run([template, '--resolve-cfn'])).toBe(1);
            expect(stderrData).toContain('Error:');
        });

        it('--check finding an error-severity diagnostic', async () => {
            // A finding, not a malfunction — the same code a linter uses, which is why
            // usage errors had to move off 1.
            const broken = write(
                'broken.asl.json',
                JSON.stringify({
                    StartAt: 'Start',
                    States: { Start: { Next: 'Nowhere', Type: 'Pass' } },
                }),
            );
            expect(await run([broken, '--check'])).toBe(1);
        });
    });

    describe('0 — success, including a graceful no-op', () => {
        it('a rendered diagram', async () => {
            expect(await run([write('in.asl.json', simpleAsl)])).toBe(0);
        });

        it('--help and --version', async () => {
            expect(await run(['--help'])).toBe(0);
            expect(await run(['--version'])).toBe(0);
        });

        it('--check with nothing worse than a warning', async () => {
            expect(
                await run([write('in.asl.json', simpleAsl), '--check']),
            ).toBe(0);
        });
    });

    it('never returns a code outside 0, 1 and 2', async () => {
        const input = write('in.asl.json', simpleAsl);
        const invocations: string[][] = [
            [input],
            [input, '--check'],
            ['--help'],
            ['--version'],
            [input, '--nope'],
            [input, '--format', 'gif'],
            [input, '--diff', input, '--execution', input],
            [input, '--format', 'png'],
            [join(tempDir, 'absent.asl.json')],
            [input, '--theme', join(tempDir, 'absent.json')],
            ['comment', 'gitlab', '--execution-mode', 'latest'],
        ];
        for (const argv of invocations) {
            expect([0, 1, 2]).toContain(await run(argv));
        }
    });

    it('documents the convention in --help', () => {
        const helpSource = readFileSync(
            join(__dirname, '..', 'src', 'cli.ts'),
            'utf-8',
        );
        const match = /const HELP_TEXT = `([\s\S]*?)\n`;/.exec(helpSource);
        if (!match) throw new Error('HELP_TEXT not found in src/cli.ts');
        expect(match[1]).toContain('Exit codes:');
        expect(match[1]).toContain('2 usage error');
    });
});

describe('reportUnexpectedError', () => {
    let stderr: ReturnType<typeof vi.spyOn>;
    let stderrData: string;

    beforeEach(() => {
        stderrData = '';
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
    });

    afterEach(() => {
        stderr.mockRestore();
    });

    // This is what src/bin.ts's .catch does with an exception that escapes run().
    // Before it existed, such an exception was an unhandled rejection: a raw stack
    // trace on stderr and an exit code Node chose rather than one the convention
    // documents. It lives in cli.ts rather than inline in bin.ts so it is reachable
    // from a test at all - importing bin.ts runs the CLI as a side effect.
    it('reports an Error as a runtime failure', () => {
        expect(reportUnexpectedError(new Error('something unexpected'))).toBe(
            1,
        );
        expect(stderrData).toBe('Error: something unexpected\n');
    });

    it('reports a non-Error rejection without crashing on it', () => {
        expect(reportUnexpectedError('a bare string')).toBe(1);
        expect(stderrData).toBe('Error: a bare string\n');
    });

    it('reports undefined', () => {
        expect(reportUnexpectedError(undefined)).toBe(1);
        expect(stderrData).toBe('Error: undefined\n');
    });
});

describe('parseArgs: config and negation flags', () => {
    it('reports every option as absent when no flag was given', () => {
        // The precedence rule needs "absent" to be distinguishable from "set to the
        // value that happens to be the default", so parseArgs no longer defaults.
        expect(parseArgs(['in.json'])).toMatchObject({
            catchHandling: null,
            config: null,
            format: null,
            includeComments: null,
            layout: null,
            showIcons: null,
            showStateTypes: null,
            showVariables: null,
            theme: null,
            themeFile: null,
        });
    });

    it('still reports an explicit flag set to the default value', () => {
        expect(parseArgs(['in.json', '--layout', 'TB']).layout).toBe('TB');
        expect(parseArgs(['in.json', '--format', 'svg']).format).toBe('svg');
        expect(parseArgs(['in.json', '--theme', 'light']).theme).toBe('light');
    });

    it('parses --config as a path', () => {
        expect(parseArgs(['in.json', '--config', './sfn.json']).config).toBe(
            './sfn.json',
        );
    });

    it('rejects a blank --config', () => {
        expect(() => parseArgs(['in.json', '--config='])).toThrowError(
            'Invalid --config: expected a non-empty value',
        );
    });

    it.each([
        ['--hide-catch', 'catchHandling', 'hide'],
        ['--show-catch', 'catchHandling', 'show'],
        ['--hide-comments', 'includeComments', false],
        ['--show-comments', 'includeComments', true],
        ['--hide-variables', 'showVariables', false],
        ['--show-variables', 'showVariables', true],
        ['--show-icons', 'showIcons', true],
        ['--hide-icons', 'showIcons', false],
        ['--show-state-types', 'showStateTypes', true],
        ['--hide-state-types', 'showStateTypes', false],
    ])('%s sets %s', (flag, field, expected) => {
        expect(parseArgs(['in.json', flag])).toMatchObject({
            [field]: expected,
        });
    });

    it.each([
        ['--hide-catch', '--show-catch'],
        ['--hide-comments', '--show-comments'],
        ['--hide-variables', '--show-variables'],
        ['--show-icons', '--hide-icons'],
        ['--show-state-types', '--hide-state-types'],
    ])('rejects %s together with %s', (first, second) => {
        // Last-one-wins would be invisible in a long CI command line.
        try {
            parseArgs(['in.json', first, second]);
            expect.unreachable(`${first} ${second} should not parse`);
        } catch (error) {
            expect(error).toBeInstanceOf(CliError);
            expect((error as CliError).exitCode).toBe(2);
            expect((error as CliError).message).toContain(first);
            expect((error as CliError).message).toContain(second);
        }
    });
});

describe('run: config file', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;
    let originalCwd: string;

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
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-config-'));
        // A .git marker stops discovery escaping the temp dir into this repo, whose own
        // config would otherwise leak into every test here.
        writeFileSync(join(tempDir, '.git'), '');
        originalCwd = process.cwd();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    const write = (name: string, contents: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, contents);
        return path;
    };

    const simpleAsl = JSON.stringify({
        StartAt: 'Only',
        States: { Only: { End: true, Type: 'Pass' } },
    });

    const svgWidthOf = (svg: string): number => {
        const match = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
        if (!match) throw new Error('no <svg width> found');
        return Number(match[1]);
    };

    it('applies a discovered config', async () => {
        const input = write('m.asl.json', simpleAsl);
        write('sfn-diagram.config.json', JSON.stringify({ padding: 0 }));
        process.chdir(tempDir);

        expect(await run([input])).toBe(0);
        const unpadded = svgWidthOf(stdoutData);

        stdoutData = '';
        rmSync(join(tempDir, 'sfn-diagram.config.json'));
        expect(await run([input])).toBe(0);
        expect(svgWidthOf(stdoutData)).toBe(unpadded + 40);
    });

    it('applies a config named by --config from anywhere', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write(
            'elsewhere.json',
            JSON.stringify({ format: 'mermaid' }),
        );
        expect(await run([input, '--config', config])).toBe(0);
        expect(stdoutData).toContain('stateDiagram-v2');
    });

    it('lets an explicit flag beat the config', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ format: 'mermaid' }));

        // Show the config taking effect first, so the override below is a real
        // override rather than an assertion that holds whether or not it was read.
        expect(await run([input, '--config', config])).toBe(0);
        expect(stdoutData).toContain('stateDiagram-v2');

        stdoutData = '';
        expect(await run([input, '--config', config, '--format', 'svg'])).toBe(
            0,
        );
        expect(stdoutData).toContain('<svg');
        expect(stdoutData).not.toContain('stateDiagram-v2');
    });

    it('lets a negation flag beat a config that turned something on', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write(
            'c.json',
            JSON.stringify({ showStateTypes: true }),
        );
        expect(await run([input, '--config', config])).toBe(0);
        expect(stdoutData).toContain('>Pass<');

        stdoutData = '';
        expect(
            await run([input, '--config', config, '--hide-state-types']),
        ).toBe(0);
        expect(stdoutData).not.toContain('>Pass<');
    });

    it('applies a config custom theme object', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write(
            'c.json',
            JSON.stringify({ theme: { background: '#123456' } }),
        );
        expect(await run([input, '--config', config])).toBe(0);
        expect(stdoutData).toContain('#123456');
    });

    it('lets --theme beat a config custom theme', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write(
            'c.json',
            JSON.stringify({ theme: { background: '#123456' } }),
        );

        expect(await run([input, '--config', config])).toBe(0);
        expect(stdoutData).toContain('#123456');

        stdoutData = '';
        expect(await run([input, '--config', config, '--theme', 'dark'])).toBe(
            0,
        );
        expect(stdoutData).not.toContain('#123456');
    });

    it('reaches the Mermaid path, not just SVG', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ layout: 'LR' }));
        expect(
            await run([input, '--config', config, '--format', 'mermaid']),
        ).toBe(0);
        expect(stdoutData).toContain('direction LR');
    });

    it('reaches the diff path', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ layout: 'LR' }));
        expect(
            await run([
                input,
                '--diff',
                input,
                '--config',
                config,
                '--format',
                'mermaid',
            ]),
        ).toBe(0);
        expect(stdoutData).toContain('direction LR');
    });

    it('lets a config format reach the overlay-format usage check', async () => {
        // The check has to read the merged format, not the flag, or a config setting
        // png would sail past it and fail later with a confusing error.
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ format: 'png' }));
        expect(await run([input, '--diff', input, '--config', config])).toBe(2);
        expect(stderrData).toContain(
            '--diff supports --format svg, mermaid or html',
        );
    });

    it('lets a config format reach the png --output usage check', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ format: 'png' }));
        expect(await run([input, '--config', config])).toBe(2);
        expect(stderrData).toContain(
            '--output or --out-dir is required when --format is png',
        );
    });

    it('exits 1 when --config names a file that does not exist', async () => {
        const input = write('m.asl.json', simpleAsl);
        expect(
            await run([input, '--config', join(tempDir, 'absent.json')]),
        ).toBe(1);
        expect(stderrData).toContain('Cannot read config file');
    });

    it('exits 1 on a malformed config, naming the file', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', '{ "theme": ');
        expect(await run([input, '--config', config])).toBe(1);
        expect(stderrData).toContain('Cannot parse config file');
        expect(stderrData).toContain(config);
    });

    it('exits 1 on an invalid config value, naming the field', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ theme: 'neon' }));
        expect(await run([input, '--config', config])).toBe(1);
        expect(stderrData).toContain('Invalid theme');
    });

    it('still lints with --check when a config sets a format', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', JSON.stringify({ format: 'png' }));
        // --check ignores format; a config setting one must not make it demand -o.
        expect(await run([input, '--check', '--config', config])).toBe(0);
    });

    it('reports a broken config even with --check', async () => {
        const input = write('m.asl.json', simpleAsl);
        const config = write('c.json', '{ nope');
        expect(await run([input, '--check', '--config', config])).toBe(1);
    });

    it('ignores a config beside the input when the cwd is elsewhere', async () => {
        // Discovery is rooted at the working directory, not at the input's directory.
        const nested = join(tempDir, 'nested');
        mkdirSync(nested, { recursive: true });
        const input = join(nested, 'm.asl.json');
        writeFileSync(input, simpleAsl);
        writeFileSync(
            join(nested, 'sfn-diagram.config.json'),
            JSON.stringify({ format: 'mermaid' }),
        );
        process.chdir(tempDir);
        expect(await run([input])).toBe(0);
        expect(stdoutData).toContain('<svg');
    });
});

describe('run: config load ordering and --no-collapse', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;
    let originalCwd: string;

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
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-order-'));
        writeFileSync(join(tempDir, '.git'), '');
        originalCwd = process.cwd();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    const write = (name: string, contents: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, contents);
        return path;
    };

    const parallelAsl = JSON.stringify({
        StartAt: 'Fan',
        States: {
            Fan: {
                Branches: [
                    {
                        StartAt: 'Left',
                        States: { Left: { End: true, Type: 'Pass' } },
                    },
                ],
                End: true,
                Type: 'Parallel',
            },
        },
    });

    it('reports a contradictory command line as a usage error, not a broken config', async () => {
        // The config load used to run first, so a broken config nearby turned an argv
        // mistake into exit 1 - contradicting the invariant that 2 is for the command
        // line and 1 is for a file.
        const input = write('m.asl.json', parallelAsl);
        write('sfn-diagram.config.json', '{ broken');
        process.chdir(tempDir);

        expect(await run([input, '--diff', input, '--execution', input])).toBe(
            2,
        );
        expect(stderrData).toContain(
            '--diff and --execution cannot be combined',
        );
        expect(stderrData).not.toContain('config file');
    });

    it('reports --check with --output as a usage error, not a broken config', async () => {
        const input = write('m.asl.json', parallelAsl);
        write('sfn-diagram.config.json', '{ broken');
        process.chdir(tempDir);

        expect(
            await run([input, '--check', '-o', join(tempDir, 'x.svg')]),
        ).toBe(2);
        expect(stderrData).toContain('--check lints the input only');
    });

    it('--no-collapse turns off a config that collapses containers', async () => {
        const input = write('m.asl.json', parallelAsl);
        const config = write('c.json', JSON.stringify({ collapse: true }));

        expect(await run([input, '--config', config])).toBe(0);
        const collapsed = stdoutData;
        expect(collapsed).not.toContain('data-state-id="Left"');

        stdoutData = '';
        expect(await run([input, '--config', config, '--no-collapse'])).toBe(0);
        expect(stdoutData).toContain('data-state-id="Left"');
    });

    it('rejects --collapse together with --no-collapse', async () => {
        const input = write('m.asl.json', parallelAsl);
        expect(await run([input, '--collapse', '--no-collapse'])).toBe(2);
        expect(stderrData).toContain(
            '--collapse and --no-collapse cannot be combined',
        );
    });

    it('reports an unreadable discovered config instead of proceeding on defaults', async () => {
        // A directory where a config file should be: statSync succeeds but isFile() is
        // false, so this exercises the ENOENT-vs-everything-else split only on
        // platforms where a read fails. The directory case must not be reported.
        const input = write('m.asl.json', parallelAsl);
        mkdirSync(join(tempDir, 'sfn-diagram.config.json'));
        process.chdir(tempDir);
        expect(await run([input])).toBe(0);
    });
});

describe('parseArgs: multiple inputs and --out-dir', () => {
    it('collects every positional', () => {
        expect(parseArgs(['a.asl.json', 'b.asl.json']).inputs).toEqual([
            'a.asl.json',
            'b.asl.json',
        ]);
    });

    it('reports no positionals as an empty list', () => {
        expect(parseArgs([]).inputs).toEqual([]);
    });

    it('keeps a single positional in the list', () => {
        expect(parseArgs(['a.asl.json']).inputs).toEqual(['a.asl.json']);
    });

    it('parses --out-dir', () => {
        expect(parseArgs(['a.asl.json', '--out-dir', 'out']).outDir).toBe(
            'out',
        );
    });

    it('leaves --out-dir null when absent', () => {
        expect(parseArgs(['a.asl.json']).outDir).toBeNull();
    });

    it('rejects a blank --out-dir', () => {
        expect(() => parseArgs(['a.asl.json', '--out-dir='])).toThrowError(
            'Invalid --out-dir: expected a non-empty value',
        );
    });

    it('no longer rejects a second positional', () => {
        // It used to be "Unexpected positional argument".
        expect(() => parseArgs(['a.asl.json', 'b.asl.json'])).not.toThrow();
    });
});

describe('run: multiple inputs', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;
    let originalCwd: string;

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
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-multi-'));
        writeFileSync(join(tempDir, '.git'), '');
        originalCwd = process.cwd();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
    });

    const simpleAsl = JSON.stringify({
        StartAt: 'Only',
        States: { Only: { End: true, Type: 'Pass' } },
    });

    const touch = (relative: string, contents = simpleAsl): string => {
        const path = join(tempDir, relative);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, contents);
        return path;
    };

    it('renders every positional into --out-dir', async () => {
        touch('order.asl.json');
        touch('refund.asl.json');
        process.chdir(tempDir);

        expect(
            await run([
                'order.asl.json',
                'refund.asl.json',
                '--out-dir',
                'out',
            ]),
        ).toBe(0);
        expect(
            readFileSync(join(tempDir, 'out', 'order.svg'), 'utf-8'),
        ).toContain('<svg');
        expect(
            readFileSync(join(tempDir, 'out', 'refund.svg'), 'utf-8'),
        ).toContain('<svg');
        expect(stdoutData).toBe('');
    });

    it('expands a glob', async () => {
        touch('machines/order.asl.json');
        touch('machines/refund.asl.json');
        process.chdir(tempDir);

        expect(await run(['machines/*.asl.json', '--out-dir', 'out'])).toBe(0);
        expect(existsSync(join(tempDir, 'out', 'order.svg'))).toBe(true);
        expect(existsSync(join(tempDir, 'out', 'refund.svg'))).toBe(true);
    });

    it('creates --out-dir when it does not exist', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);

        expect(
            await run(['order.asl.json', '--out-dir', 'deep/nested/out']),
        ).toBe(0);
        expect(
            existsSync(join(tempDir, 'deep', 'nested', 'out', 'order.svg')),
        ).toBe(true);
    });

    it('honours --format when naming outputs', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);

        expect(
            await run([
                'order.asl.json',
                '--out-dir',
                'out',
                '--format',
                'mermaid',
            ]),
        ).toBe(0);
        expect(
            readFileSync(join(tempDir, 'out', 'order.mmd'), 'utf-8'),
        ).toContain('stateDiagram-v2');
    });

    it('renders the rest when one input cannot be read, exiting 1', async () => {
        touch('order.asl.json');
        touch('refund.asl.json');
        process.chdir(tempDir);

        expect(
            await run([
                'order.asl.json',
                'missing.asl.json',
                'refund.asl.json',
                '--out-dir',
                'out',
            ]),
        ).toBe(1);
        expect(stderrData).toContain('missing.asl.json');
        // The good ones still rendered: a batch that stops at the first failure hides
        // the rest, which is the opposite of what a batch is for.
        expect(existsSync(join(tempDir, 'out', 'order.svg'))).toBe(true);
        expect(existsSync(join(tempDir, 'out', 'refund.svg'))).toBe(true);
    });

    it('exits 1 when one input is invalid ASL, still rendering the others', async () => {
        touch('order.asl.json');
        touch('broken.asl.json', 'not json');
        process.chdir(tempDir);

        expect(
            await run([
                'order.asl.json',
                'broken.asl.json',
                '--out-dir',
                'out',
            ]),
        ).toBe(1);
        expect(existsSync(join(tempDir, 'out', 'order.svg'))).toBe(true);
        expect(stderrData).toContain('broken.asl.json');
    });

    it('lints every input with --check', async () => {
        touch('good.asl.json');
        touch(
            'bad.asl.json',
            JSON.stringify({
                StartAt: 'Start',
                States: { Start: { Next: 'Nowhere', Type: 'Pass' } },
            }),
        );
        process.chdir(tempDir);

        expect(await run(['good.asl.json', 'bad.asl.json', '--check'])).toBe(1);
        expect(stderrData).toContain('bad.asl.json');
    });

    it('exits 0 for --check over several clean inputs', async () => {
        touch('one.asl.json');
        touch('two.asl.json');
        process.chdir(tempDir);
        expect(await run(['one.asl.json', 'two.asl.json', '--check'])).toBe(0);
    });

    describe('usage errors', () => {
        it('rejects -o with more than one input', async () => {
            touch('a.asl.json');
            touch('b.asl.json');
            process.chdir(tempDir);
            expect(
                await run(['a.asl.json', 'b.asl.json', '-o', 'out.svg']),
            ).toBe(2);
            expect(stderrData).toContain('--out-dir');
        });

        it('rejects -o together with --out-dir', async () => {
            touch('a.asl.json');
            process.chdir(tempDir);
            expect(
                await run(['a.asl.json', '-o', 'out.svg', '--out-dir', 'out']),
            ).toBe(2);
        });

        it('rejects several inputs with neither -o nor --out-dir', async () => {
            touch('a.asl.json');
            touch('b.asl.json');
            process.chdir(tempDir);
            expect(await run(['a.asl.json', 'b.asl.json'])).toBe(2);
            expect(stderrData).toContain('--out-dir');
        });

        it('rejects stdin among several inputs', async () => {
            touch('a.asl.json');
            process.chdir(tempDir);
            expect(await run(['a.asl.json', '-', '--out-dir', 'out'])).toBe(2);
            expect(stderrData).toContain('stdin');
        });

        it('rejects --diff with more than one input', async () => {
            const base = touch('base.asl.json');
            touch('a.asl.json');
            touch('b.asl.json');
            process.chdir(tempDir);
            expect(
                await run([
                    'a.asl.json',
                    'b.asl.json',
                    '--diff',
                    base,
                    '--out-dir',
                    'out',
                ]),
            ).toBe(2);
            expect(stderrData).toContain('--diff');
        });

        it('rejects --execution with more than one input', async () => {
            touch('a.asl.json');
            touch('b.asl.json');
            const history = touch('history.json', '{"events":[]}');
            process.chdir(tempDir);
            expect(
                await run([
                    'a.asl.json',
                    'b.asl.json',
                    '--execution',
                    history,
                    '--out-dir',
                    'out',
                ]),
            ).toBe(2);
            expect(stderrData).toContain('--execution');
        });

        it('rejects --out-dir pointing at an existing file', async () => {
            touch('a.asl.json');
            touch('out');
            process.chdir(tempDir);
            expect(await run(['a.asl.json', '--out-dir', 'out'])).toBe(2);
            expect(stderrData).toContain('out');
        });

        it('refuses a colliding batch before writing anything', async () => {
            touch('a/order.asl.json');
            touch('b/order.asl.json');
            process.chdir(tempDir);
            expect(
                await run([
                    'a/order.asl.json',
                    'b/order.asl.json',
                    '--out-dir',
                    'out',
                ]),
            ).toBe(2);
            expect(stderrData).toContain('same file');
            expect(existsSync(join(tempDir, 'out'))).toBe(false);
        });
    });

    it('renders PNG into --out-dir', async () => {
        // The png guard demanded -o before --out-dir was considered, so batch PNG was
        // impossible while OUTPUT_EXTENSIONS, a unit test and the guide all advertised it.
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(
            await run([
                'order.asl.json',
                '--format',
                'png',
                '--out-dir',
                'out',
            ]),
        ).toBe(0);
        expect(existsSync(join(tempDir, 'out', 'order.png'))).toBe(true);
    });

    it('still requires an output for PNG when neither -o nor --out-dir is given', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(await run(['order.asl.json', '--format', 'png'])).toBe(2);
        expect(stderrData).toContain('--output or --out-dir is required');
    });

    it('names the file when a single-file glob fails', async () => {
        // With a glob the caller does not know which file was selected, so the name is
        // exactly the information they need - batch size is the wrong trigger.
        touch('machines/broken.asl.json', 'not json');
        process.chdir(tempDir);
        expect(await run(['machines/*.asl.json', '--out-dir', 'out'])).toBe(1);
        expect(stderrData).toContain('broken.asl.json');
    });

    it('does not name the file for a single literal input', async () => {
        touch('broken.asl.json', 'not json');
        process.chdir(tempDir);
        expect(await run(['broken.asl.json'])).toBe(1);
        expect(stderrData).not.toContain('in broken.asl.json');
    });

    it('rejects --out-dir with stdin', async () => {
        process.chdir(tempDir);
        expect(await run(['-', '--out-dir', 'out'])).toBe(2);
        expect(stderrData).toContain('stdin');
        expect(existsSync(join(tempDir, 'out'))).toBe(false);
    });

    it('rejects --out-dir with --check, as --output already is', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(
            await run(['order.asl.json', '--check', '--out-dir', 'out']),
        ).toBe(2);
        expect(stderrData).toContain('--check');
    });

    it('reports an --out-dir path blocked by a file as a usage error', async () => {
        // It used to escape to bin.ts as a raw ENOTDIR with exit 1.
        touch('order.asl.json');
        touch('blocker');
        process.chdir(tempDir);
        expect(
            await run(['order.asl.json', '--out-dir', 'blocker/nested/out']),
        ).toBe(2);
        // Reported rather than thrown: it used to escape to bin.ts with exit 1. The
        // errno stays in the message because it is the reason the path cannot be made.
        expect(stderrData).toContain('Cannot create --out-dir');
        expect(stderrData).toContain('blocker/nested/out');
    });

    it('exits 1 when a glob matches nothing', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        // The invocation is well formed; the filesystem had no matches. Files are 1.
        expect(await run(['*.nope.json', '--out-dir', 'out'])).toBe(1);
        expect(stderrData).toContain('*.nope.json');
    });

    it('still writes a single input to stdout with no -o', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(await run(['order.asl.json'])).toBe(0);
        expect(stdoutData).toContain('<svg');
    });

    it('still writes a single input to -o', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(await run(['order.asl.json', '-o', 'one.svg'])).toBe(0);
        expect(readFileSync(join(tempDir, 'one.svg'), 'utf-8')).toContain(
            '<svg',
        );
    });

    it('accepts --out-dir for a single input', async () => {
        touch('order.asl.json');
        process.chdir(tempDir);
        expect(await run(['order.asl.json', '--out-dir', 'out'])).toBe(0);
        expect(existsSync(join(tempDir, 'out', 'order.svg'))).toBe(true);
    });
});
