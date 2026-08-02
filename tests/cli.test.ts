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

    it('parses --diff and --execution', () => {
        expect(parseArgs(['head.json', '--diff', 'base.json']).diff).toBe('base.json');
        expect(parseArgs(['head.json', '--execution', 'history.json']).execution).toBe(
            'history.json'
        );
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
        expect(parseArgs(['in.json', '--hide-variables']).hideVariables).toBe(true);
    });

    it('rejects an invalid --icon-position', () => {
        expect(() => parseArgs(['in.json', '--icon-position', 'below'])).toThrowError(
            /Invalid --icon-position/
        );
    });

    it('rejects a non-numeric --icon-size', () => {
        expect(() => parseArgs(['in.json', '--icon-size', 'big'])).toThrowError(
            /Invalid --icon-size/
        );
    });

    it('rejects a non-positive --icon-size', () => {
        expect(() => parseArgs(['in.json', '--icon-size', '0'])).toThrowError(/Invalid --icon-size/);
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
        expect(withCatch).toContain('class H failState');

        stdoutData = '';
        const withoutCode = await run([inputPath, '--format', 'mermaid', '--hide-catch']);
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
        const code = await run([simpleFixture, '--format', 'html', '-o', outPath]);
        expect(code).toBe(0);
        const written = readFileSync(outPath, 'utf-8');
        expect(written).toContain('<!DOCTYPE html>');
        expect(stdoutData).toBe('');
    });
});

describe('diff, execution and icon flags', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stdoutData: string;
    let stderrData: string;
    let tempDir: string;

    const variablesFixture = join(__dirname, 'fixtures', 'variables.asl.json');
    const executionFixture = join(__dirname, 'fixtures', 'execution-success.json');

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
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ProcessData',
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
        stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdoutData += chunk.toString();
            return true;
        });
        stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
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
        const code = await run([write('head.json', headAsl), '--diff', write('base.json', baseAsl)]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
        // added green, modified yellow, removed red
        expect(stdoutData).toContain('#c8e6c9');
        expect(stdoutData).toContain('#fff9c4');
        expect(stdoutData).toContain('#ffcdd2');
    });

    it('--diff prints a change summary to stderr', async () => {
        const code = await run([write('head.json', headAsl), '--diff', write('base.json', baseAsl)]);
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
        const code = await run([simpleFixture, '--execution', executionFixture]);
        expect(code).toBe(0);
        expect(stdoutData).toContain('<svg');
        // succeeded states are green
        expect(stdoutData).toContain('#c8e6c9');
    });

    it('--execution prints a status summary to stderr', async () => {
        const code = await run([simpleFixture, '--execution', executionFixture]);
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
        const code = await run([simpleFixture, '--execution', join(tempDir, 'nope.json')]);
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
        expect(stderrData).toContain('--diff and --execution cannot be combined');
    });

    it('rejects --diff with a format that has no diff renderer', async () => {
        const code = await run([
            write('head.json', headAsl),
            '--diff',
            write('base.json', baseAsl),
            '--format',
            'html',
        ]);
        expect(code).toBe(1);
        expect(stderrData).toContain('--diff supports --format svg or mermaid');
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
        expect(stderrData).toContain('--execution supports --format svg or mermaid');
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
        const code = await run([inputPath, '--show-icons', '--icon-size', '40']);
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
        stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdoutData += chunk.toString();
            return true;
        });
        stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
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
        const args = parseArgs(['t.json', '--resolve-cfn', '--resource', 'MyMachine']);
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
        const code = await run([inputPath, '--resolve-cfn', '--format', 'mermaid']);
        expect(code).toBe(0);
        expect(stdoutData).toContain('Go');
    });

    it('errors with resource ids when multiple machines and no --resource', async () => {
        const multi = JSON.stringify({
            Resources: {
                A: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString: '{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}',
                    },
                },
                B: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString: '{"StartAt":"B","States":{"B":{"Type":"Succeed"}}}',
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
                        DefinitionString: '{"StartAt":"Alpha","States":{"Alpha":{"Type":"Succeed"}}}',
                    },
                },
                B: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString: '{"StartAt":"Beta","States":{"Beta":{"Type":"Succeed"}}}',
                    },
                },
            },
        });
        const inputPath = writeTemplate('multi.json', multi);
        const code = await run([inputPath, '--format', 'mermaid', '--resource', 'B']);
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
