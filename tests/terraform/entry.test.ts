import { describe, it, expect } from 'vitest';
import { extractAslFromTerraform } from '../../src/terraform';

describe('sfn-diagram/terraform entry', () => {
    it('re-exports extractAslFromTerraform', () => {
        const { aslDefinition } = extractAslFromTerraform({
            config: 'resource "aws_sfn_state_machine" "m" {\n  definition = jsonencode({ StartAt = "A", States = { A = { Type = "Succeed" } } })\n}\n',
        });
        expect(aslDefinition.StartAt).toBe('A');
    });
});
