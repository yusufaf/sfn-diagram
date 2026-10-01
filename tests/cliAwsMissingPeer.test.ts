import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-sfn', () => {
    throw new Error('Cannot find module');
});

describe('when the optional peer is missing', () => {
    it('names --from-aws for a state machine fetch', async () => {
        const { fetchStateMachineDefinition, parseStateMachineArn } =
            await import('../src/cliAws');

        const arn = parseStateMachineArn({
            value: 'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
        });

        await expect(
            fetchStateMachineDefinition({ arn, flag: '--from-aws' }),
        ).rejects.toThrow(
            /--from-aws requires the optional peer dependency '@aws-sdk\/client-sfn'[\s\S]*npm install @aws-sdk\/client-sfn/,
        );
    });

    it('names --diff when an ARN baseline is what needed it', async () => {
        // One loader serves three flags; telling a --diff user to install something
        // for --from-aws sends them looking at a flag they never typed.
        const { fetchStateMachineDefinition, parseStateMachineArn } =
            await import('../src/cliAws');

        const arn = parseStateMachineArn({
            value: 'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
        });

        await expect(
            fetchStateMachineDefinition({ arn, flag: '--diff' }),
        ).rejects.toThrow(/^--diff requires the optional peer dependency/);
    });

    it('names --execution for a history fetch', async () => {
        const { fetchExecutionHistoryForArn, parseExecutionArn } = await import(
            '../src/cliAws'
        );

        const arn = parseExecutionArn({
            value: 'arn:aws:states:us-east-1:123456789012:execution:Orders:run-1',
        });

        await expect(fetchExecutionHistoryForArn({ arn })).rejects.toThrow(
            /^--execution requires the optional peer dependency/,
        );
    });
});
