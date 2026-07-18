import { describe, it, expect } from 'vitest';
import { extractAslFromTemplate } from '../../src/cfn';

describe('sfn-diagram/cfn entry', () => {
    it('re-exports extractAslFromTemplate', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template:
                '{"Resources":{"M":{"Type":"AWS::StepFunctions::StateMachine","Properties":{"DefinitionString":"{\\"StartAt\\":\\"A\\",\\"States\\":{\\"A\\":{\\"Type\\":\\"Succeed\\"}}}"}}}}',
        });
        expect(aslDefinition.StartAt).toBe('A');
    });
});
