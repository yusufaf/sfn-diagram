import {
    copyFileSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import Ajv from 'ajv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli';
import type { CliConfig } from '../src/cliConfig';
import {
    LINT_OUTPUT_SCHEMA,
    MAX_INLINE_TEXT_CHARS,
    createMcpTools,
} from '../src/cliMcp';
import type { McpTool, McpToolResult } from '../src/cliMcpServer';
import { generateMermaid, generateSvg } from '../src/index';
import { createLayoutCache } from '../src/layout';

const fixtures = join(__dirname, 'fixtures');
const simpleText = readFileSync(join(fixtures, 'simple.asl.json'), 'utf-8');

/** `simple` plus one extra state, so a diff against `simple` has something to report. */
const withLegacyText = JSON.stringify({
    ...JSON.parse(simpleText),
    States: {
        ...JSON.parse(simpleText).States,
        Legacy: { End: true, Type: 'Pass' },
    },
});

/** A chain of `count` Pass states, big enough as svg to pass the inline limit. */
function passChain(count: number): string {
    const states: Record<string, unknown> = {};
    for (let index = 0; index < count; index++) {
        states[`Step${index}`] =
            index === count - 1
                ? { End: true, Type: 'Pass' }
                : { Next: `Step${index + 1}`, Type: 'Pass' };
    }
    return JSON.stringify({ StartAt: 'Step0', States: states });
}

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sfn-mcp-'));
    for (const name of ['simple.asl.json', 'execution-success.json']) {
        copyFileSync(join(fixtures, name), join(workDir, name));
    }
});

afterEach(() => {
    rmSync(workDir, { force: true, recursive: true });
    vi.restoreAllMocks();
});

interface ToolsParams {
    config?: CliConfig | null;
    standalone?: boolean;
}

function tools({ config = null, standalone = false }: ToolsParams = {}): Map<
    string,
    McpTool
> {
    const list = createMcpTools({
        cache: createLayoutCache(),
        config,
        cwd: workDir,
        standalone,
    });
    return new Map(list.map((tool) => [tool.name, tool]));
}

interface CallParams extends ToolsParams {
    args: Record<string, unknown>;
    name: string;
}

/** Calls a tool the way the protocol layer does, turning a throw into an error result. */
async function call({
    args,
    name,
    ...rest
}: CallParams): Promise<McpToolResult> {
    const tool = tools(rest).get(name) as McpTool;
    try {
        return await tool.call(args);
    } catch (error) {
        return {
            content: [{ text: (error as Error).message, type: 'text' }],
            isError: true,
        };
    }
}

function textOf(result: McpToolResult, index = 0): string {
    const block = result.content.at(index);
    if (block?.type !== 'text') throw new Error('expected a text block');
    return block.text;
}

function summaryOf(result: McpToolResult): Record<string, unknown> {
    return JSON.parse(textOf(result, -1)) as Record<string, unknown>;
}

