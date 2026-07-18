import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractAslFromTemplate } from '../../src/cfn/extract';

const currentDir = dirname(fileURLToPath(import.meta.url));

const fixture = (name: string): string =>
    readFileSync(join(currentDir, '..', 'fixtures', 'cfn', name), 'utf-8');

describe('extractAslFromTemplate', () => {
    it('recovers ASL from a cdk-synth Fn::Join DefinitionString', () => {
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            template: fixture('cdk-synth.json'),
        });
        expect(resourceId).toBe('InspectorMachine');
        expect(aslDefinition.StartAt).toBe('Run');
        expect(aslDefinition.States.Run.Resource).toBe(
            'arn:${AWS::Partition}:states:::lambda:invoke',
        );
        expect(aslDefinition.States.Run.Next).toBe('Done');
    });

    it('recovers ASL from a SAM YAML !Sub definition', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: fixture('sam-template.yaml'),
            format: 'yaml',
        });
        expect(aslDefinition.StartAt).toBe('Go');
    });

    it('applies DefinitionSubstitutions', () => {
        const { aslDefinition } = extractAslFromTemplate({ template: fixture('substitutions.json') });
        expect(aslDefinition.States.Call.Resource).toBe('<Ref:MyLambda>');
    });

    it('throws listing ids when multiple machines and none selected', () => {
        expect(() => extractAslFromTemplate({ template: fixture('multi-statemachine.json') })).toThrow(
            /First.*Second|Second.*First/s,
        );
    });

    it('selects a specific machine by resourceId', () => {
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            template: fixture('multi-statemachine.json'),
            resourceId: 'Second',
        });
        expect(resourceId).toBe('Second');
        expect(aslDefinition.StartAt).toBe('B');
    });

    it('throws when no state machine exists', () => {
        expect(() => extractAslFromTemplate({ template: '{"Resources":{}}' })).toThrow(
            /no .*StateMachine/i,
        );
    });

    it('throws an actionable error for external DefinitionUri', () => {
        const template =
            '{"Resources":{"M":{"Type":"AWS::StepFunctions::StateMachine","Properties":{"DefinitionUri":"s3://x"}}}}';
        expect(() => extractAslFromTemplate({ template })).toThrow(/DefinitionUri/);
    });
});
