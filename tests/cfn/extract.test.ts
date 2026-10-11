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

    it('recovers ASL from a CloudFormation YAML !Sub DefinitionString', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: fixture('cfn-template.yaml'),
            format: 'yaml',
        });
        expect(aslDefinition.StartAt).toBe('Go');
    });

    it('recovers ASL from an AWS::Serverless::StateMachine inline Definition', () => {
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            template: {
                Resources: {
                    SM: {
                        Type: 'AWS::Serverless::StateMachine',
                        Properties: {
                            Definition: { StartAt: 'A', States: { A: { Type: 'Pass', End: true } } },
                        },
                    },
                },
            },
        });
        expect(resourceId).toBe('SM');
        expect(aslDefinition.StartAt).toBe('A');
        expect(aslDefinition.States.A.Type).toBe('Pass');
    });

    it('recovers ASL from a SAM YAML template', () => {
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            template: fixture('sam-template.yaml'),
        });
        expect(resourceId).toBe('OrderStateMachine');
        expect(aslDefinition.States.Process.Resource).toBe('<OrderFunction.Arn>');
        expect(aslDefinition.States.Process.Next).toBe('Done');
    });

    it('names the path when a SAM machine uses a local DefinitionUri', () => {
        expect(() =>
            extractAslFromTemplate({ template: fixture('sam-definition-uri.yaml') }),
        ).toThrow(/DefinitionUri.*'statemachine\/order\.asl\.json'/);
    });

    it('diagnoses an S3Location DefinitionUri without stringifying the object', () => {
        const template = {
            Resources: {
                SM: {
                    Type: 'AWS::Serverless::StateMachine',
                    Properties: { DefinitionUri: { Bucket: 'b', Key: 'k' } },
                },
            },
        };
        expect(() => extractAslFromTemplate({ template })).toThrow(/DefinitionUri/);
        expect(() => extractAslFromTemplate({ template })).not.toThrow(/\[object Object\]/);
    });

    it('diagnoses a CloudFormation DefinitionS3Location', () => {
        const template = {
            Resources: {
                M: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: { DefinitionS3Location: { Bucket: 'b', Key: 'k' } },
                },
            },
        };
        expect(() => extractAslFromTemplate({ template })).toThrow(/DefinitionS3Location/);
    });

    it('treats SAM and CloudFormation machines alike when disambiguating', () => {
        const template = {
            Resources: {
                Cfn: {
                    Type: 'AWS::StepFunctions::StateMachine',
                    Properties: {
                        DefinitionString: '{"StartAt":"C","States":{"C":{"Type":"Succeed"}}}',
                    },
                },
                Sam: {
                    Type: 'AWS::Serverless::StateMachine',
                    Properties: {
                        Definition: { StartAt: 'S', States: { S: { Type: 'Succeed' } } },
                    },
                },
            },
        };
        expect(() => extractAslFromTemplate({ template })).toThrow(/Cfn.*Sam|Sam.*Cfn/s);
        expect(extractAslFromTemplate({ template, resourceId: 'Sam' }).aslDefinition.StartAt).toBe(
            'S',
        );
    });

    it('rejects a resourceId that is not a state machine', () => {
        expect(() =>
            extractAslFromTemplate({
                template: fixture('sam-template.yaml'),
                resourceId: 'OrderFunction',
            }),
        ).toThrow(/OrderFunction.*not a state machine/);
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
