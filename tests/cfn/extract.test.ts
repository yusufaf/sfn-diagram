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

describe('DefinitionSubstitutions', () => {
    const fnArn = 'arn:aws:lambda:us-east-1:1:function:f';
    const taskDefinition = (resource: string): string =>
        JSON.stringify({
            StartAt: 'A',
            States: { A: { Type: 'Task', Resource: resource, End: true } },
        });

    interface MachineParams {
        definition?: unknown;
        definitionString?: unknown;
        substitutions?: unknown;
        type?: string;
    }

    function machine(params: MachineParams): { Resources: Record<string, unknown> } {
        const {
            definition,
            definitionString,
            substitutions,
            type = 'AWS::StepFunctions::StateMachine',
        } = params;
        return {
            Resources: {
                SM: {
                    Type: type,
                    Properties: {
                        ...(definitionString !== undefined && { DefinitionString: definitionString }),
                        ...(definition !== undefined && { Definition: definition }),
                        ...(substitutions !== undefined && { DefinitionSubstitutions: substitutions }),
                    },
                },
            },
        };
    }

    const waitDefinition =
        '{"StartAt":"W","States":{"W":{"Type":"Wait","Seconds":${WaitSeconds},"End":true}}}';

    it('applies them to a plain-string DefinitionString', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition('${FnArn}'),
                substitutions: { FnArn: fnArn },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe(fnArn);
    });

    it('applies them to an object Definition', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definition: JSON.parse(taskDefinition('${FnArn}')),
                substitutions: { FnArn: fnArn },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe(fnArn);
    });

    it('applies them to a SAM Definition', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definition: JSON.parse(taskDefinition('${FnArn}')),
                substitutions: { FnArn: fnArn },
                type: 'AWS::Serverless::StateMachine',
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe(fnArn);
    });

    it('applies them to nested strings and state names', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definition: {
                    StartAt: '${Prefix}A',
                    States: {
                        '${Prefix}A': {
                            Type: 'Parallel',
                            End: true,
                            Branches: [
                                {
                                    StartAt: 'Inner',
                                    States: {
                                        Inner: {
                                            Type: 'Task',
                                            Resource: 'arn:aws:states:::lambda:invoke',
                                            Parameters: { FunctionName: '${FnArn}' },
                                            End: true,
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
                substitutions: { FnArn: fnArn, Prefix: 'dev' },
            }),
        });
        expect(aslDefinition.StartAt).toBe('devA');
        expect(aslDefinition.States.devA).toBeDefined();
        expect(aslDefinition.States.devA.Branches?.[0].States.Inner.Parameters).toEqual({
            FunctionName: fnArn,
        });
    });

    // Guard: already green on base (base never substitutes a plain string). Its red is
    // shown by reverting `Object.hasOwn` to `in`, which resolves `${constructor}`.
    it('leaves unknown names, pseudo-params and prototype names literal', () => {
        const resource = '${Missing}:${AWS::Region}:${constructor}';
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition(resource),
                substitutions: { FnArn: 'x' },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe(resource);
    });

    it('substitutes unquoted placeholders in a plain-string DefinitionString', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: waitDefinition,
                substitutions: { WaitSeconds: '5' },
            }),
        });
        expect(aslDefinition.States.W.Seconds).toBe(5);
    });

    // Guard: green on base through Fn::Sub. Substituting after JSON.parse breaks it.
    it('substitutes unquoted placeholders in a Fn::Sub DefinitionString', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: { 'Fn::Sub': waitDefinition },
                substitutions: { WaitSeconds: '5' },
            }),
        });
        expect(aslDefinition.States.W.Seconds).toBe(5);
    });

    it('resolves intrinsic values to placeholders', () => {
        const { aslDefinition, warnings } = extractAslFromTemplate({
            template: machine({
                definitionString: JSON.stringify({
                    StartAt: 'A',
                    States: {
                        A: { Type: 'Task', Resource: '${A}', Next: 'B' },
                        B: { Type: 'Task', Resource: '${B}', Next: 'C' },
                        C: { Type: 'Task', Resource: '${C}', End: true },
                    },
                }),
                substitutions: {
                    A: { 'Fn::GetAtt': ['Fn', 'Arn'] },
                    B: { Ref: 'Fn' },
                    C: { 'Fn::Sub': 'arn:${AWS::Partition}:lambda:x' },
                },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('<Fn.Arn>');
        expect(aslDefinition.States.B.Resource).toBe('<Ref:Fn>');
        expect(aslDefinition.States.C.Resource).toBe('arn:${AWS::Partition}:lambda:x');
        expect(warnings).toEqual([]);
    });

    it('resolves intrinsic values used through Fn::Sub', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: { 'Fn::Sub': taskDefinition('${FnArn}') },
                substitutions: { FnArn: { 'Fn::GetAtt': ['Fn', 'Arn'] } },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('<Fn.Arn>');
    });

    it('applies them to a Fn::Join DefinitionString', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: { 'Fn::Join': ['', [taskDefinition('${FnArn}')]] },
                substitutions: { FnArn: { 'Fn::GetAtt': ['Fn', 'Arn'] } },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('<Fn.Arn>');
    });

    it('resolves YAML short-form intrinsic values', () => {
        const template = [
            'Resources:',
            '  SM:',
            '    Type: AWS::StepFunctions::StateMachine',
            '    Properties:',
            '      DefinitionString: |',
            `        ${taskDefinition('${FnArn}')}`,
            '      DefinitionSubstitutions:',
            '        FnArn: !GetAtt Fn.Arn',
            '',
        ].join('\n');
        const { aslDefinition } = extractAslFromTemplate({ format: 'yaml', template });
        expect(aslDefinition.States.A.Resource).toBe('<Fn.Arn>');
    });

    it('stubs an unsupported intrinsic value and warns', () => {
        const { aslDefinition, warnings } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition('${FnArn}'),
                substitutions: { FnArn: { 'Fn::FindInMap': ['m', 'k', 'v'] } },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('<Fn::FindInMap>');
        expect(warnings).toEqual([expect.stringMatching(/Fn::FindInMap/)]);
    });

    it('stubs a non-intrinsic object value and warns', () => {
        const { aslDefinition, warnings } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition('${FnArn}'),
                substitutions: { FnArn: { a: 1, b: 2 } },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('<FnArn>');
        expect(warnings).toEqual([expect.stringMatching(/FnArn/)]);
    });

    it('stringifies number values', () => {
        const { aslDefinition, warnings } = extractAslFromTemplate({
            template: machine({
                definitionString: JSON.stringify({
                    Comment: '${Timeout}',
                    StartAt: 'P',
                    States: { P: { Type: 'Pass', End: true } },
                }),
                substitutions: { Timeout: 30 },
            }),
        });
        expect(aslDefinition.Comment).toBe('30');
        expect(warnings).toEqual([]);
    });

    it('ignores a DefinitionSubstitutions that is not a map, with a warning', () => {
        const { aslDefinition, warnings } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition('${FnArn}'),
                substitutions: 'oops',
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('${FnArn}');
        expect(warnings).toEqual([expect.stringMatching(/not a key-value map/)]);
    });

    it('substitutes in a single pass, plain string', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: taskDefinition('${A}'),
                substitutions: { A: '${B}', B: 'x' },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('${B}');
    });

    // Guard: green on base. Its red is shown by passing substitutions to
    // resolveIntrinsics again while keeping the post-pass (double expansion).
    it('substitutes in a single pass, Fn::Sub', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: { 'Fn::Sub': taskDefinition('${A}') },
                substitutions: { A: '${B}', B: 'x' },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe('${B}');
    });
});
