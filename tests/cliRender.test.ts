import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A pass-through spy, so a test can read the options the service handed to renderPng
// while still being able to stub out the real render where only the options matter.
vi.mock('../src/exporters/renderPng', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/exporters/renderPng')>();
    return { ...actual, renderPng: vi.fn(actual.renderPng) };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { handleRenderRequest } from '../src/cliRender';
import type {
    HandleRenderRequestParams,
    RenderDefinitionInput,
} from '../src/cliRender';
import { resolveCliOptions } from '../src/cliOptions';
import type { CliOptionSource, ResolvedCliOptions } from '../src/cliOptions';
import { generateMermaid, generateSvg } from '../src/index';
import { createLayoutCache } from '../src/layout';
import { renderPng } from '../src/exporters/renderPng';

const fixtures = join(__dirname, 'fixtures');
const readFixture = (...segments: string[]): string =>
    readFileSync(join(fixtures, ...segments), 'utf-8');

const simpleText = readFixture('simple.asl.json');
const historyText = readFixture('execution-success.json');

/** `simple` plus one extra state, so a diff against `simple` has something to report. */
const withLegacyText = JSON.stringify({
    ...JSON.parse(simpleText),
    States: {
        ...JSON.parse(simpleText).States,
        Legacy: { End: true, Type: 'Pass' },
    },
});

/** A CloudFormation JSON template wrapping `definition` in one state machine resource. */
const cfnTemplate = (definition: unknown): string =>
    JSON.stringify({
        Resources: {
            StateMachine: {
                Properties: { Definition: definition },
                Type: 'AWS::StepFunctions::StateMachine',
            },
        },
    });

/** Skips the real render where only the options passed to renderPng matter. */
const STUB_PNG = {
    buffer: Buffer.from('png'),
    height: 1,
    metadata: { format: 'png' as const },
    width: 1,
};

/** A command line on which no option-bearing flag was given. */
const noFlags: CliOptionSource = {
    backgroundColor: null,
    catchHandling: null,
    catchLabelStyle: null,
    collapse: null,
    diagramDescription: null,
    diagramTitle: null,
    edgeStyle: null,
    format: null,
    iconPosition: null,
    iconSize: null,
    includeComments: null,
    includeRawState: null,
    layout: null,
    loadSystemFonts: null,
    nodeHeight: null,
    nodeSeparation: null,
    nodeWidth: null,
    padding: null,
    rankSeparation: null,
    redactFields: null,
    scale: null,
    showIcons: null,
    showStateTypes: null,
    showVariables: null,
    stylePreset: null,
    theme: null,
};

const defaults: ResolvedCliOptions = resolveCliOptions({
    args: noFlags,
    config: null,
});

/** A definition input with every hint off, so detection runs on the text alone. */
const input = (
    source: string,
    overrides: Partial<RenderDefinitionInput> = {},
): RenderDefinitionInput => ({
    path: null,
    resolveCfn: false,
    resource: null,
    source,
    ...overrides,
});

/** A render request for `definition` with defaults for everything not overridden. */
const request = (
    overrides: Partial<HandleRenderRequestParams> & {
        options?: Partial<ResolvedCliOptions>;
    },
): HandleRenderRequestParams => ({
    baseline: null,
    cache: createLayoutCache(),
    definition: input(simpleText),
    history: null,
    mode: 'render',
    ...overrides,
    options: { ...defaults, ...overrides.options },
});

describe('handleRenderRequest: input detection and lint', () => {
    it('lints plain ASL text with no warnings', async () => {
        const response = await handleRenderRequest(request({ mode: 'lint' }));
        expect(response).toEqual({
            diagnostics: [],
            kind: 'lint',
            warnings: [],
        });
    });

    it.each(['main.tf', 'main'])(
        'reads Terraform by extension or by content (path %s)',
        async (path) => {
            const response = await handleRenderRequest(
                request({
                    definition: input(readFixture('terraform', 'heredoc.tf'), {
                        path,
                    }),
                    mode: 'lint',
                }),
            );
            expect(response).toEqual({
                diagnostics: [],
                kind: 'lint',
                warnings: [],
            });
        },
    );

    it('auto-detects a CloudFormation JSON template without resolveCfn', async () => {
        const response = await handleRenderRequest(
            request({
                definition: input(cfnTemplate(JSON.parse(simpleText))),
                mode: 'lint',
            }),
        );
        expect(response).toEqual({
            diagnostics: [],
            kind: 'lint',
            warnings: [],
        });
    });

    it('reads a YAML template only when resolveCfn is set', async () => {
        const yaml = readFixture('cfn', 'cfn-template.yaml');
        const resolved = await handleRenderRequest(
            request({
                definition: input(yaml, { resolveCfn: true }),
                mode: 'lint',
            }),
        );
        expect(resolved).toEqual({
            diagnostics: [],
            kind: 'lint',
            warnings: [],
        });

        const unresolved = await handleRenderRequest(
            request({ definition: input(yaml), mode: 'lint' }),
        );
        expect(unresolved.kind).toBe('lint');
        if (unresolved.kind !== 'lint') return;
        expect(
            unresolved.diagnostics.map((diagnostic) => diagnostic.code),
        ).toEqual(['invalid-json']);
    });

    it('returns extraction warnings instead of printing them', async () => {
        const response = await handleRenderRequest(
            request({
                definition: input(readFixture('terraform', 'jsonencode.tf')),
                mode: 'lint',
            }),
        );
        expect(response.kind).toBe('lint');
        expect(response.warnings).toHaveLength(1);
        expect(response.warnings[0]).toMatch(/^Expression format\(/);
    });

    it('returns an extraction failure as an error value', async () => {
        const response = await handleRenderRequest(
            request({
                definition: input('{"Resources":{}}', { resolveCfn: true }),
                mode: 'lint',
            }),
        );
        expect(response.kind).toBe('error');
        if (response.kind !== 'error') return;
        expect(response.message).toContain('Template contains no');
        expect(response.warnings).toEqual([]);
    });

    it("keeps the head's warnings when the baseline fails to extract", async () => {
        const response = await handleRenderRequest(
            request({
                baseline: input(readFixture('terraform', 'no-definition.tf')),
                definition: input(readFixture('terraform', 'jsonencode.tf')),
                mode: 'lint',
            }),
        );
        expect(response.kind).toBe('error');
        expect(response.warnings).toHaveLength(1);
        expect(response.warnings[0]).toMatch(/^Expression format\(/);
    });
});

describe('handleRenderRequest: render dispatch', () => {
    beforeEach(() => {
        // mockReset, not mockClear: a test below stubs a persistent resolved value, and
        // reset brings back the pass-through so later tests render for real.
        vi.mocked(renderPng).mockReset();
    });

    it('renders svg byte-identical to generateSvg with the default options', async () => {
        const response = await handleRenderRequest(request({}));
        expect(response).toEqual({
            diff: null,
            execution: null,
            kind: 'render',
            output: generateSvg({
                aslDefinition: simpleText,
                catchHandling: 'show',
                layout: 'TB',
                theme: 'light',
            }).svg,
            warnings: [],
        });
    });

    it('renders mermaid identical to generateMermaid with the default options', async () => {
        const response = await handleRenderRequest(
            request({ options: { format: 'mermaid' } }),
        );
        expect(response).toEqual({
            diff: null,
            execution: null,
            kind: 'render',
            output: generateMermaid({
                aslDefinition: simpleText,
                catchHandling: 'show',
                layout: 'TB',
                theme: 'light',
            }).code,
            warnings: [],
        });
    });

    it.each(['svg', 'mermaid'] as const)(
        'returns the diff summary for a %s diff',
        async (format) => {
            const response = await handleRenderRequest(
                request({
                    baseline: input(simpleText),
                    definition: input(withLegacyText),
                    options: { format },
                }),
            );
            expect(response.kind).toBe('render');
            if (response.kind !== 'render') return;
            expect(typeof response.output).toBe('string');
            expect(response.diff?.added).toEqual(['Legacy']);
            expect(response.diff?.removed).toEqual([]);
            expect(response.execution).toBeNull();
        },
    );

    it.each(['svg', 'mermaid'] as const)(
        'returns the execution summary for a %s overlay',
        async (format) => {
            const response = await handleRenderRequest(
                request({ history: historyText, options: { format } }),
            );
            expect(response.kind).toBe('render');
            if (response.kind !== 'render') return;
            expect(typeof response.output).toBe('string');
            expect(response.diff).toBeNull();
            expect(response.execution).not.toBeNull();
        },
    );

    it('renders html with both overlays and both summaries', async () => {
        const response = await handleRenderRequest(
            request({
                baseline: input(simpleText),
                definition: input(withLegacyText),
                history: historyText,
                options: { format: 'html' },
            }),
        );
        expect(response.kind).toBe('render');
        if (response.kind !== 'render') return;
        expect(response.output).toContain('<!DOCTYPE html>');
        expect(response.diff?.added).toEqual(['Legacy']);
        expect(response.execution).not.toBeNull();
    });

    it('returns png bytes and leaves unset png options out', async () => {
        vi.mocked(renderPng).mockResolvedValue(STUB_PNG);
        const unset = await handleRenderRequest(
            request({ options: { format: 'png' } }),
        );
        expect(unset.kind).toBe('render');
        if (unset.kind !== 'render') return;
        expect(unset.output).toBeInstanceOf(Uint8Array);
        const unsetCall = vi.mocked(renderPng).mock.lastCall?.[0];
        expect(unsetCall).not.toHaveProperty('loadSystemFonts');
        expect(unsetCall).not.toHaveProperty('maxPixels');
        expect(unsetCall).not.toHaveProperty('scale');

        await handleRenderRequest(
            request({
                options: { format: 'png', loadSystemFonts: false, scale: 2 },
            }),
        );
        const setCall = vi.mocked(renderPng).mock.lastCall?.[0];
        expect(setCall).toMatchObject({ loadSystemFonts: false, scale: 2 });
    });

    it('passes maxPngPixels to the png render and returns an over-limit png as an error', async () => {
        const response = await handleRenderRequest(
            request({ maxPngPixels: 1, options: { format: 'png' } }),
        );
        expect(response.kind).toBe('error');
        if (response.kind !== 'error') return;
        expect(response.message).toContain('above the limit of 1 pixels');
        expect(vi.mocked(renderPng).mock.lastCall?.[0]).toMatchObject({ maxPixels: 1 });
    });

    it('ignores maxPngPixels outside png', async () => {
        const response = await handleRenderRequest(request({ maxPngPixels: 1 }));
        expect(response.kind).toBe('render');
    });

    it('returns a render failure as an error value that keeps the warnings', async () => {
        const template = cfnTemplate({
            StartAt: 'A',
            States: {
                A: {
                    Next: 'Missing',
                    Resource: { 'Fn::Select': [0, ['arn:a', 'arn:b']] },
                    Type: 'Task',
                },
            },
        });
        const response = await handleRenderRequest(
            request({ definition: input(template) }),
        );
        expect(response.kind).toBe('error');
        if (response.kind !== 'error') return;
        expect(response.message).toContain('non-existent state "Missing"');
        expect(response.warnings).toEqual([
            'Unresolved intrinsic Fn::Select replaced with placeholder',
        ]);
    });

    describe('process output', () => {
        let stdout: ReturnType<typeof vi.spyOn>;
        let stderr: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stdout = vi
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => true);
            stderr = vi
                .spyOn(process.stderr, 'write')
                .mockImplementation(() => true);
        });

        afterEach(() => {
            stdout.mockRestore();
            stderr.mockRestore();
        });

        it('writes nothing to stdout or stderr, even with warnings', async () => {
            const response = await handleRenderRequest(
                request({
                    definition: input(
                        readFixture('terraform', 'jsonencode.tf'),
                    ),
                }),
            );
            expect(response.kind).toBe('render');
            expect(response.warnings).toHaveLength(1);
            expect(stdout).not.toHaveBeenCalled();
            expect(stderr).not.toHaveBeenCalled();
        });
    });
});

