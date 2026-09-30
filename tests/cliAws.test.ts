import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CliAwsError,
    fetchExecutionHistoryForArn,
    fetchStateMachineDefinition,
    isStateMachineArn,
    parseExecutionArn,
    parseStateMachineArn,
} from '../src/cliAws';

const plainArn =
    'arn:aws:states:us-east-1:123456789012:stateMachine:OrderProcessing';

const { clientConfigs, describeInputs, historyInputs, sendMock } = vi.hoisted(
    () => ({
        clientConfigs: [] as unknown[],
        describeInputs: [] as unknown[],
        historyInputs: [] as unknown[],
        sendMock: vi.fn(),
    }),
);

vi.mock('@aws-sdk/client-sfn', () => ({
    DescribeStateMachineCommand: class {
        constructor(input: unknown) {
            describeInputs.push(input);
        }
    },
    GetExecutionHistoryCommand: class {
        constructor(input: unknown) {
            historyInputs.push(input);
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
            outputName: 'OrderProcessing',
            qualifier: null,
            region: 'us-east-1',
        });
    });

    it('folds a qualifier into the output name, so two versions do not collide', () => {
        // Comparing a machine against its own alias is exactly what version/alias
        // support is for, and under --out-dir both would otherwise want Orders.svg.
        expect(
            parseStateMachineArn({ value: `${plainArn}:PROD` }).outputName,
        ).toBe('OrderProcessing-PROD');
        expect(
            parseStateMachineArn({ value: `${plainArn}:3` }).outputName,
        ).toBe('OrderProcessing-3');
    });

    it('rejects a trailing colon rather than reading it as an empty qualifier', () => {
        expect(() =>
            parseStateMachineArn({ value: `${plainArn}:` }),
        ).toThrow(CliAwsError);
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

    it('names the flag that supplied the value, not always --from-aws', () => {
        // --diff accepts an ARN too; telling its user about --from-aws sends them
        // to the wrong flag.
        expect(() =>
            parseStateMachineArn({ flag: '--diff', value: 'Orders' }),
        ).toThrow(/--diff expects a state machine ARN/);
    });

    it('defaults to naming --from-aws', () => {
        expect(() => parseStateMachineArn({ value: 'Orders' })).toThrow(
            /--from-aws expects a state machine ARN/,
        );
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

const executionArn =
    'arn:aws:states:us-east-1:123456789012:execution:OrderProcessing:run-1';

describe('parseExecutionArn', () => {
    it('extracts the region, state machine name and execution name', () => {
        expect(parseExecutionArn({ value: executionArn })).toEqual({
            arn: executionArn,
            executionName: 'run-1',
            outputName: 'OrderProcessing-run-1',
            region: 'us-east-1',
            stateMachineName: 'OrderProcessing',
        });
    });

    it('accepts a non-standard partition', () => {
        expect(
            parseExecutionArn({
                value: 'arn:aws-cn:states:cn-north-1:1:execution:M:r',
            }),
        ).toMatchObject({ region: 'cn-north-1', stateMachineName: 'M' });
    });

    it('rejects a state machine ARN, naming the execution shape', () => {
        expect(() =>
            parseExecutionArn({
                value:
                    'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
            }),
        ).toThrow(/execution:<state-machine>:<execution>/);
    });

    it('rejects an express execution ARN, which has no retrievable history', () => {
        // GetExecutionHistory does not serve Express workflows at all, so accepting
        // the ARN would only move the failure to the API call.
        expect(() =>
            parseExecutionArn({
                value: 'arn:aws:states:us-east-1:1:express:M:r:shard',
            }),
        ).toThrow(/Express/);
    });

    it('rejects an empty execution name', () => {
        expect(() =>
            parseExecutionArn({
                value: 'arn:aws:states:us-east-1:1:execution:M:',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects an empty state machine name', () => {
        expect(() =>
            parseExecutionArn({
                value: 'arn:aws:states:us-east-1:1:execution::r',
            }),
        ).toThrow(CliAwsError);
    });

    it('rejects too few segments', () => {
        expect(() =>
            parseExecutionArn({ value: 'arn:aws:states:us-east-1:1:execution' }),
        ).toThrow(CliAwsError);
    });

    it('names the flag that supplied the value', () => {
        expect(() =>
            parseExecutionArn({ flag: '--execution', value: 'run-1' }),
        ).toThrow(/^--execution expects an execution ARN/);
    });
});

describe('fetchExecutionHistoryForArn', () => {
    const arn = parseExecutionArn({ value: executionArn });

    beforeEach(() => {
        sendMock.mockReset();
        clientConfigs.length = 0;
        historyInputs.length = 0;
    });

    it('returns every event, following nextToken', async () => {
        sendMock
            .mockResolvedValueOnce({
                events: [{ id: 1 }, { id: 2 }],
                nextToken: 'more',
            })
            .mockResolvedValueOnce({ events: [{ id: 3 }] });

        await expect(fetchExecutionHistoryForArn({ arn })).resolves.toEqual([
            { id: 1 },
            { id: 2 },
            { id: 3 },
        ]);
    });

    it('constructs the client for the ARN region', async () => {
        sendMock.mockResolvedValue({ events: [] });
        await fetchExecutionHistoryForArn({ arn });
        expect(clientConfigs).toEqual([{ region: 'us-east-1' }]);
    });

    it('asks for the execution it was given', async () => {
        sendMock.mockResolvedValue({ events: [] });
        await fetchExecutionHistoryForArn({ arn });
        expect(historyInputs[0]).toMatchObject({
            executionArn,
        });
    });

    it('wraps an API failure in a CliAwsError naming the ARN', async () => {
        sendMock.mockRejectedValue(
            Object.assign(new Error('Execution Does Not Exist'), {
                name: 'ExecutionDoesNotExist',
            }),
        );
        await expect(
            fetchExecutionHistoryForArn({ arn }),
        ).rejects.toBeInstanceOf(CliAwsError);
        await expect(fetchExecutionHistoryForArn({ arn })).rejects.toThrow(
            executionArn,
        );
    });

    it('appends the credentials pointer to a credentials failure', async () => {
        sendMock.mockRejectedValue(
            new Error('Could not load credentials from any providers'),
        );
        await expect(fetchExecutionHistoryForArn({ arn })).rejects.toThrow(
            /aws configure/,
        );
    });
});
