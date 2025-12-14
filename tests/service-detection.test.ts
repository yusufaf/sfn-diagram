import { describe, expect, it } from 'vitest';
import { detectService } from '../src/services';
import type { AslState } from '../src/types';

describe('Service Detection', () => {
    describe('Direct service ARNs (Pattern 1)', () => {
        it('should detect Lambda from direct ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('lambda');
            expect(result?.iconUrl).toContain('AWSLambda.svg');
        });

        it('should detect DynamoDB from direct ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws:dynamodb:us-west-2:123456789012:table/MyTable',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('dynamodb');
            expect(result?.iconUrl).toContain('AmazonDynamoDB.svg');
        });

        it('should detect S3 from direct ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws:s3:us-east-1:123456789012:bucket/my-bucket',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('s3');
            expect(result?.iconUrl).toContain('AmazonSimpleStorageService.svg');
        });
    });

    describe('Service integration ARNs (Pattern 2)', () => {
        it('should detect Lambda from service integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::lambda:invoke',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('lambda');
            expect(result?.iconUrl).toContain('AWSLambda.svg');
        });

        it('should detect DynamoDB from service integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::dynamodb:getItem',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('dynamodb');
        });

        it('should detect SQS from service integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::sqs:sendMessage',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('sqs');
            expect(result?.iconUrl).toContain('AmazonSimpleQueueService.svg');
        });

        it('should detect ECS from service integration with sync', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::ecs:runTask.sync',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('ecs');
        });
    });

    describe('SDK integration ARNs (Pattern 3)', () => {
        it('should detect DynamoDB from SDK integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::aws-sdk:dynamodb:getItem',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('dynamodb');
        });

        it('should detect S3 from SDK integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('s3');
        });

        it('should detect SNS from SDK integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::aws-sdk:sns:publish',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('sns');
            expect(result?.iconUrl).toContain('AmazonSimpleNotificationService.svg');
        });
    });

    describe('Service name normalization', () => {
        it('should normalize service names to lowercase', () => {
            const state: AslState = {
                Resource: 'arn:aws:Lambda:us-east-1:123456789012:function:Test',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('lambda');
        });

        it('should remove hyphens from service names', () => {
            const state: AslState = {
                Resource: 'arn:aws:kinesis-analytics:us-east-1:123456789012:application/test',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('kinesisanalytics');
        });
    });

    describe('Custom icon resolver', () => {
        it('should use custom resolver when provided', () => {
            const state: AslState = {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const customResolver = (service: string) => {
                if (service === 'lambda') {
                    return 'https://custom-cdn.com/lambda-icon.svg';
                }
                return null;
            };

            const result = detectService({ iconResolver: customResolver, state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('lambda');
            expect(result?.iconUrl).toBe('https://custom-cdn.com/lambda-icon.svg');
        });

        it('should fall back to default when custom resolver returns null', () => {
            const state: AslState = {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const customResolver = () => null;

            const result = detectService({ iconResolver: customResolver, state });

            expect(result).not.toBeNull();
            expect(result?.iconUrl).toBeNull();
        });
    });

    describe('Unsupported services', () => {
        it('should return null iconUrl for unsupported services', () => {
            const state: AslState = {
                Resource: 'arn:aws:custom-service:us-east-1:123456789012:resource/test',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('customservice');
            expect(result?.iconUrl).toBeNull();
        });
    });

    describe('Non-Task states', () => {
        it('should return null for Pass state', () => {
            const state: AslState = {
                Type: 'Pass',
            };

            const result = detectService({ state });

            expect(result).toBeNull();
        });

        it('should return null for Choice state', () => {
            const state: AslState = {
                Choices: [],
                Type: 'Choice',
            };

            const result = detectService({ state });

            expect(result).toBeNull();
        });

        it('should return null for Succeed state', () => {
            const state: AslState = {
                Type: 'Succeed',
            };

            const result = detectService({ state });

            expect(result).toBeNull();
        });

        it('should return null for Task without Resource', () => {
            const state: AslState = {
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).toBeNull();
        });
    });

    describe('Icon URL generation', () => {
        it('should generate correct jsDelivr CDN URL', () => {
            const state: AslState = {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Test',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.iconUrl).toBe(
                'https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/architecture-service/AWSLambda.svg'
            );
        });

        it('should include correct icon name for each service', () => {
            const services = [
                { arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test', icon: 'AmazonElasticContainerService' },
                { arn: 'arn:aws:sns:us-east-1:123456789012:topic/test', icon: 'AmazonSimpleNotificationService' },
                { arn: 'arn:aws:sagemaker:us-east-1:123456789012:model/test', icon: 'AmazonSageMaker' },
                { arn: 'arn:aws:glue:us-east-1:123456789012:job/test', icon: 'AWSGlue' },
            ];

            for (const { arn, icon } of services) {
                const state: AslState = { Resource: arn, Type: 'Task' };
                const result = detectService({ state });
                expect(result?.iconUrl).toContain(icon);
            }
        });
    });
});
