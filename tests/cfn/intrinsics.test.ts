import { describe, it, expect } from 'vitest';
import { applySubstitutions, resolveIntrinsics, resolveSubstitutions } from '../../src/cfn/intrinsics';

describe('Fn::Sub substitution name bound', () => {
    // js/polynomial-redos. The pattern was `[^}]+`, unanchored on the right, so on a
    // template of repeated `${` with no closing brace the engine rescanned to
    // end-of-string from every one of them - quadratic in a template the CLI, the
    // library and the GitHub Action all accept from the user. The name is now bounded
    // to 255, which is above any legitimate CloudFormation logical ID.
    //
    // This half asserts the bound deterministically; the timing shape lives in
    // tests/performance/scaling.test.ts, where the repo keeps its ratio checks.
    it('resolves a name at the 255-character bound', () => {
        const name = 'A'.repeat(255);
        const { value } = resolveIntrinsics({
            substitutions: { [name]: 'resolved' },
            value: { 'Fn::Sub': '${' + name + '}' },
        });
        expect(value).toBe('resolved');
    });

    it('leaves a longer name untouched rather than scanning past it', () => {
        const name = 'A'.repeat(256);
        const { value } = resolveIntrinsics({
            substitutions: { [name]: 'resolved' },
            value: { 'Fn::Sub': '${' + name + '}' },
        });
        expect(value).toBe('${' + name + '}');
    });

    it('still resolves an ordinary name and keeps pseudo-params', () => {
        const { value } = resolveIntrinsics({
            substitutions: { Topic: 'arn:aws:sns:::alerts' },
            value: { 'Fn::Sub': '${Topic} in ${AWS::Region}' },
        });
        expect(value).toBe('arn:aws:sns:::alerts in ${AWS::Region}');
    });
});

describe('resolveIntrinsics', () => {
    it('keeps pseudo-parameter Refs as ${AWS::X}', () => {
        const { value } = resolveIntrinsics({ value: { Ref: 'AWS::Partition' } });
        expect(value).toBe('${AWS::Partition}');
    });

    it('renders a logical-id Ref as <Ref:Id>', () => {
        const { value } = resolveIntrinsics({ value: { Ref: 'MyLambda' } });
        expect(value).toBe('<Ref:MyLambda>');
    });

    it('renders Fn::GetAtt as <Res.Attr>', () => {
        const { value } = resolveIntrinsics({ value: { 'Fn::GetAtt': ['Fn', 'Arn'] } });
        expect(value).toBe('<Fn.Arn>');
    });

    it('concatenates Fn::Join parts, resolving each', () => {
        const { value } = resolveIntrinsics({
            value: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':x']] },
        });
        expect(value).toBe('arn:${AWS::Partition}:x');
    });

    it('substitutes Fn::Sub variables from the substitutions map', () => {
        const { value } = resolveIntrinsics({
            substitutions: { LambdaArn: 'placeholder-arn' },
            value: { 'Fn::Sub': 'call ${LambdaArn} now' },
        });
        expect(value).toBe('call placeholder-arn now');
    });

    it('leaves pseudo-params in Fn::Sub untouched', () => {
        const { value } = resolveIntrinsics({ value: { 'Fn::Sub': 'a-${AWS::Region}-b' } });
        expect(value).toBe('a-${AWS::Region}-b');
    });

    it('renders an escaped ${!Literal} in Fn::Sub as ${Literal}', () => {
        const { value } = resolveIntrinsics({ value: { 'Fn::Sub': 'a ${!Literal} b' } });
        expect(value).toBe('a ${Literal} b');
    });

    it('replaces unknown intrinsics with a placeholder and warns', () => {
        const { value, warnings } = resolveIntrinsics({
            value: { 'Fn::FindInMap': ['a', 'b', 'c'] },
        });
        expect(value).toBe('<Fn::FindInMap>');
        expect(warnings.length).toBe(1);
    });

    it('recurses through arrays and objects', () => {
        const { value } = resolveIntrinsics({
            value: { StartAt: 'A', States: { A: { Resource: { Ref: 'AWS::Partition' } } } },
        });
        expect(value).toEqual({ StartAt: 'A', States: { A: { Resource: '${AWS::Partition}' } } });
    });
});

describe('applySubstitutions', () => {
    it('returns the same reference when the map is empty', () => {
        const value = { Resource: '${FnArn}' };
        expect(applySubstitutions({ substitutions: {}, value })).toBe(value);
    });

    it('substitutes keys and values in nested arrays and objects', () => {
        const result = applySubstitutions({
            substitutions: { Name: 'dev', Arn: 'arn:f' },
            value: { '${Name}A': [{ Resource: '${Arn}', Retry: 3, Skip: null }, '${Name}'] },
        });
        expect(result).toEqual({ devA: [{ Resource: 'arn:f', Retry: 3, Skip: null }, 'dev'] });
    });

    it('substitutes a string as raw text', () => {
        const result = applySubstitutions({
            substitutions: { Seconds: '5' },
            value: '{"Seconds":${Seconds}}',
        });
        expect(result).toBe('{"Seconds":5}');
    });

    it('does not apply the Fn::Sub ${!x} unescape', () => {
        const result = applySubstitutions({
            substitutions: { x: 'y' },
            value: '${!x} ${AWS::Region} ${constructor}',
        });
        expect(result).toBe('${!x} ${AWS::Region} ${constructor}');
    });
});

describe('resolveSubstitutions', () => {
    it('returns an empty map with no warnings when the property is absent', () => {
        expect(resolveSubstitutions({ value: undefined })).toEqual({ substitutions: {}, warnings: [] });
    });

    it('flattens strings, scalars and intrinsics, warning only for what it cannot resolve', () => {
        const { substitutions, warnings } = resolveSubstitutions({
            value: {
                Arn: { 'Fn::GetAtt': ['Fn', 'Arn'] },
                Count: 3,
                Flag: true,
                Odd: { a: 1, b: 2 },
                Plain: 'text',
                Ref: { Ref: 'Fn' },
                Unknown: { 'Fn::FindInMap': ['m', 'k', 'v'] },
            },
        });
        expect(substitutions).toEqual({
            Arn: '<Fn.Arn>',
            Count: '3',
            Flag: 'true',
            Odd: '<Odd>',
            Plain: 'text',
            Ref: '<Ref:Fn>',
            Unknown: '<Fn::FindInMap>',
        });
        expect(warnings).toHaveLength(2);
    });

    it.each([null, 'oops', ['a'], 7])('ignores %j with a warning', (value) => {
        expect(resolveSubstitutions({ value })).toEqual({
            substitutions: {},
            warnings: ['DefinitionSubstitutions is not a key-value map; ignored'],
        });
    });
});
