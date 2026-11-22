import type { AslDefinition, ExtractAslFromTemplateParams, ExtractAslResult } from '../types';
import { parseAslSource } from '../AslParser';
import {
    formatMachineLabel,
    matchStateMachine,
    readCdkPath,
    type StateMachineCandidate,
} from './cdkPath';
import { applySubstitutions, resolveIntrinsics, resolveSubstitutions } from './intrinsics';
import { parseTemplate } from './templateParser';

/** Resource types that declare a Step Functions state machine: CloudFormation's own and SAM's. */
export const STATE_MACHINE_TYPES: readonly string[] = [
    'AWS::StepFunctions::StateMachine',
    'AWS::Serverless::StateMachine',
];

/** Properties that point at a definition stored elsewhere: SAM's, then CloudFormation's. */
const EXTERNAL_DEFINITION_KEYS: readonly string[] = ['DefinitionUri', 'DefinitionS3Location'];

const STATE_MACHINE_TYPE_LIST = STATE_MACHINE_TYPES.join(' or ');

interface CfnResource {
    Metadata?: unknown;
    Properties?: Record<string, unknown>;
    Type?: string;
}

function findStateMachines(resources: Record<string, CfnResource>): StateMachineCandidate[] {
    return Object.keys(resources)
        .filter((logicalId) => STATE_MACHINE_TYPES.includes(resources[logicalId]?.Type ?? ''))
        .map((logicalId) => {
            const cdkPath = readCdkPath({ metadata: resources[logicalId].Metadata });
            return cdkPath === undefined ? { logicalId } : { cdkPath, logicalId };
        });
}

/**
 * Recovers a renderable ASL definition from a CloudFormation/SAM/CDK template.
 *
 * Locates the `AWS::StepFunctions::StateMachine` or SAM
 * `AWS::Serverless::StateMachine` resource (disambiguated with `resourceId`
 * when the template has more than one), flattens the intrinsics in its
 * `DefinitionString`/`Definition`, applies `DefinitionSubstitutions` to every
 * string in it (whichever form it takes), and parses the result as ASL. SAM
 * resources share the CloudFormation pipeline.
 *
 * `resourceId` is a logical ID, or for a CDK template the construct path of
 * the state machine: the `aws:cdk:path` that `cdk synth` writes (with or
 * without its trailing `/Resource`), the path relative to the stack
 * (`OrderWorkflow` for `OrderWorkflow0015CDD9`, worked out from CDK's logical
 * ID scheme, so it works without that metadata too), or a trailing part of
 * the path. An exact logical ID wins.
 *
 * @param params - Template source, optional format, optional resource id.
 * @returns The extracted ASL definition, the logical id used, and any warnings.
 * @throws If no state machine is found, `resourceId` matches none or more
 * than one, no `resourceId` is given and there are several, or the definition
 * is external (`DefinitionUri`/`DefinitionS3Location`).
 *
 * @example
 * ```typescript
 * const { aslDefinition } = extractAslFromTemplate({ template: cdkSynthJson });
 * // Pick one of several by the ID passed to `new sfn.StateMachine(this, 'OrderWorkflow', …)`.
 * const picked = extractAslFromTemplate({ resourceId: 'OrderWorkflow', template: cdkSynthJson });
 * // picked.resourceId === 'OrderWorkflow0015CDD9'
 * ```
 */
export function extractAslFromTemplate(params: ExtractAslFromTemplateParams): ExtractAslResult {
    const { format = 'auto', resourceId, template } = params;

    const parsed = parseTemplate({ format, template });
    const resources = (parsed.Resources ?? {}) as Record<string, CfnResource>;
    const machines = findStateMachines(resources);

    if (machines.length === 0) {
        throw new Error(`Template contains no ${STATE_MACHINE_TYPE_LIST} resource.`);
    }
    const labels = (): string =>
        machines.map((machine) => formatMachineLabel({ machine })).join(', ');

    let chosenId: string;
    if (resourceId) {
        const chosen = matchStateMachine({ machines, resourceId });
        if (chosen === undefined) {
            throw new Error(
                `Resource '${resourceId}' is not a state machine (${STATE_MACHINE_TYPE_LIST}). Found: ${labels()}.`,
            );
        }
        chosenId = chosen.logicalId;
    } else if (machines.length === 1) {
        chosenId = machines[0].logicalId;
    } else {
        throw new Error(
            `Template has multiple state machines: ${labels()}. ` +
                `Pass resourceId (or --resource) to choose one.`,
        );
    }

    const properties = resources[chosenId].Properties ?? {};
    const externalKey = EXTERNAL_DEFINITION_KEYS.find((key) => key in properties);
    if (externalKey && !('DefinitionString' in properties) && !('Definition' in properties)) {
        const location = properties[externalKey];
        const where = typeof location === 'string' ? ` ('${location}')` : '';
        throw new Error(
            `State machine '${chosenId}' loads its definition from ${externalKey}${where}, ` +
                `which cannot be read from the template alone. ` +
                `Render that ASL file directly (download it first if it is in S3), or inline the definition in the template.`,
        );
    }

    const { substitutions, warnings: substitutionWarnings } = resolveSubstitutions({
        value: properties.DefinitionSubstitutions,
    });
    const rawDefinition = properties.DefinitionString ?? properties.Definition;
    if (rawDefinition === undefined) {
        throw new Error(`State machine '${chosenId}' has no DefinitionString or Definition.`);
    }

    // Substitute before parsing: a string definition is filled as raw text (as CloudFormation
    // does), so an unquoted `"Seconds":${Wait}` is still valid JSON by the time it is parsed.
    const { value: resolved, warnings } = resolveIntrinsics({ value: rawDefinition });
    const substituted = applySubstitutions({ substitutions, value: resolved });
    const aslDefinition = parseAslSource({ source: substituted as AslDefinition | string });

    return { aslDefinition, resourceId: chosenId, warnings: [...substitutionWarnings, ...warnings] };
}
