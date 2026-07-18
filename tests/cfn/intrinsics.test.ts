import { describe, it, expect } from 'vitest';
import { resolveIntrinsics } from '../../src/cfn/intrinsics';

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
