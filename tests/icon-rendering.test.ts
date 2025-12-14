import { describe, expect, it } from 'vitest';
import { generateSvg } from '../src';
import type { AslDefinition } from '../src/types';

describe('Icon Rendering', () => {
    const lambdaStateMachine: AslDefinition = {
        StartAt: 'ProcessData',
        States: {
            ProcessData: {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ProcessData',
                Type: 'Task',
                End: true,
            },
        },
    };

    describe('showIcons option', () => {
        it('should include icon when showIcons is true', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                showIcons: true,
            });

            expect(svg).toContain('<image');
            expect(svg).toContain('AWSLambda.svg');
        });

        it('should not include icon when showIcons is false', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                showIcons: false,
            });

            expect(svg).not.toContain('<image');
        });

        it('should not include icon by default (showIcons undefined)', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
            });

            expect(svg).not.toContain('<image');
        });
    });

    describe('Icon positioning', () => {
        it('should position icon on left by default', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                showIcons: true,
            });

            const imageMatch = svg.match(/<image[^>]*x="([^"]+)"/);
            expect(imageMatch).not.toBeNull();

            const xPos = parseFloat(imageMatch![1]);
            expect(xPos).toBeLessThan(0); // Negative X means left side
        });

        it('should position icon on top when iconPosition is top', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconPosition: 'top',
                showIcons: true,
            });

            const imageMatch = svg.match(/<image[^>]*y="([^"]+)"/);
            expect(imageMatch).not.toBeNull();

            const yPos = parseFloat(imageMatch![1]);
            expect(yPos).toBeLessThan(0); // Negative Y means top
        });

        it('should position icon on right when iconPosition is right', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconPosition: 'right',
                showIcons: true,
            });

            const imageMatch = svg.match(/<image[^>]*x="([^"]+)"/);
            expect(imageMatch).not.toBeNull();

            const xPos = parseFloat(imageMatch![1]);
            expect(xPos).toBeGreaterThan(0); // Positive X means right side
        });
    });

    describe('Icon size', () => {
        it('should use default icon size of 24px', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                showIcons: true,
            });

            expect(svg).toContain('width="24"');
            expect(svg).toContain('height="24"');
        });

        it('should use custom icon size', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconSize: 32,
                showIcons: true,
            });

            expect(svg).toContain('width="32"');
            expect(svg).toContain('height="32"');
        });
    });

    describe('Label offset with icons', () => {
        it('should offset label to the right when icon is on left', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconPosition: 'left',
                showIcons: true,
            });

            // Label should have positive X offset
            const textMatch = svg.match(/<text[^>]*x="([^"]+)"[^>]*>ProcessData<\/text>/);
            expect(textMatch).not.toBeNull();

            const xPos = parseFloat(textMatch![1]);
            expect(xPos).toBeGreaterThan(0);
        });

        it('should offset label down when icon is on top', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconPosition: 'top',
                showIcons: true,
            });

            // Label should have Y offset when icon is on top
            const textMatch = svg.match(/<text[^>]*>ProcessData<\/text>/);
            expect(textMatch).not.toBeNull();

            // Extract Y attribute value
            const yMatch = textMatch![0].match(/y="([^"]+)"/);
            expect(yMatch).not.toBeNull();

            const yPos = parseFloat(yMatch![1]);
            expect(yPos).toBeGreaterThan(0); // Should be positive offset downward
        });
    });

    describe('Multiple services', () => {
        const multiServiceStateMachine: AslDefinition = {
            StartAt: 'ProcessWithLambda',
            States: {
                ProcessWithLambda: {
                    Next: 'SaveToDynamoDB',
                    Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Process',
                    Type: 'Task',
                },
                SaveToDynamoDB: {
                    Next: 'SendToSQS',
                    Resource: 'arn:aws:states:::dynamodb:putItem',
                    Type: 'Task',
                },
                SendToSQS: {
                    Resource: 'arn:aws:states:::sqs:sendMessage',
                    Type: 'Task',
                    End: true,
                },
            },
        };

        it('should render icons for multiple different services', () => {
            const { svg } = generateSvg({
                aslDefinition: multiServiceStateMachine,
                showIcons: true,
            });

            expect(svg).toContain('AWSLambda.svg');
            expect(svg).toContain('AmazonDynamoDB.svg');
            expect(svg).toContain('AmazonSimpleQueueService.svg');

            const imageCount = (svg.match(/<image/g) || []).length;
            expect(imageCount).toBe(3);
        });
    });

    describe('Custom icon resolver', () => {
        it('should use custom resolver URLs', () => {
            const customResolver = (service: string) => {
                if (service === 'lambda') {
                    return 'https://my-custom-cdn.com/lambda.svg';
                }
                return null;
            };

            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                iconResolver: customResolver,
                showIcons: true,
            });

            expect(svg).toContain('my-custom-cdn.com/lambda.svg');
            expect(svg).not.toContain('jsdelivr');
        });
    });

    describe('Non-Task states', () => {
        const mixedStateMachine: AslDefinition = {
            StartAt: 'PassState',
            States: {
                ChoiceState: {
                    Choices: [
                        {
                            Next: 'Success',
                            Variable: '$.foo',
                            StringEquals: 'bar',
                        },
                    ],
                    Default: 'Fail',
                    Type: 'Choice',
                },
                Fail: {
                    Type: 'Fail',
                },
                PassState: {
                    Next: 'TaskState',
                    Type: 'Pass',
                },
                Success: {
                    Type: 'Succeed',
                },
                TaskState: {
                    Next: 'ChoiceState',
                    Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Test',
                    Type: 'Task',
                },
            },
        };

        it('should only add icons to Task states', () => {
            const { svg } = generateSvg({
                aslDefinition: mixedStateMachine,
                showIcons: true,
            });

            // Only 1 Task state with icon
            const imageCount = (svg.match(/<image/g) || []).length;
            expect(imageCount).toBe(1);
            expect(svg).toContain('AWSLambda.svg');
        });
    });

    describe('Unsupported services', () => {
        const unsupportedServiceMachine: AslDefinition = {
            StartAt: 'UnknownService',
            States: {
                UnknownService: {
                    Resource: 'arn:aws:custom-unknown-service:us-east-1:123456789012:resource/test',
                    Type: 'Task',
                    End: true,
                },
            },
        };

        it('should not render icon for unsupported services', () => {
            const { svg } = generateSvg({
                aslDefinition: unsupportedServiceMachine,
                showIcons: true,
            });

            expect(svg).not.toContain('<image');
        });
    });

    describe('State type labels with icons', () => {
        it('should position showStateTypes label correctly with icons', () => {
            const { svg } = generateSvg({
                aslDefinition: lambdaStateMachine,
                showIcons: true,
                showStateTypes: true,
            });

            // Both label and type should be present
            expect(svg).toContain('ProcessData');
            expect(svg).toContain('Task');

            // Type label should have Y offset relative to main label
            const textMatches = svg.match(/<text[^>]*>Task<\/text>/);
            expect(textMatches).not.toBeNull();
        });
    });
});
