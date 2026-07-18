import type { AslDefinition, ExtractAslFromTemplateParams, ExtractAslResult } from '../types';
import { resolveIntrinsics } from './intrinsics';
import { parseTemplate } from './templateParser';

const STATE_MACHINE_TYPE = 'AWS::StepFunctions::StateMachine';

interface CfnResource {
    Properties?: Record<string, unknown>;
    Type?: string;
}

function findStateMachineIds(resources: Record<string, CfnResource>): string[] {
    return Object.keys(resources).filter(
        (logicalId) => resources[logicalId]?.Type === STATE_MACHINE_TYPE,
    );
}

/**
 * Recovers a renderable ASL definition from a CloudFormation/SAM/CDK template.
 *
 * Locates the `AWS::StepFunctions::StateMachine` resource (disambiguated with
 * `resourceId` when the template has more than one), flattens the intrinsics in
 * its `DefinitionString`/`Definition`, applies `DefinitionSubstitutions`, and
 * parses the result as ASL.
 *
 * @param params - Template source, optional format, optional resource id.
 * @returns The extracted ASL definition, the logical id used, and any warnings.
 * @throws If no state machine is found, the choice is ambiguous, or the
 * definition is external (`DefinitionUri`).
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
        throw new Error(`Template contains no ${STATE_MACHINE_TYPE} resource.`);
    }

    let chosenId: string;
    if (resourceId) {
        if (!machineIds.includes(resourceId)) {
            throw new Error(
                `Resource '${resourceId}' is not an ${STATE_MACHINE_TYPE}. Found: ${machineIds.join(', ')}.`,
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
    if (
        'DefinitionUri' in properties &&
        !('DefinitionString' in properties) &&
        !('Definition' in properties)
    ) {
        throw new Error(
            `State machine '${chosenId}' uses an external DefinitionUri, which is not supported. ` +
                `Pass a template with an inline DefinitionString or Definition.`,
        );
    }

    const substitutions = (properties.DefinitionSubstitutions ?? {}) as Record<string, string>;
    const rawDefinition = properties.DefinitionString ?? properties.Definition;
    if (rawDefinition === undefined) {
        throw new Error(`State machine '${chosenId}' has no DefinitionString or Definition.`);
    }

    const { value: resolved, warnings } = resolveIntrinsics({ substitutions, value: rawDefinition });

    const aslDefinition: AslDefinition =
        typeof resolved === 'string'
            ? (JSON.parse(resolved) as AslDefinition)
            : (resolved as AslDefinition);

    return { aslDefinition, resourceId: chosenId, warnings };
}
