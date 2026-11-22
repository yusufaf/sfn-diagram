import { md5Hex } from './md5';

/** Metadata key `cdk synth` writes on every resource, holding its construct path. */
export const CDK_PATH_METADATA_KEY = 'aws:cdk:path';

/** Construct IDs CDK hides in logical IDs: `Default` everywhere, `Resource` from the readable part. */
const HIDDEN_ID = 'Default';
const HIDDEN_FROM_HUMAN_ID = 'Resource';
const HASH_LENGTH = 8;
const MAX_HUMAN_LENGTH = 240;
const MAX_ID_LENGTH = 255;

/** A state machine resource in a template, as {@link matchStateMachine} sees it. */
export interface StateMachineCandidate {
    /** Its `aws:cdk:path` metadata, when the template has one. */
    cdkPath?: string;
    /** Its logical ID in the template. */
    logicalId: string;
}

/** Parameters for {@link readCdkPath}. */
export interface ReadCdkPathParams {
    /** A resource's `Metadata` value, of any shape. */
    metadata: unknown;
}

/**
 * Reads a resource's `aws:cdk:path` metadata.
 *
 * @param params - The resource's `Metadata`.
 * @returns The construct path, or `undefined` when it is missing or not a non-empty string.
 */
export function readCdkPath(params: ReadCdkPathParams): string | undefined {
    const { metadata } = params;
    if (typeof metadata !== 'object' || metadata === null) {
        return undefined;
    }
    const path = (metadata as Record<string, unknown>)[CDK_PATH_METADATA_KEY];
    return typeof path === 'string' && path !== '' ? path : undefined;
}

/** Parameters for {@link toConstructPath}. */
export interface ToConstructPathParams {
    /** An `aws:cdk:path` value. */
    cdkPath: string;
}

/**
 * Drops the trailing `/Resource` or `/Default` from an `aws:cdk:path`: the IDs of the default
 * child an L2 construct hides, so what is left is the path of the construct the user wrote.
 *
 * @param params - The `aws:cdk:path` value.
 * @returns The path with one trailing `/Resource` or `/Default` removed, or unchanged.
 */
export function toConstructPath(params: ToConstructPathParams): string {
    const { cdkPath } = params;
    for (const hidden of [HIDDEN_FROM_HUMAN_ID, HIDDEN_ID]) {
        if (cdkPath.endsWith(`/${hidden}`)) {
            return cdkPath.slice(0, -(hidden.length + 1));
        }
    }
    return cdkPath;
}

/** Parameters for {@link makeCdkLogicalId}. */
export interface MakeCdkLogicalIdParams {
    /** Construct IDs from the resource's stack (exclusive) down to the resource. */
    components: readonly string[];
}

/**
 * Computes the logical ID CDK gives a resource, a port of `makeUniqueId` in aws-cdk-lib.
 *
 * One component is used as-is (alphanumerics only). Longer paths get their readable part
 * (duplicates and `Resource` dropped) plus the first 8 hex characters of the path's MD5.
 *
 * @param params - The stack-relative construct path, split on `/`.
 * @returns The logical ID, or `undefined` when no components remain once `Default` is dropped.
 *
 * @example
 * ```typescript
 * makeCdkLogicalId({ components: ['OrderWorkflow', 'Resource'] }); // 'OrderWorkflow0015CDD9'
 * ```
 */
export function makeCdkLogicalId(params: MakeCdkLogicalIdParams): string | undefined {
    const components = params.components.filter((component) => component !== HIDDEN_ID);
    if (components.length === 0) {
        return undefined;
    }
    if (components.length === 1) {
        const candidate = removeNonAlphanumeric(components[0]);
        if (candidate.length <= MAX_ID_LENGTH) {
            return candidate;
        }
    }
    const hash = md5Hex({ text: components.join('/') })
        .slice(0, HASH_LENGTH)
        .toUpperCase();
    const human = removeDupes(components)
        .filter((component) => component !== HIDDEN_FROM_HUMAN_ID)
        .map(removeNonAlphanumeric)
        .join('')
        .slice(0, MAX_HUMAN_LENGTH);
    return human + hash;
}

