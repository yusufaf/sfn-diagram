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
 * Exact `aws-icons` version the CDN icon URLs point at.
 *
 * Pinned rather than `@latest`: the URL is embedded verbatim into every generated
 * SVG and HTML document, so an unpinned specifier lets an upstream release change
 * or break icons in output that already shipped.
 *
 * Bump deliberately, and only alongside the icon names in SERVICE_ICON_MAP: an
 * entry naming an icon that this version does not publish yet resolves to a 404
 * with every check still green, since nothing here fetches the URL.
 */
const AWS_ICONS_VERSION = '3.3.0';

/**
 * Mapping of AWS service names to their icon filenames in the aws-icons package
 * Icons sourced from: https://github.com/MKAbuMattar/aws-icons
 * URL pattern: https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/{ICON_NAME}.svg
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
 * Matches the `arn:PARTITION:` prefix for every AWS partition: `aws`, `aws-cn`,
 * `aws-us-gov`, `aws-iso`, `aws-iso-b`, `aws-eusc`, and any future `aws-*` name.
 */
const ARN_PARTITION_PATTERN = /^arn:aws(?:-[a-z]+)*:/;

/**
 * Matches an optimized service integration (`arn:PARTITION:states:::SERVICE:action`)
 * and captures the integrated service. Region and account are always empty here,
 * which is what distinguishes it from a direct Step Functions resource ARN such as
 * an Activity or a state machine.
 */
const INTEGRATION_ARN_PATTERN = new RegExp(`${ARN_PARTITION_PATTERN.source}states:::([^:]+):`);

/**
 * Matches an SDK integration (`arn:PARTITION:states:::aws-sdk:SERVICE:action`)
 * and captures the SDK service.
 */
const SDK_INTEGRATION_ARN_PATTERN = new RegExp(
    `${ARN_PARTITION_PATTERN.source}states:::aws-sdk:([^:]+):`
);

/**
 * Matches any other resource ARN (`arn:PARTITION:SERVICE:region:account:resource`)
 * and captures the owning service.
 */
const DIRECT_ARN_PATTERN = new RegExp(`${ARN_PARTITION_PATTERN.source}([^:]+):`);

/**
 * Extract AWS service name from ARN (Amazon Resource Name)
 *
 * Supports three ARN patterns, in any AWS partition (`aws`, `aws-cn`,
 * `aws-us-gov`, `aws-iso`, ...):
 * 1. Service integrations: arn:aws:states:::SERVICE:action
 * 2. SDK integrations: arn:aws:states:::aws-sdk:SERVICE:action
 * 3. Direct service ARNs: arn:aws:SERVICE:region:account:resource
 *
 * Direct Step Functions resources — Activity ARNs
 * (`arn:aws:states:REGION:ACCOUNT:activity:Name`) in particular — fall under
 * pattern 3 and resolve to `states`.
 *
 * @param params - Parameters containing the ARN to parse
 * @returns Normalized service name or null if parsing fails
 *
 * @example
 * extractServiceFromArn({ arn: 'arn:aws:lambda:us-east-1:123:function:MyFunc' })
 * // Returns: 'lambda'
 *
 * @example
 * extractServiceFromArn({ arn: 'arn:aws-cn:states:::dynamodb:getItem' })
 * // Returns: 'dynamodb'
 *
 * @example
 * extractServiceFromArn({ arn: 'arn:aws:states:us-east-1:123:activity:MyActivity' })
 * // Returns: 'states'
 */
function extractServiceFromArn(params: ExtractServiceFromArnParams): string | null {
    const { arn } = params;

    const sdkMatch = arn.match(SDK_INTEGRATION_ARN_PATTERN);
    if (sdkMatch) {
        return normalizeServiceName({ serviceName: sdkMatch[1] });
    }

    const integrationMatch = arn.match(INTEGRATION_ARN_PATTERN);
    if (integrationMatch) {
        return normalizeServiceName({ serviceName: integrationMatch[1] });
    }

    const directMatch = arn.match(DIRECT_ARN_PATTERN);
    if (directMatch) {
        return normalizeServiceName({ serviceName: directMatch[1] });
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
 * // Returns: 'https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AWSLambda.svg'
 */
function buildIconUrl(params: BuildIconUrlParams): string {
    const { iconName } = params;
    const category = 'architecture-service';
    return `https://cdn.jsdelivr.net/npm/aws-icons@${AWS_ICONS_VERSION}/icons/${category}/${iconName}.svg`;
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
 * //   iconUrl: 'https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service/AWSLambda.svg'
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

    return detectServiceFromResource({ iconResolver, resource: state.Resource });
}

interface DetectServiceFromResourceParams {
    /** Custom function to resolve an icon URL for a detected service */
    iconResolver?: (service: string) => string | null;
    /** An AWS resource ARN */
    resource: string;
}

/**
 * Resolve an AWS service (and its icon) directly from a resource ARN.
 *
 * The ARN-shaped counterpart to {@link detectService}, for resources that are
 * not Task states — a Distributed Map's `ItemReader` dataset source or
 * `ResultWriter` sink, for example.
 *
 * @param params.resource - The AWS resource ARN to inspect
 * @param params.iconResolver - Optional custom icon URL resolver, applied instead of the built-in mapping
 * @returns The service name and icon URL, or `null` when no service can be read from the ARN
 *
 * @example
 * ```typescript
 * detectServiceFromResource({ resource: 'arn:aws:states:::s3:getObject' });
 * // { serviceName: 's3', iconUrl: 'https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/...' }
 * ```
 */
export function detectServiceFromResource(
    params: DetectServiceFromResourceParams
): ServiceInfo | null {
    const { iconResolver, resource } = params;

    const serviceName = extractServiceFromArn({ arn: resource });
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
