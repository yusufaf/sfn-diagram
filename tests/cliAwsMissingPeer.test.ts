import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-sfn', () => {
    throw new Error('Cannot find module');
});

describe('fetchStateMachineDefinition when the optional peer is missing', () => {
    it('rejects with an actionable, install-command-bearing message', async () => {
        const { fetchStateMachineDefinition, parseStateMachineArn } =
            await import('../src/cliAws');

        const arn = parseStateMachineArn({
            value: 'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
        });

        await expect(fetchStateMachineDefinition({ arn })).rejects.toThrow(
            /--from-aws requires the optional peer dependency '@aws-sdk\/client-sfn'[\s\S]*npm install @aws-sdk\/client-sfn/,
        );
    });
});
