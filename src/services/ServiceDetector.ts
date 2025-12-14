import type { AslState } from '../types';

export interface ServiceInfo {
    iconUrl: string | null;
    serviceName: string;
}

interface BuildIconUrlParams {
    iconName: string;
}

interface DetectServiceParams {
    iconResolver?: (service: string) => string | null;
    state: AslState;
}

interface ExtractServiceFromArnParams {
    arn: string;
}

interface NormalizeServiceNameParams {
    serviceName: string;
}

/**
 * Mapping of AWS service names to their icon filenames in the aws-icons package
 * Icons sourced from: https://github.com/MKAbuMattar/aws-icons
 * URL pattern: https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/architecture-service/{ICON_NAME}.svg
 */
const SERVICE_ICON_MAP: Record<string, string> = {
    // Application Integration
    'apigateway': 'AmazonAPIGateway',
    'appflow': 'AmazonAppFlow',
    'appsync': 'AWSAppSync',
    'eventbridge': 'AmazonEventBridge',
    'events': 'AmazonEventBridge',
    'mq': 'AmazonMQ',
    'sns': 'AmazonSimpleNotificationService',
    'sqs': 'AmazonSimpleQueueService',
    'stepfunctions': 'AWSStepFunctions',
    'sfn': 'AWSStepFunctions',
    'states': 'AWSStepFunctions',

    // Analytics
    'athena': 'AmazonAthena',
    'emr': 'AmazonEMR',
    'glue': 'AWSGlue',
    'kinesis': 'AmazonKinesis',
    'kinesisanalytics': 'AmazonKinesisDataAnalytics',
    'kinesisfirehose': 'AmazonKinesisDataFirehose',
    'redshift': 'AmazonRedshift',

    // Compute
    'batch': 'AWSBatch',
    'ec2': 'AmazonEC2',
    'ecs': 'AmazonElasticContainerService',
    'eks': 'AmazonElasticKubernetesService',
    'fargate': 'AWSFargate',
    'lambda': 'AWSLambda',

    // Containers
    'ecr': 'AmazonElasticContainerRegistry',

    // Database
    'aurora': 'AmazonAurora',
    'documentdb': 'AmazonDocumentDB',
    'dynamodb': 'AmazonDynamoDB',
    'elasticache': 'AmazonElastiCache',
    'neptune': 'AmazonNeptune',
    'rds': 'AmazonRDS',
    'timestream': 'AmazonTimestream',

    // Developer Tools
    'codebuild': 'AWSCodeBuild',
    'codecommit': 'AWSCodeCommit',
    'codedeploy': 'AWSCodeDeploy',
    'codepipeline': 'AWSCodePipeline',

    // Machine Learning
    'bedrock': 'AmazonBedrock',
    'comprehend': 'AmazonComprehend',
    'forecast': 'AmazonForecast',
    'personalize': 'AmazonPersonalize',
    'polly': 'AmazonPolly',
    'rekognition': 'AmazonRekognition',
    'sagemaker': 'AmazonSageMaker',
    'textract': 'AmazonTextract',
    'transcribe': 'AmazonTranscribe',
    'translate': 'AmazonTranslate',

    // Management & Governance
    'cloudformation': 'AWSCloudFormation',
    'cloudwatch': 'AmazonCloudWatch',
    'config': 'AWSConfig',
    'systemsmanager': 'AWSSystemsManager',
    'ssm': 'AWSSystemsManager',

    // Security, Identity & Compliance
    'kms': 'AWSKeyManagementService',
    'secretsmanager': 'AWSSecretsManager',
    'waf': 'AWSWAF',

    // Storage
    'efs': 'AmazonElasticFileSystem',
    'fsx': 'AmazonFSx',
    's3': 'AmazonSimpleStorageService',
    's3glacier': 'AmazonS3Glacier',
};

/**
 * Extract AWS service name from ARN (Amazon Resource Name)
 *
 * Supports three ARN patterns:
 * 1. Direct service ARNs: arn:aws:SERVICE:region:account:resource
 * 2. Service integrations: arn:aws:states:::SERVICE:action
 * 3. SDK integrations: arn:aws:states:::aws-sdk:SERVICE:action
 *
 * @param params - Parameters containing the ARN to parse
 * @returns Normalized service name or null if parsing fails
 *
 * @example
 * extractServiceFromArn({ arn: 'arn:aws:lambda:us-east-1:123:function:MyFunc' })
 * // Returns: 'lambda'
 *
 * @example
 * extractServiceFromArn({ arn: 'arn:aws:states:::dynamodb:getItem' })
 * // Returns: 'dynamodb'
 */
