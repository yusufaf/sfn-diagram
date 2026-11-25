import { describe, it, expect, vi } from 'vitest';
import { parseTemplate } from '../../src/cfn/templateParser';

describe('parseTemplate', () => {
    it('parses JSON templates', () => {
        const result = parseTemplate({ template: '{"Resources":{"A":{"Type":"X"}}}' });
        expect(result).toEqual({ Resources: { A: { Type: 'X' } } });
    });

    it('ignores a leading byte order mark', () => {
        const json = '\uFEFF{"Resources":{"A":{"Type":"X"}}}';
        expect(parseTemplate({ template: json })).toEqual({ Resources: { A: { Type: 'X' } } });
        expect(parseTemplate({ template: json, format: 'json' })).toEqual({ Resources: { A: { Type: 'X' } } });
    });

    it('passes through an already-parsed object', () => {
        const obj = { Resources: {} };
        expect(parseTemplate({ template: obj })).toBe(obj);
    });

    it('parses YAML and normalizes CFN short-form intrinsics to long form', () => {
        const yaml = [
            'Resources:',
            '  Machine:',
            '    Type: AWS::StepFunctions::StateMachine',
            '    Properties:',
            '      RoleArn: !GetAtt Role.Arn',
            "      DefinitionString: !Sub 'arn:${AWS::Partition}:x'",
            '      Tags:',
            '        - !Ref SomeParam',
        ].join('\n');
        const result = parseTemplate({ template: yaml, format: 'yaml' }) as Record<
            string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            any
        >;
        const props = result.Resources.Machine.Properties;
        expect(props.RoleArn).toEqual({ 'Fn::GetAtt': ['Role', 'Arn'] });
        expect(props.DefinitionString).toEqual({ 'Fn::Sub': 'arn:${AWS::Partition}:x' });
        expect(props.Tags[0]).toEqual({ Ref: 'SomeParam' });
    });

    it('auto-detects JSON vs YAML', () => {
        expect(parseTemplate({ template: '{"a":1}', format: 'auto' })).toEqual({ a: 1 });
        expect(parseTemplate({ template: 'a: 1', format: 'auto' })).toEqual({ a: 1 });
    });

    it('parses YAML without printing warnings when quiet', () => {
        const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(parseTemplate({ quiet: true, template: 'a: !Foo b' })).toEqual({ a: 'b' });
            expect(emitWarning).not.toHaveBeenCalled();
            expect(consoleWarn).not.toHaveBeenCalled();
        } finally {
            emitWarning.mockRestore();
            consoleWarn.mockRestore();
        }
    });

    it('still throws a YAML parse error when quiet', () => {
        expect(() => parseTemplate({ quiet: true, template: 'a: 1\na: 2' })).toThrow();
    });
});