function removeNonAlphanumeric(text: string): string {
    return text.replace(/[^A-Za-z0-9]/g, '');
}

/** Skips a component the previously kept one already ends with, as CDK does. */
function removeDupes(components: readonly string[]): string[] {
    const kept: string[] = [];
    for (const component of components) {
        if (kept.length === 0 || !kept[kept.length - 1].endsWith(component)) {
            kept.push(component);
        }
    }
    return kept;
}

/** Parameters for {@link formatMachineLabel}. */
export interface FormatMachineLabelParams {
    /** The state machine to describe. */
    machine: StateMachineCandidate;
}

/**
 * Describes a state machine for an error message, in the user's own names where possible.
 *
 * @param params - The state machine.
 * @returns `OrderWorkflow0015CDD9 (OrdersStack/OrderWorkflow)`, or the bare logical ID when the
 * template has no construct path for it.
 */
export function formatMachineLabel(params: FormatMachineLabelParams): string {
    const { cdkPath, logicalId } = params.machine;
    return cdkPath === undefined ? logicalId : `${logicalId} (${toConstructPath({ cdkPath })})`;
}

/** Parameters for {@link matchStateMachine}. */
export interface MatchStateMachineParams {
    /** The template's state machines. */
    machines: readonly StateMachineCandidate[];
    /** A logical ID or a CDK construct path (full, stack-relative, or a trailing part of one). */
    resourceId: string;
}

/**
 * Picks the state machine a `resourceId` names. Tries, in order, and stops at the first that
 * matches anything:
 *
 * 1. the logical ID itself;
 * 2. the full `aws:cdk:path` (with or without its trailing `/Resource`), or a stack-relative
 *    construct path whose computed logical ID is the machine's; the two count as one tier, so a
 *    value that names different machines each way is ambiguous rather than silently resolved;
 * 3. a trailing part of the construct path.
 *
 * A leading `/` (as in `cdk.out/manifest.json`) is ignored.
 *
 * @param params - The candidates and the value to match.
 * @returns The matching state machine, or `undefined` when nothing matches.
 * @throws If the first tier that matches matches more than one state machine.
 */
export function matchStateMachine(
    params: MatchStateMachineParams,
): StateMachineCandidate | undefined {
    const { machines, resourceId } = params;
    const wanted = resourceId.startsWith('/') ? resourceId.slice(1) : resourceId;
    const parts = wanted.split('/');
    const computedIds = new Set<string>();
    if (!parts.includes('')) {
        for (const components of [[...parts, HIDDEN_FROM_HUMAN_ID], parts]) {
            const logicalId = makeCdkLogicalId({ components });
            if (logicalId !== undefined) {
                computedIds.add(logicalId);
            }
        }
    }
    const paths = (machine: StateMachineCandidate): string[] =>
        machine.cdkPath === undefined
            ? []
            : [machine.cdkPath, toConstructPath({ cdkPath: machine.cdkPath })];

    const tiers: Array<(machine: StateMachineCandidate) => boolean> = [
        (machine) => machine.logicalId === resourceId,
        (machine) => paths(machine).includes(wanted) || computedIds.has(machine.logicalId),
        (machine) => paths(machine).some((path) => path.endsWith(`/${wanted}`)),
    ];
    for (const tier of tiers) {
        const matches = machines.filter(tier);
        if (matches.length > 1) {
            const labels = matches.map((machine) => formatMachineLabel({ machine })).join(', ');
            throw new Error(
                `Resource '${resourceId}' matches more than one state machine: ${labels}. ` +
                    `Pass a longer construct path or a logical ID.`,
            );
        }
        if (matches.length === 1) {
            return matches[0];
        }
    }
    return undefined;
}
