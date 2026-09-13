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

    describe('Non-standard partitions', () => {
        it('should detect Lambda from an aws-cn direct ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws-cn:lambda:cn-north-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('lambda');
            expect(result?.iconUrl).toContain('AWSLambda.svg');
        });

        it('should detect Lambda from an aws-us-gov direct ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws-us-gov:lambda:us-gov-west-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('lambda');
            expect(result?.iconUrl).toContain('AWSLambda.svg');
        });

        it('should detect service integrations in the aws-cn partition', () => {
            const state: AslState = {
                Resource: 'arn:aws-cn:states:::dynamodb:getItem',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('dynamodb');
            expect(result?.iconUrl).toContain('AmazonDynamoDB.svg');
        });

        it('should detect SDK integrations in the aws-us-gov partition', () => {
            const state: AslState = {
                Resource: 'arn:aws-us-gov:states:::aws-sdk:s3:putObject',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('s3');
            expect(result?.iconUrl).toContain('AmazonSimpleStorageService.svg');
        });

        it('should detect services in multi-segment partitions such as aws-iso-b', () => {
            const state: AslState = {
                Resource: 'arn:aws-iso-b:sqs:us-isob-east-1:123456789012:MyQueue',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('sqs');
        });

        it('should not treat an arbitrary prefix as a partition', () => {
            const state: AslState = {
                Resource: 'arn:awsomething:lambda:us-east-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).toBeNull();
        });
    });

    describe('Activity ARNs', () => {
        it('should detect Step Functions from an Activity ARN', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:us-east-1:123456789012:activity:MyActivity',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result).not.toBeNull();
            expect(result?.serviceName).toBe('states');
            expect(result?.iconUrl).toContain('AWSStepFunctions.svg');
        });

        it('should detect Step Functions from an Activity ARN in the aws-us-gov partition', () => {
            const state: AslState = {
                Resource: 'arn:aws-us-gov:states:us-gov-east-1:123456789012:activity:MyActivity',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('states');
            expect(result?.iconUrl).toContain('AWSStepFunctions.svg');
        });

        it('should still detect the nested service for a states integration', () => {
            const state: AslState = {
                Resource: 'arn:aws:states:::states:startExecution.sync',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.serviceName).toBe('states');
            expect(result?.iconUrl).toContain('AWSStepFunctions.svg');
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

    describe('Icon coverage', () => {
        // Every name below was checked against the pinned aws-icons release
        // (`AWS_ICONS_VERSION`) when it was added. The map is the only thing that
        // references these names, so this is the one place an upstream rename shows.
        const integrations: Array<{ icon: string; resource: string; service: string }> = [
            { icon: 'AmazonEMR', resource: 'arn:aws:states:::elasticmapreduce:createCluster', service: 'elasticmapreduce' },
            { icon: 'AmazonEMR', resource: 'arn:aws:states:::emr-serverless:startJobRun', service: 'emrserverless' },
            { icon: 'AmazonEMR', resource: 'arn:aws:states:::emr-containers:startJobRun', service: 'emrcontainers' },
            { icon: 'AWSGlueDataBrew', resource: 'arn:aws:states:::databrew:startJobRun', service: 'databrew' },
            { icon: 'AmazonDataFirehose', resource: 'arn:aws:states:::aws-sdk:firehose:putRecord', service: 'firehose' },
            { icon: 'AmazonDataFirehose', resource: 'arn:aws:states:::aws-sdk:kinesisfirehose:putRecord', service: 'kinesisfirehose' },
            { icon: 'AmazonManagedServiceforApacheFlink', resource: 'arn:aws:states:::aws-sdk:kinesisanalytics:startApplication', service: 'kinesisanalytics' },
            { icon: 'AmazonManagedServiceforApacheFlink', resource: 'arn:aws:states:::aws-sdk:kinesisanalyticsv2:startApplication', service: 'kinesisanalyticsv2' },
            { icon: 'AmazonBedrock', resource: 'arn:aws:states:::aws-sdk:bedrockruntime:invokeModel', service: 'bedrockruntime' },
            { icon: 'AmazonSageMaker', resource: 'arn:aws:states:::aws-sdk:sagemakerruntime:invokeEndpoint', service: 'sagemakerruntime' },
            { icon: 'AmazonLex', resource: 'arn:aws:states:::aws-sdk:lexruntimev2:recognizeText', service: 'lexruntimev2' },
            { icon: 'AmazonLex', resource: 'arn:aws:lex:us-east-1:123456789012:bot/MyBot', service: 'lex' },
            { icon: 'AmazonOpenSearchService', resource: 'arn:aws:states:::aws-sdk:opensearch:describeDomain', service: 'opensearch' },
            { icon: 'AmazonOpenSearchService', resource: 'arn:aws:es:us-east-1:123456789012:domain/search', service: 'es' },
            { icon: 'AmazonOpenSearchService', resource: 'arn:aws:states:::aws-sdk:elasticsearch:describeDomain', service: 'elasticsearch' },
            { icon: 'AWSElementalMediaConvert', resource: 'arn:aws:states:::mediaconvert:createJob', service: 'mediaconvert' },
            { icon: 'AmazonSimpleEmailService', resource: 'arn:aws:states:::aws-sdk:ses:sendEmail', service: 'ses' },
            { icon: 'AmazonSimpleEmailService', resource: 'arn:aws:states:::aws-sdk:sesv2:sendEmail', service: 'sesv2' },
            { icon: 'AWSIdentityandAccessManagement', resource: 'arn:aws:states:::aws-sdk:sts:assumeRole', service: 'sts' },
            { icon: 'AWSIdentityandAccessManagement', resource: 'arn:aws:states:::aws-sdk:iam:getRole', service: 'iam' },
            { icon: 'AmazonCognito', resource: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc', service: 'cognitoidp' },
            { icon: 'AmazonCognito', resource: 'arn:aws:states:::aws-sdk:cognitoidentity:getId', service: 'cognitoidentity' },
            { icon: 'AmazonConnect', resource: 'arn:aws:states:::aws-sdk:connect:startOutboundVoiceContact', service: 'connect' },
            { icon: 'AmazonPinpoint', resource: 'arn:aws:states:::aws-sdk:pinpoint:sendMessages', service: 'pinpoint' },
            { icon: 'AmazonQuickSuite', resource: 'arn:aws:states:::aws-sdk:quicksight:createIngestion', service: 'quicksight' },
            { icon: 'AWSLakeFormation', resource: 'arn:aws:states:::aws-sdk:lakeformation:grantPermissions', service: 'lakeformation' },
            { icon: 'AWSCloudMap', resource: 'arn:aws:states:::aws-sdk:servicediscovery:discoverInstances', service: 'servicediscovery' },
            { icon: 'AWSCloudTrail', resource: 'arn:aws:states:::aws-sdk:cloudtrail:lookupEvents', service: 'cloudtrail' },
            { icon: 'AWSAppRunner', resource: 'arn:aws:states:::aws-sdk:apprunner:startDeployment', service: 'apprunner' },
            { icon: 'AWSAppConfig', resource: 'arn:aws:states:::aws-sdk:appconfig:getConfiguration', service: 'appconfig' },
            { icon: 'AmazonDynamoDB', resource: 'arn:aws:states:::aws-sdk:dynamodbstreams:describeStream', service: 'dynamodbstreams' },
            { icon: 'AmazonManagedWorkflowsforApacheAirflow', resource: 'arn:aws:states:::aws-sdk:mwaa:createCliToken', service: 'mwaa' },
            { icon: 'AWSSnowball', resource: 'arn:aws:states:::aws-sdk:snowball:createJob', service: 'snowball' },
            { icon: 'AWSDataSync', resource: 'arn:aws:states:::aws-sdk:datasync:startTaskExecution', service: 'datasync' },
            { icon: 'AmazonEFS', resource: 'arn:aws:states:::aws-sdk:efs:describeFileSystems', service: 'efs' },
            { icon: 'AmazonSimpleStorageServiceGlacier', resource: 'arn:aws:s3-glacier:us-east-1:123456789012:vaults/archive', service: 's3glacier' },
        ];

        it.each(integrations)('maps $service to $icon', ({ icon, resource, service }) => {
            const result = detectService({ state: { Resource: resource, Type: 'Task' } });

            expect(result?.serviceName).toBe(service);
            expect(result?.iconUrl).toBe(
                `https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/${icon}.svg`
            );
        });

        it('detects the HTTP Task integration as http without an icon', () => {
            // aws-icons has no service tile for a generic HTTP endpoint, only a
            // monochrome `resource/Internet` glyph that vanishes on the dark theme.
            const result = detectService({
                state: { Resource: 'arn:aws:states:::http:invoke', Type: 'Task' },
            });

            expect(result?.serviceName).toBe('http');
            expect(result?.iconUrl).toBeNull();
        });
    });

    describe('Integration pattern suffixes', () => {
        it.each([
            { resource: 'arn:aws:states:::ecs:runTask.sync', service: 'ecs' },
            { resource: 'arn:aws:states:::states:startExecution.sync:2', service: 'states' },
            { resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken', service: 'sqs' },
            { resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken', service: 'lambda' },
            { resource: 'arn:aws:states:::emr-serverless:startJobRun.sync', service: 'emrserverless' },
        ])('still resolves $service and its icon for $resource', ({ resource, service }) => {
            const result = detectService({ state: { Resource: resource, Type: 'Task' } });

            expect(result?.serviceName).toBe(service);
            expect(result?.iconUrl).not.toBeNull();
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
                'https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AWSLambda.svg'
            );
        });

        it('pins the icon CDN to an exact version rather than @latest', () => {
            // The URL is embedded verbatim into every generated SVG/HTML, so an
            // unpinned specifier hands a third party control over already-shipped output.
            const state: AslState = {
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction',
                Type: 'Task',
            };

            const result = detectService({ state });

            expect(result?.iconUrl).not.toContain('@latest');
            expect(result?.iconUrl).toMatch(/aws-icons@\d+\.\d+\.\d+\//);
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