function extractServiceFromArn(params: ExtractServiceFromArnParams): string | null {
    const { arn } = params;

    // Pattern 1: Direct service ARN (arn:aws:SERVICE:...)
    const directMatch = arn.match(/^arn:aws:([^:]+):/);
    if (directMatch && directMatch[1] !== 'states') {
        return normalizeServiceName({ serviceName: directMatch[1] });
    }

    // Pattern 2 & 3: Service integration ARNs
    const integrationMatch = arn.match(/^arn:aws:states:::([^:]+):/);
    if (integrationMatch) {
        const service = integrationMatch[1];

        // Pattern 3: SDK integration (arn:aws:states:::aws-sdk:SERVICE:action)
        if (service === 'aws-sdk') {
            const sdkMatch = arn.match(/^arn:aws:states:::aws-sdk:([^:]+):/);
            if (sdkMatch) {
                return normalizeServiceName({ serviceName: sdkMatch[1] });
            }
        }

        // Pattern 2: Standard service integration
        return normalizeServiceName({ serviceName: service });
    }

    return null;
}

/**
 * Normalize AWS service name to canonical form
 *
 * Converts service names to lowercase and removes hyphens for consistent mapping
 *
 * @param params - Parameters containing the service name to normalize
 * @returns Normalized service name
 *
 * @example
 * normalizeServiceName({ serviceName: 'Amazon-S3' })
 * // Returns: 'amazons3'
 *
 * @example
 * normalizeServiceName({ serviceName: 'DynamoDB' })
 * // Returns: 'dynamodb'
 */
function normalizeServiceName(params: NormalizeServiceNameParams): string {
    const { serviceName } = params;
    return serviceName.toLowerCase().replace(/-/g, '');
}

/**
 * Build CDN URL for AWS service icon
 *
 * Constructs jsDelivr CDN URL for icons from the aws-icons npm package
 *
 * @param params - Parameters containing the icon filename
 * @returns Full CDN URL to the icon SVG file
 *
 * @example
 * buildIconUrl({ iconName: 'AWSLambda' })
 * // Returns: 'https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/architecture-service/AWSLambda.svg'
 */
function buildIconUrl(params: BuildIconUrlParams): string {
    const { iconName } = params;
    const category = 'architecture-service';
    return `https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/${category}/${iconName}.svg`;
}

/**
 * Detect AWS service from ASL Task state and resolve icon URL
 *
 * Analyzes the Resource field of Task states to identify the AWS service,
 * then maps to the corresponding icon URL from the aws-icons CDN
 *
 * @param params - Parameters for service detection
 * @param params.state - ASL state definition to analyze
 * @param params.iconResolver - Optional custom function to resolve icon URLs
 * @returns Service information with name and icon URL, or null for non-Task states
 *
 * @example
 * const taskState = {
 *   Type: 'Task',
 *   Resource: 'arn:aws:lambda:us-east-1:123456789012:function:MyFunction'
 * };
 *
 * detectService({ state: taskState })
 * // Returns: {
 * //   serviceName: 'lambda',
 * //   iconUrl: 'https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/arch/Arch_AWS-Lambda_48.svg'
 * // }
 *
 * @example
 * // With custom icon resolver
 * detectService({
 *   state: taskState,
 *   iconResolver: (service) => {
 *     if (service === 'lambda') {
 *       return 'https://my-cdn.com/lambda.svg';
 *     }
 *     return null; // Use default
 *   }
 * })
 */
export function detectService(params: DetectServiceParams): ServiceInfo | null {
    const { iconResolver, state } = params;

    // Only Task states have AWS service resources
    if (state.Type !== 'Task' || !state.Resource) {
        return null;
    }

    const serviceName = extractServiceFromArn({ arn: state.Resource });
    if (!serviceName) {
        return null;
    }

    // Use custom resolver if provided
    if (iconResolver) {
        const customUrl = iconResolver(serviceName);
        return {
            iconUrl: customUrl,
            serviceName,
        };
    }

    // Look up icon in mapping
    const iconName = SERVICE_ICON_MAP[serviceName];
    if (!iconName) {
        // Service detected but no icon mapping exists
        return {
            iconUrl: null,
            serviceName,
        };
    }

    return {
        iconUrl: buildIconUrl({ iconName }),
        serviceName,
    };
}