describe('render tool', () => {
    it('renders inline mermaid with a JSON summary and no structuredContent', async () => {
        const result = await call({
            args: { format: 'mermaid', source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toBe(
            generateMermaid({ aslDefinition: JSON.parse(simpleText) }).code,
        );
        expect(summaryOf(result)).toMatchObject({
            execution: null,
            format: 'mermaid',
            outputPath: null,
            warnings: [],
        });
        // Claude Code shows the model only structuredContent when it is present, which
        // would hide the diagram.
        expect(result).not.toHaveProperty('structuredContent');
    });

    it('reads the definition from a path relative to the working directory', async () => {
        const result = await call({
            args: { format: 'mermaid', path: 'simple.asl.json' },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain('stateDiagram');
    });

    it('refuses both path and source, and neither', async () => {
        const both = await call({
            args: {
                format: 'svg',
                path: 'simple.asl.json',
                source: simpleText,
            },
            name: 'render',
        });
        expect(both.isError).toBe(true);
        expect(textOf(both)).toContain('path');
        expect(textOf(both)).toContain('source');
        const neither = await call({ args: { format: 'svg' }, name: 'render' });
        expect(neither.isError).toBe(true);
    });

    it('names an unknown argument', async () => {
        const result = await call({
            args: { format: 'svg', layut: 'LR', source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('layut');
    });

    it('lists the allowed values of an invalid enum', async () => {
        const result = await call({
            args: { format: 'svg', layout: 'XX', source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('TB, LR, RL, BT');
    });

    it('requires format', async () => {
        const result = await call({
            args: { source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('format');
    });

    it('writes to outputPath and returns only the summary', async () => {
        const result = await call({
            args: {
                format: 'svg',
                outputPath: 'out.svg',
                path: 'simple.asl.json',
            },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        expect(result.content).toHaveLength(1);
        const summary = summaryOf(result);
        const written = join(workDir, 'out.svg');
        expect(summary.outputPath).toBe(written);
        expect(isAbsolute(summary.outputPath as string)).toBe(true);
        const contents = readFileSync(written);
        expect(summary.bytes).toBe(contents.byteLength);
        expect(contents.toString('utf-8')).toContain('<svg');
    });

    it('counts bytes, not characters, for non-ASCII output', async () => {
        const source = JSON.stringify({
            StartAt: 'Prüfen',
            States: { Prüfen: { End: true, Type: 'Pass' } },
        });
        const result = await call({
            args: { format: 'svg', outputPath: 'umlaut.svg', source },
            name: 'render',
        });
        const contents = readFileSync(join(workDir, 'umlaut.svg'));
        expect(summaryOf(result).bytes).toBe(contents.byteLength);
        expect(contents.byteLength).toBeGreaterThan(
            contents.toString('utf-8').length,
        );
    });

    it('refuses html without outputPath and writes it with one', async () => {
        const inline = await call({
            args: { format: 'html', source: simpleText },
            name: 'render',
        });
        expect(inline.isError).toBe(true);
        expect(textOf(inline)).toContain('outputPath');

        const written = await call({
            args: {
                format: 'html',
                outputPath: 'out.html',
                source: simpleText,
            },
            name: 'render',
        });
        expect(written.isError).toBeFalsy();
        expect(
            readFileSync(join(workDir, 'out.html'), 'utf-8').startsWith(
                '<!DOCTYPE html',
            ),
        ).toBe(true);
    });

    it('returns inline png as an image block', async () => {
        const result = await call({
            args: { format: 'png', source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        const image = result.content[0];
        expect(image.type).toBe('image');
        if (image.type !== 'image') return;
        expect(image.mimeType).toBe('image/png');
        expect([...Buffer.from(image.data, 'base64').subarray(0, 4)]).toEqual([
            0x89, 0x50, 0x4e, 0x47,
        ]);
    });

    it('refuses png in the standalone binary but still renders svg', async () => {
        const png = await call({
            args: { format: 'png', source: simpleText },
            name: 'render',
            standalone: true,
        });
        expect(png.isError).toBe(true);
        expect(textOf(png)).toContain('standalone binary');
        const svg = await call({
            args: { format: 'svg', source: simpleText },
            name: 'render',
            standalone: true,
        });
        expect(svg.isError).toBeFalsy();
    });

    it('refuses scale outside png', async () => {
        const result = await call({
            args: { format: 'svg', scale: 2, source: simpleText },
            name: 'render',
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('scale');
    });

    it('refuses inline svg over the size limit and suggests the alternatives', async () => {
        const source = passChain(80);
        // Guard against a vacuous pass: the svg really is over the limit.
        expect(
            generateSvg({ aslDefinition: JSON.parse(source) }).svg.length,
        ).toBeGreaterThan(MAX_INLINE_TEXT_CHARS);

        const svg = await call({
            args: { format: 'svg', source },
            name: 'render',
        });
        expect(svg.isError).toBe(true);
        expect(textOf(svg)).toContain('outputPath');
        expect(textOf(svg)).toContain('mermaid');

        const mermaid = await call({
            args: { format: 'mermaid', source },
            name: 'render',
        });
        expect(mermaid.isError).toBeFalsy();

        const written = await call({
            args: { format: 'svg', outputPath: 'big.svg', source },
            name: 'render',
        });
        expect(written.isError).toBeFalsy();
        expect(statSync(join(workDir, 'big.svg')).size).toBeGreaterThan(
            MAX_INLINE_TEXT_CHARS,
        );
    });

    it('overlays an execution history and summarizes it without the timeline', async () => {
        const result = await call({
            args: {
                format: 'mermaid',
                historyPath: 'execution-success.json',
                path: 'simple.asl.json',
            },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        const execution = summaryOf(result).execution as Record<
            string,
            unknown
        >;
        expect(execution.executionStatus).toBeTruthy();
        expect(execution).not.toHaveProperty('timeline');
    });

    it('renders an inline CloudFormation template', async () => {
        const template = JSON.stringify({
            Resources: {
                Flow: {
                    Properties: { Definition: JSON.parse(simpleText) },
                    Type: 'AWS::StepFunctions::StateMachine',
                },
            },
        });
        const result = await call({
            args: { format: 'mermaid', source: template },
            name: 'render',
        });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain('stateDiagram');
    });

    it('applies the config file under the arguments', async () => {
        const render = async (
            args: Record<string, unknown>,
            config: CliConfig | null,
        ): Promise<string> =>
            textOf(
                await call({
                    args: { format: 'svg', source: simpleText, ...args },
                    config,
                    name: 'render',
                }),
            );
        const fromConfig = await render({}, { layout: 'LR' });
        expect(fromConfig).toBe(await render({ layout: 'LR' }, null));
        expect(fromConfig).not.toBe(await render({}, null));
        expect(await render({ layout: 'BT' }, { layout: 'LR' })).toBe(
            await render({ layout: 'BT' }, null),
        );
    });

    it('reports invalid ASL as an error', async () => {
        const result = await call({
            args: { format: 'svg', source: '{' },
            name: 'render',
        });
        expect(result.isError).toBe(true);
    });
});

describe('diff tool', () => {
    it('summarizes the changed states without structuredContent', async () => {
        const result = await call({
            args: {
                baseline: simpleText,
                format: 'mermaid',
                source: withLegacyText,
            },
            name: 'diff',
        });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain('stateDiagram');
        expect((summaryOf(result).diff as { added: string[] }).added).toEqual([
            'Legacy',
        ]);
        expect(result).not.toHaveProperty('structuredContent');
    });

    it('reads the baseline from a path', async () => {
        const result = await call({
            args: {
                baselinePath: 'simple.asl.json',
                format: 'mermaid',
                source: withLegacyText,
            },
            name: 'diff',
        });
        expect((summaryOf(result).diff as { added: string[] }).added).toEqual([
            'Legacy',
        ]);
    });

    it('requires a baseline and refuses png', async () => {
        const missing = await call({
            args: { format: 'mermaid', source: simpleText },
            name: 'diff',
        });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toContain('baseline');
        const png = await call({
            args: { baseline: simpleText, format: 'png', source: simpleText },
            name: 'diff',
        });
        expect(png.isError).toBe(true);
    });
});

describe('lint tool', () => {
    const validateLint = new Ajv().compile(LINT_OUTPUT_SCHEMA);

    async function lint(
        args: Record<string, unknown>,
    ): Promise<McpToolResult & { structuredContent: Record<string, unknown> }> {
        const result = await call({ args, name: 'lint' });
        expect(result.structuredContent).toBeDefined();
        // The same JSON goes to a client whichever field it forwards to the model.
        expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
        expect(validateLint(result.structuredContent)).toBe(true);
        return result as McpToolResult & {
            structuredContent: Record<string, unknown>;
        };
    }

    it('reports a clean definition', async () => {
        const result = await lint({ path: 'simple.asl.json' });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({
            diagnostics: [],
            kind: 'lint',
            warnings: [],
        });
    });

    it('reports a dangling transition without failing the call', async () => {
        const source = JSON.stringify({
            StartAt: 'A',
            States: { A: { Next: 'Missing', Type: 'Pass' } },
        });
        const result = await lint({ source });
        expect(result.isError).toBeFalsy();
        const diagnostics = result.structuredContent.diagnostics as {
            code: string;
        }[];
        expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
            'dangling-transition',
        );
    });

    it('lints unparseable JSON as an invalid-json finding, as --check does', async () => {
        const result = await lint({ source: '{' });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent.kind).toBe('lint');
        const diagnostics = result.structuredContent.diagnostics as {
            code: string;
        }[];
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].code).toBe('invalid-json');
    });

    it('reports an extraction failure as kind error', async () => {
        const result = await lint({
            resolveCfn: true,
            source: '{"Resources":{}}',
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent.kind).toBe('error');
        expect(result.structuredContent.message).toContain('StateMachine');
    });

    it('reads a DefinitionUri beside a template given by path', async () => {
        const result = await lint({
            path: join(fixtures, 'cfn', 'sam-definition-uri.yaml'),
            resolveCfn: true,
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent.kind).toBe('lint');
    });

    it('reads a CDK asset beside a template given by path', async () => {
        const result = await lint({
            path: join(fixtures, 'cfn', 'cdk-asset', 'RefundStack.template.json'),
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent.kind).toBe('lint');
    });

    it('keeps the DefinitionUri diagnostic for a template sent as source', async () => {
        const result = await lint({
            resolveCfn: true,
            source: readFileSync(join(fixtures, 'cfn', 'sam-definition-uri.yaml'), 'utf-8'),
        });
        expect(result.structuredContent.kind).toBe('error');
        expect(result.structuredContent.message).toMatch(/cannot be read from the template alone/);
    });

    it('reports an unreadable path as kind error naming the path', async () => {
        const result = await lint({ path: 'missing.asl.json' });
        expect(result.isError).toBe(true);
        expect(result.structuredContent.kind).toBe('error');
        expect(result.structuredContent.message).toContain('missing.asl.json');
    });

    it('keeps argument mistakes as plain errors', async () => {
        const result = await call({
            args: { format: 'svg', path: 'x' },
            name: 'lint',
        });
        expect(result.isError).toBe(true);
        expect(result).not.toHaveProperty('structuredContent');
    });
});

describe('tools write nothing to stdout', () => {
    it('across every tool and format', async () => {
        const spies = [
            vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
            vi.spyOn(console, 'log').mockImplementation(() => undefined),
            vi.spyOn(console, 'info').mockImplementation(() => undefined),
            vi.spyOn(console, 'debug').mockImplementation(() => undefined),
        ];
        const calls: CallParams[] = [
            {
                args: { format: 'svg', path: 'simple.asl.json' },
                name: 'render',
            },
            {
                args: { format: 'mermaid', path: 'simple.asl.json' },
                name: 'render',
            },
            {
                args: { format: 'png', path: 'simple.asl.json' },
                name: 'render',
            },
            {
                args: {
                    format: 'html',
                    outputPath: 'o.html',
                    path: 'simple.asl.json',
                },
                name: 'render',
            },
            {
                args: {
                    format: 'svg',
                    historyPath: 'execution-success.json',
                    path: 'simple.asl.json',
                },
                name: 'render',
            },
            {
                args: {
                    baseline: simpleText,
                    format: 'mermaid',
                    source: withLegacyText,
                },
                name: 'diff',
            },
            { args: { path: 'simple.asl.json' }, name: 'lint' },
            { args: { source: '{' }, name: 'lint' },
        ];
        for (const params of calls) {
            const result = await call(params);
            expect(result.isError, JSON.stringify(params.args)).toBeFalsy();
        }
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
});

describe('tool definitions', () => {
    const list = createMcpTools({
        cache: createLayoutCache(),
        config: null,
        cwd: '.',
        standalone: false,
    });

    it('are render, diff and lint, with valid names and required keys', () => {
        expect(list.map((tool) => tool.name)).toEqual([
            'render',
            'diff',
            'lint',
        ]);
        for (const tool of list) {
            expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
            const schema = tool.inputSchema as {
                properties: Record<string, unknown>;
                required?: string[];
                type: string;
            };
            expect(schema.type).toBe('object');
            for (const key of schema.required ?? []) {
                expect(schema.properties).toHaveProperty(key);
            }
        }
    });

    it('give only lint an output schema', () => {
        expect(
            list.filter((tool) => tool.outputSchema).map((tool) => tool.name),
        ).toEqual(['lint']);
    });
});

describe('run(["mcp", ...])', () => {
    let stdout: string;
    let stderr: string;

    beforeEach(() => {
        stdout = '';
        stderr = '';
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdout += String(chunk);
            return true;
        });
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderr += String(chunk);
            return true;
        });
    });

    it('prints its help', async () => {
        expect(await run(['mcp', '--help'])).toBe(0);
        expect(stdout).toContain('sfn-diagram mcp');
    });

    it('refuses an unknown flag with exit 2', async () => {
        expect(await run(['mcp', '--bogus'])).toBe(2);
        expect(stderr).toContain('--bogus');
    });

    it('fails with exit 1 on a config file that cannot be loaded', async () => {
        expect(
            await run(['mcp', '--config', join(workDir, 'missing.json')]),
        ).toBe(1);
        expect(stderr).toContain('Error:');
    });

    it('is listed in the main help', async () => {
        expect(await run(['--help'])).toBe(0);
        expect(stdout).toContain('sfn-diagram mcp');
    });
});
