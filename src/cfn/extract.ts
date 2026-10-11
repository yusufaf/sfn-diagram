import type { AslDefinition, ExtractAslFromTemplateParams, ExtractAslResult } from '../types';
import { parseAslSource } from '../AslParser';
import { resolveIntrinsics } from './intrinsics';
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
    Properties?: Record<string, unknown>;
    Type?: string;
}

function findStateMachineIds(resources: Record<string, CfnResource>): string[] {
    return Object.keys(resources).filter((logicalId) =>
        STATE_MACHINE_TYPES.includes(resources[logicalId]?.Type ?? ''),
    );
}

/**
 * Recovers a renderable ASL definition from a CloudFormation/SAM/CDK template.
 *
 * Locates the `AWS::StepFunctions::StateMachine` or SAM
 * `AWS::Serverless::StateMachine` resource (disambiguated with `resourceId`
 * when the template has more than one), flattens the intrinsics in its
 * `DefinitionString`/`Definition`, applies `DefinitionSubstitutions`, and
 * parses the result as ASL. SAM resources share the CloudFormation pipeline.
 *
 * @param params - Template source, optional format, optional resource id.
 * @returns The extracted ASL definition, the logical id used, and any warnings.
 * @throws If no state machine is found, the choice is ambiguous, or the
 * definition is external (`DefinitionUri`/`DefinitionS3Location`).
 *
 * @example
 * ```typescript
 * const { aslDefinition } = extractAslFromTemplate({ template: cdkSynthJson });
 * ```
 */
export function extractAslFromTemplate(params: ExtractAslFromTemplateParams): ExtractAslResult {
    const { format = 'auto', resourceId, template } = params;

    const parsed = parseTemplate({ format, template });
    const resources = (parsed.Resources ?? {}) as Record<string, CfnResource>;
    const machineIds = findStateMachineIds(resources);

    if (machineIds.length === 0) {
        throw new Error(`Template contains no ${STATE_MACHINE_TYPE_LIST} resource.`);
    }

    let chosenId: string;
    if (resourceId) {
        if (!machineIds.includes(resourceId)) {
            throw new Error(
                `Resource '${resourceId}' is not a state machine (${STATE_MACHINE_TYPE_LIST}). Found: ${machineIds.join(', ')}.`,
            );
        }
        chosenId = resourceId;
    } else if (machineIds.length === 1) {
        chosenId = machineIds[0];
    } else {
        throw new Error(
            `Template has multiple state machines (${machineIds.join(', ')}). ` +
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
                `Render that ASL file directly, or inline the definition in the template.`,
        );
    }

    const substitutions = (properties.DefinitionSubstitutions ?? {}) as Record<string, string>;
    const rawDefinition = properties.DefinitionString ?? properties.Definition;
    if (rawDefinition === undefined) {
        throw new Error(`State machine '${chosenId}' has no DefinitionString or Definition.`);
    }

    const { value: resolved, warnings } = resolveIntrinsics({ substitutions, value: rawDefinition });

    const aslDefinition = parseAslSource({ source: resolved as AslDefinition | string });

    return { aslDefinition, resourceId: chosenId, warnings };
}
