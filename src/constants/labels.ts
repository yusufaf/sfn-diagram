import type { CatchLabelStyle, RetryBlock, StateNode } from '../types';

/**
 * Label constants used in diagram generation
 */

export const EDGE_LABELS = {
    BRANCH_PREFIX: 'Branch',
    CATCH_PREFIX: 'Catch',
    CHOICE_PREFIX: 'Choice',
    CONDITION_FALLBACK: 'Condition',
    DEFAULT: 'Default',
    ERROR_PREFIX: 'Error:',
    ITERATOR: 'Iterator',
    RETRY_SYMBOL: '↻',
} as const;

/**
 * Node types for the Distributed Map I/O satellites. These are not ASL states —
 * they represent the AWS resources a Distributed Map reads from and writes to, so
 * graph transforms that reason about state reachability need to recognise them.
 */
export const MAP_IO_NODE_TYPES: ReadonlySet<string> = new Set(['ItemReader', 'ResultWriter']);

/** Default MaxAttempts when a Retry block omits it (per the ASL spec). */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Summarize a state's Retry blocks into a compact self-loop label,
 * e.g. "↻ States.TaskFailed (3x)" or "↻ States.ALL (2x); Timeout (5x)".
 */
export function getRetryLabel(retryBlocks: RetryBlock[]): string {
    const parts = retryBlocks.map((retry) => {
        const errors = retry.ErrorEquals?.join(', ') || 'All';
        const maxAttempts = retry.MaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        return `${errors} (${maxAttempts}x)`;
    });

    return `${EDGE_LABELS.RETRY_SYMBOL} ${parts.join('; ')}`;
}

/**
 * Generates a choice label with index
 */
export function getChoiceLabel(index: number): string {
    return `${EDGE_LABELS.CHOICE_PREFIX} ${index + 1}`;
}

/**
 * Generates a branch label with index
 */
export function getBranchLabel(index: number): string {
    return `${EDGE_LABELS.BRANCH_PREFIX} ${index + 1}`;
}

/**
 * Generates an error label with error types
 */
export function getErrorLabel(errorTypes?: string[]): string {
    const errors = errorTypes?.join(', ') || 'Any';
    return `${EDGE_LABELS.ERROR_PREFIX} ${errors}`;
}

/** Most variable names shown before the label collapses into a "+N more" suffix. */
const MAX_SHOWN_VARIABLES = 3;

/**
 * Summarize the variables a state assigns into a compact node annotation,
 * e.g. `$orderId, $total` or `$a, $b, $c +2 more`.
 *
 * Names are prefixed with `$` to match how they are referenced elsewhere in a
 * definition. The list is capped so a state assigning many variables cannot blow
 * out the node's width.
 *
 * @param variableNames - Assigned variable names, in declaration order
 * @returns A single-line label, or an empty string when nothing is assigned
 *
 * @example
 * ```typescript
 * getAssignedVariablesLabel(['orderId', 'total']);          // '$orderId, $total'
 * getAssignedVariablesLabel(['a', 'b', 'c', 'd', 'e']);     // '$a, $b, $c +2 more'
 * ```
 */
export function getAssignedVariablesLabel(variableNames: string[]): string {
    if (variableNames.length === 0) {
        return '';
    }

    const shown = variableNames.slice(0, MAX_SHOWN_VARIABLES);
    const label = shown.map((variableName) => `$${variableName}`).join(', ');
    const remaining = variableNames.length - shown.length;

    return remaining > 0 ? `${label} +${remaining} more` : label;
}

interface GetContainerSubLabelParams {
    node: StateNode;
    showStateType: boolean;
}

/**
 * Build the sub-label shown under a container node's name (Parallel/Map header).
 *
 * The Distributed marker and `MaxConcurrency` are included whenever present,
 * because a Distributed Map is otherwise visually identical to an inline Map
 * despite running a child execution per batch. The state type itself is opt-in
 * via `showStateTypes`.
 *
 * @param params.node - The container node being rendered
 * @param params.showStateType - Whether the `showStateTypes` option is enabled
 * @returns A `·`-separated label, or an empty string when there is nothing to show
 *
 * @example
 * ```typescript
 * getContainerSubLabel({ node: distributedMapNode, showStateType: false });
 * // 'Distributed · max 100'
 * getContainerSubLabel({ node: inlineMapNode, showStateType: true });
 * // 'Map state'
 * getContainerSubLabel({ node: collapsedParallelNode, showStateType: false });
 * // '2 states'
 * ```
 */
export function getContainerSubLabel(params: GetContainerSubLabelParams): string {
    const { node, showStateType } = params;
    const parts: string[] = [];

    if (node.collapsed && node.collapsedCount) {
        parts.push(`${node.collapsedCount} state${node.collapsedCount === 1 ? '' : 's'}`);
    }
    if (showStateType) {
        parts.push(`${node.type} state`);
    }
    if (node.isDistributedMap) {
        parts.push('Distributed');
    }
    if (node.maxConcurrency !== undefined) {
        parts.push(`max ${node.maxConcurrency}`);
    }

    return parts.join(' · ');
}

interface GetCatchLabelParams {
    catchLabelStyle?: CatchLabelStyle;
    errorTypes?: string[];
    index: number;
}

/**
 * Generates a catch block label based on style preference
 */
export function getCatchLabel(params: GetCatchLabelParams): string {
    const { catchLabelStyle = 'error-type', errorTypes, index } = params;

    if (catchLabelStyle === 'catch-number') {
        return `${EDGE_LABELS.CATCH_PREFIX} #${index + 1}`;
    }

    return getErrorLabel(errorTypes);
}
