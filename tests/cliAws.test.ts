import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CliAwsError,
    fetchStateMachineDefinition,
    isStateMachineArn,
    parseStateMachineArn,
} from '../src/cliAws';

const plainArn =
    'arn:aws:states:us-east-1:123456789012:stateMachine:OrderProcessing';

const { clientConfigs, describeInputs, sendMock } = vi.hoisted(() => ({
    clientConfigs: [] as unknown[],
    describeInputs: [] as unknown[],
    sendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-sfn', () => ({
    DescribeStateMachineCommand: class {
        constructor(input: unknown) {
            describeInputs.push(input);
        }
    },
    SFNClient: class {
        send = sendMock;
        constructor(config: unknown) {
            clientConfigs.push(config);
        }
    },
}));

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

describe('fetchStateMachineDefinition', () => {
    const arn = parseStateMachineArn({ value: plainArn });

    beforeEach(() => {
        sendMock.mockReset();
        clientConfigs.length = 0;
        describeInputs.length = 0;
    });

    it('returns the definition string verbatim', async () => {
        const definition =
            '{"StartAt":"A","States":{"A":{"Type":"Pass","End":true}}}';
        sendMock.mockResolvedValue({ definition, name: 'OrderProcessing' });

        await expect(fetchStateMachineDefinition({ arn })).resolves.toBe(
            definition,
        );
    });

    it('constructs the client for the ARN region', async () => {
        sendMock.mockResolvedValue({ definition: '{}' });
        await fetchStateMachineDefinition({ arn });
        expect(clientConfigs).toEqual([{ region: 'us-east-1' }]);
    });

    it('asks for the full ARN, qualifier included', async () => {
        sendMock.mockResolvedValue({ definition: '{}' });
        const versioned = parseStateMachineArn({ value: `${plainArn}:3` });
        await fetchStateMachineDefinition({ arn: versioned });
        expect(describeInputs).toEqual([
            { stateMachineArn: `${plainArn}:3` },
        ]);
    });

    it('rejects when a successful call carries no definition', async () => {
        // DescribeStateMachineOutput.definition is `string | undefined`.
        sendMock.mockResolvedValue({ name: 'OrderProcessing' });
        await expect(fetchStateMachineDefinition({ arn })).rejects.toThrow(
            /returned no definition/,
        );
    });

    it('names the ARN in an API failure', async () => {
        sendMock.mockRejectedValue(
            Object.assign(new Error('State Machine Does Not Exist'), {
                name: 'StateMachineDoesNotExist',
            }),
        );

        await expect(fetchStateMachineDefinition({ arn })).rejects.toThrow(
            plainArn,
        );
    });

    it('does not add a credentials hint to a not-found failure', async () => {
        sendMock.mockRejectedValue(
            Object.assign(new Error('State Machine Does Not Exist'), {
                name: 'StateMachineDoesNotExist',
            }),
        );
        await expect(
            fetchStateMachineDefinition({ arn }),
        ).rejects.not.toThrow(/aws configure/);
    });

    it('appends an AWS_PROFILE pointer to a credentials failure', async () => {
        sendMock.mockRejectedValue(
            Object.assign(
                new Error('Could not load credentials from any providers'),
                { name: 'CredentialsProviderError' },
            ),
        );
        await expect(fetchStateMachineDefinition({ arn })).rejects.toThrow(
            /AWS_PROFILE[\s\S]*aws configure/,
        );
    });

    it('appends the pointer when only the message identifies the failure', async () => {
        // Some credential providers throw a plain Error with no distinctive name.
        sendMock.mockRejectedValue(
            new Error('Could not load credentials from any providers'),
        );
        await expect(fetchStateMachineDefinition({ arn })).rejects.toThrow(
            /aws configure/,
        );
    });

    it('throws CliAwsError, so the CLI can map it to one exit code', async () => {
        sendMock.mockRejectedValue(new Error('Throttling'));
        await expect(
            fetchStateMachineDefinition({ arn }),
        ).rejects.toBeInstanceOf(CliAwsError);
    });
});
