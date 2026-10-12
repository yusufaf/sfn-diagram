import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractAslFromTerraform, isTerraformConfig } from '../../src/terraform/extract';

const currentDir = dirname(fileURLToPath(import.meta.url));

const fixture = (name: string): string =>
    readFileSync(join(currentDir, '..', 'fixtures', 'terraform', name), 'utf-8');

const lineEndings = (text: string, ending: '\n' | '\r\n'): string => text.replace(/\r?\n/g, ending);

/** Wraps a `definition` expression in a minimal state machine resource. */
const withDefinition = (definition: string): string =>
    `resource "aws_sfn_state_machine" "m" {\n  name = "m"\n  definition = ${definition}\n}\n`;

describe('extractAslFromTerraform', () => {
    describe('HCL heredoc', () => {
        it('recovers ASL and turns interpolations into placeholders', () => {
            const { aslDefinition, resourceId, warnings } = extractAslFromTerraform({
                config: fixture('heredoc.tf'),
            });
            expect(resourceId).toBe('orders');
            expect(aslDefinition.StartAt).toBe('Charge');
            expect(aslDefinition.States.Charge.Resource).toBe('${aws_lambda_function.charge.arn}');
            expect(aslDefinition.States.Pause.Seconds).toBe('${var.wait}');
            expect(warnings).toEqual([]);
        });

        it('handles an indented <<- heredoc', () => {
            const { aslDefinition, resourceId } = extractAslFromTerraform({
                config: fixture('indented-heredoc.tf'),
            });
            expect(resourceId).toBe('indented');
            expect(aslDefinition.States.A.Next).toBe('B');
        });

        it.each([
            ['LF', '\n'],
            ['CRLF', '\r\n'],
        ] as const)('handles %s line endings', (_label, ending) => {
            const { aslDefinition } = extractAslFromTerraform({
                config: lineEndings(fixture('heredoc.tf'), ending),
            });
            expect(aslDefinition.StartAt).toBe('Charge');
            expect(aslDefinition.States.Pause.Seconds).toBe('${var.wait}');
        });
    });

    it('reads a file that starts with a byte order mark', () => {
        const { aslDefinition } = extractAslFromTerraform({
            config: `${String.fromCharCode(0xfeff)}${fixture('jsonencode.tf')}`,
        });
        expect(aslDefinition.States.Charge.Resource).toBe('${aws_lambda_function.charge.arn}');
    });

    it('reads a .tf.json file that starts with a byte order mark', () => {
        const { aslDefinition } = extractAslFromTerraform({
            config: `${String.fromCharCode(0xfeff)}${fixture('config.tf.json')}`,
        });
        expect(aslDefinition.StartAt).toBe('Charge');
    });

    describe('HCL quoted string', () => {
        it('decodes the escaped JSON', () => {
            const { aslDefinition, resourceId } = extractAslFromTerraform({ config: fixture('quoted.tf') });
            expect(resourceId).toBe('quoted');
            expect(aslDefinition).toEqual({
                StartAt: 'A',
                States: { A: { Type: 'Succeed' } },
            });
        });
    });

    describe('jsonencode', () => {
        it('evaluates the literal and warns only about the function call', () => {
            const { aslDefinition, warnings } = extractAslFromTerraform({
                config: fixture('jsonencode.tf'),
            });
            expect(aslDefinition.StartAt).toBe('Charge');
            expect(aslDefinition.States.Charge.Resource).toBe('${aws_lambda_function.charge.arn}');
            expect(aslDefinition.States.Charge.Parameters.FunctionName).toBe('${format("%s-fn", var.env)}');
            expect(aslDefinition.States.Charge.Retry[0].BackoffRate).toBe(1.5);
            expect(aslDefinition.States['Wait 5'].Seconds).toBe(5);
            expect((aslDefinition as unknown as Record<string, unknown>).TimeoutSeconds).toBe(300);
            expect((aslDefinition as unknown as Record<string, unknown>).Extras).toEqual([-1, true, false, null]);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('format(');
        });

        it('throws when jsonencode does not wrap an object literal', () => {
            expect(() => extractAslFromTerraform({ config: withDefinition('jsonencode([1, 2])') })).toThrow(
                /jsonencode\(\.\.\.\).*object/,
            );
        });
    });

    describe('.tf.json', () => {
        it('recovers a string definition and ignores "//" comment keys at every level', () => {
            const { aslDefinition, resourceId, warnings } = extractAslFromTerraform({
                config: fixture('config.tf.json'),
            });
            expect(resourceId).toBe('orders');
            expect(aslDefinition.States.Charge.Resource).toBe('${aws_lambda_function.charge.arn}');
            expect(aslDefinition.States.Pause.Seconds).toBe('${var.wait}');
            expect(warnings).toEqual([]);
        });

        it('unwraps a single ${jsonencode(...)} interpolation across array-wrapped label levels', () => {
            const { aslDefinition, resourceId, warnings } = extractAslFromTerraform({
                config: fixture('jsonencode.tf.json'),
            });
            expect(resourceId).toBe('encoded');
            expect(aslDefinition.States.B.Resource).toBe('${aws_lambda_function.b.arn}');
            expect(warnings).toEqual([]);
        });

        it('accepts an already-parsed object', () => {
            const { aslDefinition } = extractAslFromTerraform({
                config: JSON.parse(fixture('config.tf.json')) as Record<string, unknown>,
            });
            expect(aslDefinition.StartAt).toBe('Charge');
        });

        it.each([
            ['LF', '\n'],
            ['CRLF', '\r\n'],
        ] as const)('handles %s line endings', (_label, ending) => {
            const { aslDefinition } = extractAslFromTerraform({
                config: lineEndings(fixture('config.tf.json'), ending),
            });
            expect(aslDefinition.StartAt).toBe('Charge');
        });

        it('throws when the definition is not a string', () => {
            expect(() =>
                extractAslFromTerraform({
                    config: { resource: { aws_sfn_state_machine: { m: { definition: { StartAt: 'A' } } } } },
                }),
            ).toThrow(/must be a string/);
        });

        it('throws a clear error for text that is not valid JSON', () => {
            expect(() => extractAslFromTerraform({ config: '{ not json', format: 'json' })).toThrow(
                /not valid JSON/,
            );
        });
    });

    describe('choosing a resource', () => {
        it('throws listing the names when several state machines exist', () => {
            expect(() => extractAslFromTerraform({ config: fixture('multi.tf') })).toThrow(
                /orders, refunds.*resourceId/,
            );
        });

        it.each(['refunds', 'aws_sfn_state_machine.refunds'])('selects by %s', (resourceId) => {
            const result = extractAslFromTerraform({ config: fixture('multi.tf'), resourceId });
            expect(result.resourceId).toBe('refunds');
            expect(result.aslDefinition.StartAt).toBe('Refund');
        });

        it('throws for an unknown id and lists what exists', () => {
            expect(() => extractAslFromTerraform({ config: fixture('multi.tf'), resourceId: 'nope' })).toThrow(
                /nope.*orders, refunds/,
            );
        });
    });

    describe('unsupported definitions', () => {
        it('explains templatefile() and names the templated path', () => {
            expect(() => extractAslFromTerraform({ config: fixture('templatefile.tf') })).toThrow(
                /templatefile\(\).*\$\{path\.module\}\/sfn\.asl\.json/s,
            );
        });

        it('explains file() and names the path', () => {
            expect(() => extractAslFromTerraform({ config: fixture('file.tf') })).toThrow(
                /file\(\).*sfn\.asl\.json/s,
            );
        });

        it('explains a reference such as local.x', () => {
            expect(() => extractAslFromTerraform({ config: fixture('local-ref.tf') })).toThrow(
                /reference local\.x.*only Terraform can evaluate/s,
            );
        });

        it('says a module-only configuration has no aws_sfn_state_machine resource', () => {
            expect(() => extractAslFromTerraform({ config: fixture('module-only.tf') })).toThrow(
                /no aws_sfn_state_machine resource.*module/s,
            );
        });

        it('rejects a template directive inside the definition', () => {
            expect(() => extractAslFromTerraform({ config: fixture('directive.tf') })).toThrow(
                /aws_sfn_state_machine\.directive.*directive %\{/s,
            );
        });

        it('reports a missing definition', () => {
            expect(() => extractAslFromTerraform({ config: fixture('no-definition.tf') })).toThrow(
                /aws_sfn_state_machine\.empty has no definition/,
            );
        });

        it('wraps a syntax error with its line', () => {
            expect(() => extractAslFromTerraform({ config: 'a = "unterminated\n' })).toThrow(
                /Terraform syntax error: .*line 1/,
            );
        });

        it('rejects an expression that is not a supported definition form', () => {
            expect(() => extractAslFromTerraform({ config: withDefinition('format("%s", var.x)') })).toThrow(
                /heredoc.*jsonencode/s,
            );
        });
    });

    describe('single-interpolation templates', () => {
        const wrapped = (inner: string): string => withDefinition(`"\${${inner}}"`);

        it('reports a lone reference, not "not valid JSON"', () => {
            expect(() => extractAslFromTerraform({ config: wrapped('local.def') })).toThrow(/reference local\.def/);
        });

        it('reports file() inside a lone interpolation', () => {
            expect(() => extractAslFromTerraform({ config: wrapped('file("x.json")') })).toThrow(/file\(\).*x\.json/s);
        });

        it('treats a heredoc holding only an interpolation and a newline the same way', () => {
            const config = withDefinition('<<EOF\n${data.template_file.sfn.rendered}\nEOF');
            expect(() => extractAslFromTerraform({ config })).toThrow(/reference data\.template_file\.sfn\.rendered/);
        });

        it('evaluates a wrapped jsonencode', () => {
            const { aslDefinition } = extractAslFromTerraform({
                config: wrapped('jsonencode({StartAt = "A", States = {A = {Type = "Pass", End = true}}})'),
            });
            expect(aslDefinition.StartAt).toBe('A');
        });

        it.each([
            ['"[1]"', '[1]'],
            ['"\\"text\\""', '"text"'],
        ])('rejects a definition that renders to %s', (definition) => {
            expect(() => extractAslFromTerraform({ config: withDefinition(definition) })).toThrow(
                /does not render to a JSON object/,
            );
        });

        it('applies the same checks to .tf.json', () => {
            const json = (definition: string): Record<string, unknown> => ({
                resource: { aws_sfn_state_machine: { m: { definition } } },
            });
            expect(() => extractAslFromTerraform({ config: json('${local.def}') })).toThrow(/reference local\.def/);
            expect(() => extractAslFromTerraform({ config: json('[1]') })).toThrow(/does not render to a JSON object/);
        });
    });
});

describe('isTerraformConfig', () => {
    it('recognises HCL and .tf.json that declare a state machine', () => {
        expect(isTerraformConfig({ source: fixture('heredoc.tf') })).toBe(true);
        expect(isTerraformConfig({ source: fixture('config.tf.json') })).toBe(true);
        expect(isTerraformConfig({ source: fixture('jsonencode.tf.json') })).toBe(true);
    });

    it('rejects ASL JSON, a CloudFormation template and YAML', () => {
        expect(isTerraformConfig({ source: '{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}' })).toBe(false);
        expect(
            isTerraformConfig({
                source: '{"Resources":{"M":{"Type":"AWS::StepFunctions::StateMachine","Properties":{}}}}',
            }),
        ).toBe(false);
        expect(isTerraformConfig({ source: 'Resources:\n  M:\n    Type: AWS::StepFunctions::StateMachine\n' })).toBe(
            false,
        );
    });

    it('recognises HCL and .tf.json that start with a byte order mark', () => {
        const bom = String.fromCharCode(0xfeff);
        expect(isTerraformConfig({ source: `${bom}${fixture('multi.tf')}` })).toBe(true);
        expect(isTerraformConfig({ source: `${bom}${fixture('config.tf.json')}` })).toBe(true);
    });

    it('rejects a configuration with no state machine, such as a module-only one', () => {
        expect(isTerraformConfig({ source: fixture('module-only.tf') })).toBe(false);
    });
});
