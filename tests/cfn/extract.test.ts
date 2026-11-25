import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    extractAslFromTemplate,
    isStateMachineTemplate,
    listStateMachines,
} from '../../src/cfn/extract';
import type { ReadFileParams } from '../../src/types';

const currentDir = dirname(fileURLToPath(import.meta.url));

const fixture = (name: string): string =>
    readFileSync(join(currentDir, '..', 'fixtures', 'cfn', name), 'utf-8');

const thrownMessage = (action: () => unknown): string => {
    try {
        action();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected the call to throw');
};

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

    // A name that exists on Object.prototype must not resolve through the prototype chain.
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

    // Substitution must run before JSON.parse, or an unquoted placeholder is a syntax error.
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

    it('applies them after Fn::Sub unescapes ${!Name}', () => {
        const { aslDefinition } = extractAslFromTemplate({
            template: machine({
                definitionString: { 'Fn::Sub': taskDefinition('${!FnArn}') },
                substitutions: { FnArn: fnArn },
            }),
        });
        expect(aslDefinition.States.A.Resource).toBe(fnArn);
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

    // A substituted value is not rescanned, so Fn::Sub output is not expanded twice.
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

// The cdk-orders-* fixtures are real `cdk synth` output (aws-cdk-lib 2.274.0). OrdersStack holds
// `OrderWorkflow` (StartAt P1), `Orders/Workflow` (P2) and an L1 `Orders/Raw` (A); the stage puts
// the same stack under `Prod/`; the nested stack holds `NestedWorkflow` (P3); from-stack is the
// same stack synthesized by a plain `new App()`, so it has no `aws:cdk:path` metadata.
describe('CDK construct paths', () => {
    const extract = (
        name: string,
        resourceId?: string,
    ): { resourceId: string; startAt: string } => {
        const result = extractAslFromTemplate({ resourceId, template: fixture(name) });
        return { resourceId: result.resourceId, startAt: result.aslDefinition.StartAt };
    };

    it.each([
        ['OrderWorkflow', 'OrderWorkflow0015CDD9', 'P1'],
        ['OrdersStack/OrderWorkflow', 'OrderWorkflow0015CDD9', 'P1'],
        ['OrdersStack/OrderWorkflow/Resource', 'OrderWorkflow0015CDD9', 'P1'],
        ['Orders/Workflow', 'OrdersWorkflow5B5F4FE8', 'P2'],
        ['Orders/Raw', 'OrdersRawA5B3A6B2', 'A'],
    ])('selects %s from a cdk synth template', (resourceId, logicalId, startAt) => {
        expect(extract('cdk-orders-stack.json', resourceId)).toEqual({
            resourceId: logicalId,
            startAt,
        });
    });

    it.each(['Prod/OrdersStack/OrderWorkflow', 'OrderWorkflow'])(
        'selects %s from a stack inside a Stage',
        (resourceId) => {
            expect(extract('cdk-orders-stage.json', resourceId).resourceId).toBe(
                'OrderWorkflow0015CDD9',
            );
        },
    );

    it.each(['NestedWorkflow', 'Nested/NestedWorkflow'])(
        'selects %s from a nested stack template',
        (resourceId) => {
            expect(extract('cdk-orders-nested.json', resourceId)).toEqual({
                resourceId: 'NestedWorkflowF6BC47A2',
                startAt: 'P3',
            });
        },
    );

    it('selects a stack-relative path from a template without metadata', () => {
        expect(extract('cdk-orders-from-stack.json', 'OrderWorkflow')).toEqual({
            resourceId: 'OrderWorkflow0015CDD9',
            startAt: 'P1',
        });
    });

    it('lists construct paths next to logical IDs when nothing matches', () => {
        expect(() => extract('cdk-orders-stack.json', 'Nope')).toThrow(
            "Resource 'Nope' is not a state machine (AWS::StepFunctions::StateMachine or " +
                'AWS::Serverless::StateMachine). Found: OrderWorkflow0015CDD9 (OrdersStack/OrderWorkflow), ' +
                'OrdersWorkflow5B5F4FE8 (OrdersStack/Orders/Workflow), OrdersRawA5B3A6B2 (OrdersStack/Orders/Raw).',
        );
    });

    it('lists bare logical IDs when the template has no metadata', () => {
        expect(() => extract('cdk-orders-from-stack.json', 'Nope')).toThrow(
            'Found: OrderWorkflow0015CDD9, OrdersWorkflow5B5F4FE8, OrdersRawA5B3A6B2.',
        );
    });

    it('lists construct paths when several machines and none selected', () => {
        expect(() => extract('cdk-orders-stack.json')).toThrow(
            'Template has multiple state machines: OrderWorkflow0015CDD9 (OrdersStack/OrderWorkflow), ' +
                'OrdersWorkflow5B5F4FE8 (OrdersStack/Orders/Workflow), OrdersRawA5B3A6B2 ' +
                '(OrdersStack/Orders/Raw). Pass resourceId (or --resource) to choose one.',
        );
    });

    it('rejects a construct path that leads to a resource other than a state machine', () => {
        // OrderWorkflow/Role computes the role's logical ID, OrderWorkflowRole8C450098.
        expect(() => extract('cdk-orders-stack.json', 'OrderWorkflow/Role')).toThrow(
            /not a state machine/,
        );
    });

    const cdkMachine = (logicalId: string, cdkPath?: string): Record<string, unknown> => ({
        Type: 'AWS::StepFunctions::StateMachine',
        ...(cdkPath === undefined ? {} : { Metadata: { 'aws:cdk:path': cdkPath } }),
        Properties: {
            DefinitionString: JSON.stringify({
                StartAt: logicalId,
                States: { [logicalId]: { Type: 'Succeed' } },
            }),
        },
    });

    it('prefers an exact logical ID over a construct path', () => {
        const template = {
            Resources: {
                OrderWorkflow: cdkMachine('OrderWorkflow'),
                OrderWorkflow0015CDD9: cdkMachine('OrderWorkflow0015CDD9', 'S/OrderWorkflow/Resource'),
            },
        };
        expect(extractAslFromTemplate({ resourceId: 'OrderWorkflow', template }).resourceId).toBe(
            'OrderWorkflow',
        );
    });

    it('throws listing the candidates when a construct path matches more than one machine', () => {
        const template = {
            Resources: {
                AFlowE02A3768: cdkMachine('AFlowE02A3768', 'S/A/Flow/Resource'),
                BFlowF1F7FEAE: cdkMachine('BFlowF1F7FEAE', 'S/B/Flow/Resource'),
            },
        };
        expect(() => extractAslFromTemplate({ resourceId: 'Flow', template })).toThrow(
            "Resource 'Flow' matches more than one state machine: AFlowE02A3768 (S/A/Flow), " +
                'BFlowF1F7FEAE (S/B/Flow). Pass a longer construct path or a logical ID.',
        );
    });
});

describe('DefinitionUri files read through readFile', () => {
    const LOCATION = 'statemachine/order.asl.json';

    const samTemplate = (properties: Record<string, unknown>): Record<string, unknown> => ({
        Resources: { Machine: { Type: 'AWS::Serverless::StateMachine', Properties: properties } },
    });

    const extractFile = (
        text: string,
        substitutions?: Record<string, unknown>,
    ): ReturnType<typeof extractAslFromTemplate> =>
        extractAslFromTemplate({
            readFile: () => text,
            template: samTemplate({
                DefinitionUri: LOCATION,
                ...(substitutions === undefined ? {} : { DefinitionSubstitutions: substitutions }),
            }),
        });

    it('reads a local DefinitionUri through readFile', () => {
        const readFile = vi.fn(() => '{"StartAt":"A","States":{"A":{"Type":"Pass","End":true}}}');
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            readFile,
            template: samTemplate({ DefinitionUri: LOCATION }),
        });
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(readFile).toHaveBeenCalledWith({ path: LOCATION });
        expect(aslDefinition.StartAt).toBe('A');
        expect(resourceId).toBe('Machine');
    });

    it('applies DefinitionSubstitutions to a DefinitionUri file as raw text', () => {
        const { aslDefinition } = extractFile(
            '{"StartAt":"W","States":{"W":{"Type":"Wait","Seconds":${Wait},"Next":"T"},' +
                '"T":{"Type":"Task","Resource":"${FnArn}","End":true}}}',
            { FnArn: { 'Fn::GetAtt': ['Fn', 'Arn'] }, Wait: 30 },
        );
        expect(aslDefinition.States.W.Seconds).toBe(30);
        expect(aslDefinition.States.T.Resource).toBe('<Fn.Arn>');
    });

    it('substitutes an unquoted YAML StartAt in a DefinitionUri file', () => {
        const { aslDefinition } = extractFile('StartAt: ${First}\nStates:\n  A:\n    Type: Succeed\n', {
            First: 'A',
        });
        expect(aslDefinition.StartAt).toBe('A');
    });

    it('parses a YAML DefinitionUri file', () => {
        const { aslDefinition } = extractFile('StartAt: A\nStates:\n  A:\n    Type: Succeed\n');
        expect(aslDefinition.States.A.Type).toBe('Succeed');
    });

    it('strips a byte order mark from the DefinitionUri file', () => {
        const { aslDefinition } = extractFile(
            `${String.fromCharCode(0xfeff)}{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}`,
        );
        expect(aslDefinition.StartAt).toBe('A');
    });

    it("names the DefinitionUri and the reader's reason when readFile throws", () => {
        const message = thrownMessage(() =>
            extractAslFromTemplate({
                readFile: () => {
                    throw new Error('/work/statemachine/order.asl.json does not exist');
                },
                template: samTemplate({ DefinitionUri: LOCATION }),
            }),
        );
        expect(message).toContain(`DefinitionUri ('${LOCATION}')`);
        expect(message).toContain('/work/statemachine/order.asl.json does not exist');
    });

    it('names the DefinitionUri file when it is not valid JSON', () => {
        expect(() => extractFile('{"StartAt":')).toThrow(
            `DefinitionUri file '${LOCATION}' of state machine 'Machine' is not valid JSON.`,
        );
    });

    it.each(['just text', '[]', '{"auths":{"registry":{"auth":"c2VjcmV0"}}}'])(
        'rejects a DefinitionUri file that is not an ASL definition: %s',
        (text) => {
            const message = thrownMessage(() => extractFile(text));
            expect(message).toMatch(/is not an ASL definition/);
            expect(message).toContain(LOCATION);
            expect(message).not.toContain('c2VjcmV0');
        },
    );

    it.each([
        ['[default]\naws_access_key_id = AKIAEXAMPLE', /not valid YAML \(line 2\)/],
        ['{"secret": AKIAEXAMPLE}', /not valid JSON\./],
        ['a: *AKIAEXAMPLE', /not valid YAML\./],
    ])('does not echo DefinitionUri file contents in a parse error: %j', (text, expected) => {
        const message = thrownMessage(() => extractFile(text));
        expect(message).toMatch(expected);
        // Parser messages quote a truncated excerpt (`AKIAEXAMPL"...`), so check the prefix.
        expect(message).not.toContain('AKIA');
        expect(message).not.toContain('column');
        expect(message).toContain('Render the file directly');
    });

    it('parses a DefinitionUri YAML file without printing yaml warnings', () => {
        const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
        try {
            const { aslDefinition } = extractFile(
                'StartAt: A\nStates:\n  A: !secretTag\n    Type: Succeed\n',
            );
            expect(aslDefinition.StartAt).toBe('A');
            expect(JSON.stringify(emitWarning.mock.calls)).not.toContain('secretTag');
        } finally {
            emitWarning.mockRestore();
        }
    });

    it('rejects a non-ASL file that DefinitionSubstitutions would turn into ASL', () => {
        const message = thrownMessage(() =>
            extractFile('db:\n  host: ${Host}\n  password: hunter2-SECRET\n  user: ${User}\n', {
                Host: 'x\nStartAt: A\nStates: {A: {Type: Pass, End: true, Comment: "',
                User: '"}}',
            }),
        );
        expect(message).toMatch(/is not an ASL definition/);
        expect(message).not.toContain('hunter2');
    });

    it('reports a DefinitionUri file that breaks only after substitution', () => {
        const message = thrownMessage(() =>
            extractFile(
                '{"StartAt":"A","States":{"A":{"Type":"Pass","Comment":"${Note}","End":true}}}',
                { Note: 'a"b' },
            ),
        );
        expect(message).toMatch(/is not valid JSON after DefinitionSubstitutions are applied/);
        expect(message).toContain(LOCATION);
        expect(message).not.toContain('line');
    });

    it.each(['s3://bucket/order.asl.json', 'S3://bucket/order.asl.json'])(
        'keeps the diagnostic for an S3 DefinitionUri even with readFile: %s',
        (location) => {
            const readFile = vi.fn(() => '{}');
            expect(() =>
                extractAslFromTemplate({ readFile, template: samTemplate({ DefinitionUri: location }) }),
            ).toThrow(/cannot be read from the template alone/);
            expect(readFile).not.toHaveBeenCalled();
        },
    );

    it.each(['//example.invalid/share/x.json', '\\\\example.invalid\\share\\x.json', '\\\\?\\C:\\x.json'])(
        'refuses a network or device DefinitionUri without calling readFile: %s',
        (location) => {
            const readFile = vi.fn(() => '{}');
            const message = thrownMessage(() =>
                extractAslFromTemplate({ readFile, template: samTemplate({ DefinitionUri: location }) }),
            );
            expect(message).toMatch(/is a network or device path; only local files are read/);
            expect(message).toContain(location);
            expect(readFile).not.toHaveBeenCalled();
        },
    );

    it('keeps the diagnostic for an S3Location DefinitionUri and for DefinitionS3Location', () => {
        const readFile = vi.fn(() => '{}');
        for (const properties of [
            { DefinitionUri: { Bucket: 'b', Key: 'k' } },
            { DefinitionS3Location: { Bucket: 'b', Key: 'k' } },
            { DefinitionS3Location: 'statemachine/order.asl.json' },
        ]) {
            expect(() => extractAslFromTemplate({ readFile, template: samTemplate(properties) })).toThrow(
                /cannot be read from the template alone/,
            );
        }
        expect(readFile).not.toHaveBeenCalled();
    });

    it('prefers an inline Definition over DefinitionUri', () => {
        const readFile = vi.fn(() => '{}');
        const { aslDefinition } = extractAslFromTemplate({
            readFile,
            template: samTemplate({
                Definition: { StartAt: 'Inline', States: { Inline: { Type: 'Succeed' } } },
                DefinitionUri: LOCATION,
            }),
        });
        expect(aslDefinition.StartAt).toBe('Inline');
        expect(readFile).not.toHaveBeenCalled();
    });
});

describe('CDK DefinitionS3Location assets read through readFile', () => {
    const HASH = 'ab'.repeat(32);
    const KEY = `${HASH}.json`;
    const ASSET = `asset.${HASH}.json`;
    const ASL = '{"StartAt":"A","States":{"A":{"Type":"Pass","End":true}}}';
    const DIAGNOSTIC =
        "State machine 'Workflow' loads its definition from DefinitionS3Location, which cannot be read " +
        'from the template alone. Render that ASL file directly (download it first if it is in S3), ' +
        'or inline the definition in the template.';

    const cdkTemplate = (properties: Record<string, unknown>): Record<string, unknown> => ({
        Resources: { Workflow: { Type: 'AWS::StepFunctions::StateMachine', Properties: properties } },
    });
    const s3Location = (key: unknown = KEY): Record<string, unknown> => ({
        DefinitionS3Location: {
            Bucket: { 'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}' },
            Key: key,
        },
    });
    const manifest = ({ key = KEY, path = ASSET }: { key?: string; path?: string } = {}): string =>
        JSON.stringify({
            files: {
                [HASH]: {
                    destinations: { current: { bucketName: 'b', objectKey: key } },
                    source: { packaging: 'file', path },
                },
            },
        });
    const MANIFEST = manifest();
    const reader = (files: Record<string, string>) =>
        vi.fn(({ path }: ReadFileParams): string => {
            if (Object.hasOwn(files, path)) {
                return files[path];
            }
            throw new Error(`${path} does not exist`);
        });
    const extractCdk = (
        readFile: (params: ReadFileParams) => string,
        properties: Record<string, unknown> = s3Location(),
    ): ReturnType<typeof extractAslFromTemplate> =>
        extractAslFromTemplate({
            readFile,
            template: cdkTemplate(properties),
            templateFileName: 'cdk.out/Stack.template.json',
        });

    it('reads the asset a CDK manifest names for the object key', () => {
        const readFile = reader({ 'Stack.assets.json': MANIFEST, [ASSET]: ASL });
        const { aslDefinition, resourceId } = extractCdk(readFile);
        expect(aslDefinition.StartAt).toBe('A');
        expect(resourceId).toBe('Workflow');
        expect(readFile.mock.calls).toEqual([[{ path: 'Stack.assets.json' }], [{ path: ASSET }]]);
    });

    it('applies DefinitionSubstitutions to a CDK asset', () => {
        const readFile = reader({
            'Stack.assets.json': MANIFEST,
            [ASSET]: '{"StartAt":"T","States":{"T":{"Type":"Task","Resource":"${Fn}","End":true}}}',
        });
        const { aslDefinition } = extractCdk(readFile, {
            ...s3Location(),
            DefinitionSubstitutions: { Fn: { 'Fn::GetAtt': ['Fn', 'Arn'] } },
        });
        expect(aslDefinition.States.T.Resource).toBe('<Fn.Arn>');
    });

    it('rejects a CDK asset that is not an ASL definition', () => {
        const readFile = reader({ 'Stack.assets.json': MANIFEST, [ASSET]: '{"auths":{"x":"c2VjcmV0"}}' });
        const message = thrownMessage(() => extractCdk(readFile));
        expect(message).toBe(
            `CDK asset '${ASSET}' of state machine 'Workflow' is not an ASL definition ` +
                '(expected an object with StartAt and States).',
        );
        expect(message).not.toContain('c2VjcmV0');
    });

    it('does not echo a CDK asset in a parse error', () => {
        const readFile = reader({ 'Stack.assets.json': MANIFEST, [ASSET]: '{"secret": AKIAEXAMPLE}' });
        const message = thrownMessage(() => extractCdk(readFile));
        expect(
            message.startsWith(
                `CDK asset '${ASSET}' of state machine 'Workflow' is not valid JSON. Render the file directly`,
            ),
        ).toBe(true);
        expect(message).not.toContain('AKIA');
    });

    it('reads a Windows-written asset path with forward slashes', () => {
        const readFile = reader({
            'Stack.assets.json': manifest({ path: `..\\${ASSET}` }),
            [`../${ASSET}`]: ASL,
        });
        expect(extractCdk(readFile).aslDefinition.StartAt).toBe('A');
        expect(readFile.mock.calls[1]).toEqual([{ path: `../${ASSET}` }]);
    });

    it.each(['//example.invalid/s/x.json', '\\\\example.invalid\\s\\x.json'])(
        'refuses a network or device CDK asset path: %s',
        (path) => {
            const readFile = reader({ 'Stack.assets.json': manifest({ path }) });
            const message = thrownMessage(() => extractCdk(readFile));
            expect(message).toContain('which is a network or device path; only local files are read');
            expect(message).toContain(path);
            expect(readFile).toHaveBeenCalledTimes(1);
        },
    );

    it("adds the manifest's read error to the diagnostic", () => {
        expect(thrownMessage(() => extractCdk(reader({})))).toBe(
            `${DIAGNOSTIC} The CDK asset manifest beside the template could not be read: ` +
                'Stack.assets.json does not exist.',
        );
    });

    it('adds a missing asset entry to the diagnostic', () => {
        const readFile = reader({ 'Stack.assets.json': manifest({ key: 'other.json' }) });
        expect(thrownMessage(() => extractCdk(readFile))).toBe(
            `${DIAGNOSTIC} The CDK asset manifest 'Stack.assets.json' has no file asset with object key '${KEY}'.`,
        );
    });

    it('adds the missing asset file to the diagnostic', () => {
        const readFile = reader({ 'Stack.assets.json': MANIFEST });
        expect(thrownMessage(() => extractCdk(readFile))).toBe(
            `${DIAGNOSTIC} Its CDK asset '${ASSET}' could not be read: ${ASSET} does not exist.`,
        );
    });

    it.each([undefined, 'template.json', 'Parent.nested.template.json'])(
        'keeps the plain diagnostic when the template name is not a CDK stack template: %s',
        (templateFileName) => {
            const readFile = reader({ 'Stack.assets.json': MANIFEST, [ASSET]: ASL });
            const message = thrownMessage(() =>
                extractAslFromTemplate({ readFile, template: cdkTemplate(s3Location()), templateFileName }),
            );
            expect(message).toBe(DIAGNOSTIC);
            expect(readFile).not.toHaveBeenCalled();
        },
    );

    it('keeps the plain diagnostic for a non-string Key or no readFile', () => {
        const readFile = reader({ 'Stack.assets.json': MANIFEST, [ASSET]: ASL });
        expect(thrownMessage(() => extractCdk(readFile, s3Location({ 'Fn::Join': ['', ['a', 'b']] })))).toBe(
            DIAGNOSTIC,
        );
        expect(readFile).not.toHaveBeenCalled();
        expect(
            thrownMessage(() =>
                extractAslFromTemplate({
                    template: cdkTemplate(s3Location()),
                    templateFileName: 'Stack.template.json',
                }),
            ),
        ).toBe(DIAGNOSTIC);
    });

    it('keeps the plain diagnostic for a hand-written template named like a CDK one', () => {
        const readFile = reader({ 'vpc.assets.json': MANIFEST });
        const message = thrownMessage(() =>
            extractAslFromTemplate({
                readFile,
                template: cdkTemplate(s3Location('templates/workflow.asl.json')),
                templateFileName: 'vpc.template.json',
            }),
        );
        expect(message).toBe(DIAGNOSTIC);
        expect(readFile).not.toHaveBeenCalled();
    });

    it('prefers an inline Definition over DefinitionS3Location', () => {
        const readFile = reader({});
        const { aslDefinition } = extractCdk(readFile, {
            ...s3Location(),
            Definition: { StartAt: 'Inline', States: { Inline: { Type: 'Succeed' } } },
        });
        expect(aslDefinition.StartAt).toBe('Inline');
        expect(readFile).not.toHaveBeenCalled();
    });

    it.each([
        ['RefundStack.template.json'],
        ['assembly-Prod', 'ProdRefundStack13B44940.template.json'],
    ])('reads a synthesized CDK app and Stage from cdk.out: %s', (...segments) => {
        const templatePath = join(currentDir, '..', 'fixtures', 'cfn', 'cdk-asset', ...segments);
        const { aslDefinition, resourceId } = extractAslFromTemplate({
            readFile: ({ path }) => readFileSync(join(dirname(templatePath), path), 'utf-8'),
            template: readFileSync(templatePath, 'utf-8'),
            templateFileName: templatePath,
        });
        expect(resourceId).toBe('RefundWorkflow9F22E5E9');
        expect(aslDefinition.States.IssueRefund.Resource).toBe(
            'arn:aws:lambda:us-east-1:111122223333:function:Refund',
        );
    });
});

describe('listStateMachines', () => {
    const assemblyFile = (name: string): string => fixture(join('cdk-assembly', name));

    it('lists a real CDK template’s state machines with their construct paths', () => {
        expect(listStateMachines({ template: assemblyFile('OrdersStack.template.json') })).toEqual([
            { cdkPath: 'OrdersStack/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9' },
            { cdkPath: 'OrdersStack/Refund/Resource', logicalId: 'Refund532F98F3' },
        ]);
    });

    it('returns [] for a template with no Resources', () => {
        expect(listStateMachines({ template: assemblyFile('EmptyStack.template.json') })).toEqual([]);
        expect(listStateMachines({ template: 'null' })).toEqual([]);
    });

    it('throws on text that is not JSON', () => {
        expect(() => listStateMachines({ template: 'not json' })).toThrow(SyntaxError);
    });
});

describe('isStateMachineTemplate', () => {
    const jsonTemplate = JSON.stringify({
        Resources: {
            Machine: {
                Properties: { DefinitionString: '{}' },
                Type: 'AWS::StepFunctions::StateMachine',
            },
        },
    });
    const byteOrderMark = String.fromCharCode(0xfeff);

    it.each([
        ['a JSON template', jsonTemplate, true],
        ['a YAML CloudFormation template', fixture('cfn-template.yaml'), true],
        ['a YAML SAM template', fixture('sam-template.yaml'), true],
        ['a JSON template with a byte order mark', `${byteOrderMark}${jsonTemplate}`, true],
        [
            'a YAML template with no state machine',
            'Resources:\n  Fn:\n    Type: AWS::Lambda::Function\n',
            false,
        ],
        ['YAML ASL', 'StartAt: A\nStates:\n  A:\n    Type: Pass\n    End: true\n', false],
        [
            'JSON ASL',
            readFileSync(join(currentDir, '..', 'fixtures', 'simple.asl.json'), 'utf-8'),
            false,
        ],
        ['a Resources list', 'Resources:\n  - Type: AWS::StepFunctions::StateMachine\n', false],
        ['a scalar resource entry', 'Resources:\n  M: AWS::StepFunctions::StateMachine\n', false],
        ['a top-level scalar', 'just some words', false],
        ['an empty string', '', false],
        ['broken JSON', '{', false],
        [
            'YAML with a duplicate key',
            'Resources:\n  M:\n    Type: AWS::StepFunctions::StateMachine\n  M:\n    Type: X\n',
            false,
        ],
        [
            'two YAML documents',
            'Resources:\n  M:\n    Type: AWS::StepFunctions::StateMachine\n---\nb: 2\n',
            false,
        ],
    ])('%s', (_name, source, expected) => {
        expect(isStateMachineTemplate({ source })).toBe(expected);
    });

    it('prints no YAML warning for a non-template', () => {
        const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(isStateMachineTemplate({ source: 'foo: !Bar baz' })).toBe(false);
            expect(emitWarning).not.toHaveBeenCalled();
            expect(consoleWarn).not.toHaveBeenCalled();
        } finally {
            emitWarning.mockRestore();
            consoleWarn.mockRestore();
        }
    });
});