describe('handleRenderRequest: overlay guards', () => {
    beforeEach(() => {
        vi.mocked(renderPng).mockClear();
    });

    it('refuses an overlay in a format without an overlay renderer', async () => {
        const response = await handleRenderRequest(
            request({
                baseline: input(simpleText),
                options: { format: 'png' },
            }),
        );
        expect(response).toEqual({
            kind: 'error',
            message:
                'diff and execution overlays support svg, mermaid or html output, not png',
            warnings: [],
        });
        expect(renderPng).not.toHaveBeenCalled();
    });

    it('refuses a combined diff and execution overlay outside html', async () => {
        const response = await handleRenderRequest(
            request({ baseline: input(simpleText), history: historyText }),
        );
        expect(response).toEqual({
            kind: 'error',
            message:
                'a diff and an execution overlay can only be combined in html output, not svg',
            warnings: [],
        });
    });

    it('does not apply the overlay guards to lint mode', async () => {
        const response = await handleRenderRequest(
            request({
                baseline: input(simpleText),
                mode: 'lint',
                options: { format: 'png' },
            }),
        );
        expect(response).toEqual({
            diagnostics: [],
            kind: 'lint',
            warnings: [],
        });
    });
});

describe('cliRender module contract', () => {
    const sourceFile = ts.createSourceFile(
        'cliRender.ts',
        readFileSync(join(__dirname, '..', 'src', 'cliRender.ts'), 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
    );

    it('imports no node: module', () => {
        const specifiers = sourceFile.statements
            .filter(ts.isImportDeclaration)
            .map(
                (statement) =>
                    (statement.moduleSpecifier as ts.StringLiteral).text,
            );
        expect(specifiers.length).toBeGreaterThan(0);
        expect(
            specifiers.filter((specifier) => specifier.startsWith('node:')),
        ).toEqual([]);
    });

    it('never references process', () => {
        const processReferences: number[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node) && node.text === 'process') {
                processReferences.push(
                    sourceFile.getLineAndCharacterOfPosition(node.getStart())
                        .line + 1,
                );
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        expect(processReferences).toEqual([]);
    });
});
