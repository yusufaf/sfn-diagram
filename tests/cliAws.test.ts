import { describe, expect, it } from 'vitest';
import {
    CliAwsError,
    isStateMachineArn,
    parseStateMachineArn,
} from '../src/cliAws';

const plainArn =
    'arn:aws:states:us-east-1:123456789012:stateMachine:OrderProcessing';

describe('isStateMachineArn', () => {
    it('recognises a state machine ARN', () => {
        expect(isStateMachineArn(plainArn)).toBe(true);
    });

    it('does not mistake a file path for an ARN', () => {
        expect(isStateMachineArn('machines/order.asl.json')).toBe(false);
        expect(isStateMachineArn('-')).toBe(false);
        expect(isStateMachineArn('C:\\machines\\order.asl.json')).toBe(false);
    });

    it('recognises an ARN it will later reject, so the caller can report it as an ARN', () => {
        // The point of the split: anything starting `arn:` is claimed here and
        // parsed (and possibly rejected) there, rather than being read as a path.
        expect(
            isStateMachineArn('arn:aws:states:us-east-1:123:activity:Foo'),
        ).toBe(true);
    });
});

describe('parseStateMachineArn', () => {
    it('extracts the region and name', () => {
        expect(parseStateMachineArn({ value: plainArn })).toEqual({
            arn: plainArn,
            name: 'OrderProcessing',
            qualifier: null,
            region: 'us-east-1',
        });
    });

    it('accepts a non-standard partition', () => {
        const govArn =
            'arn:aws-us-gov:states:us-gov-west-1:123456789012:stateMachine:Orders';
        expect(parseStateMachineArn({ value: govArn })).toMatchObject({
            name: 'Orders',
            region: 'us-gov-west-1',
        });
    });

    it('accepts a version qualifier, because DescribeStateMachine does', () => {
        expect(parseStateMachineArn({ value: `${plainArn}:3` })).toMatchObject({
            name: 'OrderProcessing',
            qualifier: '3',
        });
    });

    it('accepts an alias qualifier', () => {
        expect(
            parseStateMachineArn({ value: `${plainArn}:PROD` }),
        ).toMatchObject({ name: 'OrderProcessing', qualifier: 'PROD' });
    });

    it('rejects a bare state machine name', () => {
        expect(() =>
            parseStateMachineArn({ value: 'OrderProcessing' }),
        ).toThrow(CliAwsError);
        expect(() =>
            parseStateMachineArn({ value: 'OrderProcessing' }),
        ).toThrow(/expects a state machine ARN/);
    });

    it('names the ARN shape it wanted', () => {
        expect(() =>
            parseStateMachineArn({ value: 'OrderProcessing' }),
        ).toThrow(/arn:aws:states:<region>:<account>:stateMachine:<name>/);
    });

    it('rejects an empty region rather than building a client with region ""', () => {
        expect(() =>
            parseStateMachineArn({
                value: 'arn:aws:states::123456789012:stateMachine:Orders',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects a resource type that is not stateMachine', () => {
        expect(() =>
            parseStateMachineArn({
                value: 'arn:aws:states:us-east-1:123456789012:activity:Orders',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects a non-states service', () => {
        expect(() =>
            parseStateMachineArn({
                value: 'arn:aws:lambda:us-east-1:123456789012:function:Orders',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects an empty state machine name', () => {
        expect(() =>
            parseStateMachineArn({
                value: 'arn:aws:states:us-east-1:123456789012:stateMachine:',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects more segments than a qualified ARN can have', () => {
        expect(() =>
            parseStateMachineArn({ value: `${plainArn}:PROD:extra` }),
        ).toThrow(CliAwsError);
    });

    it('rejects an empty partition', () => {
        expect(() =>
            parseStateMachineArn({
                value: 'arn::states:us-east-1:123456789012:stateMachine:Orders',
            }),
        ).toThrow(CliAwsError);
    });

    it('echoes the value it was given, so the message is actionable', () => {
        expect(() => parseStateMachineArn({ value: 'Orders' })).toThrow(
            /"Orders"/,
        );
    });
});
