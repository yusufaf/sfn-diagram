import type { AslState, CatchLabelStyle, RetryBlock, StateNode } from '../types';
import { stripJsonataDelimiters } from '../utils/jsonata';

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

/**
 * Longest an expression may run inside a node sub-label before it is elided. A
 * JSONata `Seconds` can be an arbitrary expression, and the sub-label shares the
 * node's width with its name.
 */
const MAX_SUB_LABEL_EXPRESSION = 32;

/** Shorten an expression to fit a node sub-label, marking that it was cut. */
function elide(text: string): string {
    return text.length > MAX_SUB_LABEL_EXPRESSION
        ? `${text.slice(0, MAX_SUB_LABEL_EXPRESSION - 1)}…`
        : text;
}

/** Fewest characters worth rendering before a fitted sub-label is dropped entirely. */
const MIN_FITTED_SUB_LABEL = 4;

interface FitSubLabelParams {
    /** Width available for the text, in the same units `measure` returns. */
    availableWidth: number;
    /** Measures the rendered width of a candidate string. */
    measure: (text: string) => number;
    /** The full sub-label. */
    text: string;
}

/**
 * Trim a sub-label to the width actually available on the node.
 *
 * Node and container widths come from the layout, which sizes them from the node's
 * *name* and its children — not from this second line. A Distributed Map reporting
 * its mode, concurrency, tolerance and batching produces a line several times wider
 * than its header, which would otherwise render straight over the neighbouring
 * nodes. Trimming per-node rather than at a fixed character count keeps a short
 * label intact on a narrow node and a long one readable on a wide one.
 *
 * @param params.availableWidth - Width the text must fit within
 * @param params.measure - Width of a candidate string, e.g. `estimateTextWidth`
 * @param params.text - The full sub-label
 * @returns The label, elided with `…` if it did not fit, or `''` if nothing useful fits
 *
 * @example
 * ```typescript
 * fitSubLabel({ availableWidth: 90, measure, text: 'Distributed · max 100 · tolerate 5%' });
 * // 'Distributed · max…'
 * ```
 */
export function fitSubLabel(params: FitSubLabelParams): string {
    const { availableWidth, measure, text } = params;

    if (text === '' || measure(text) <= availableWidth) {
        return text;
    }

    // Linear scan back from the full string: sub-labels are short enough that a
    // binary search would not pay for its own complexity here.
    for (let length = text.length - 1; length >= MIN_FITTED_SUB_LABEL; length--) {
        const candidate = `${text.slice(0, length).trimEnd()}…`;
        if (measure(candidate) <= availableWidth) {
            return candidate;
        }
    }

    return '';
}

/**
 * Describe how long a Wait state waits, for display on the node.
 *
 * Fields are read in the order ASL resolves them, and only one is ever shown —
 * a definition setting more than one is invalid, and picking the first keeps the
 * label deterministic. A `Seconds` holding a JSONata expression is unwrapped, so
 * the node shows the expression rather than `{% ... %}` noise.
 *
 * @param state - The Wait state to describe
 * @returns A short label such as `5s`, or an empty string when nothing is set
 *
 * @example
 * ```typescript
 * getWaitDurationLabel({ Type: 'Wait', Seconds: 5 });                          // '5s'
 * getWaitDurationLabel({ Type: 'Wait', Seconds: '{% $.delay %}' });            // '$.delay'
 * getWaitDurationLabel({ Type: 'Wait', TimestampPath: '$.readyAt' });          // '$.readyAt'
 * ```
 */
export function getWaitDurationLabel(state: AslState): string {
    if (typeof state.Seconds === 'number') {
        return `${state.Seconds}s`;
    }
    if (typeof state.Seconds === 'string') {
        return elide(stripJsonataDelimiters(state.Seconds));
    }
    if (state.SecondsPath !== undefined) {
        return elide(state.SecondsPath);
    }
    if (state.Timestamp !== undefined) {
        return elide(stripJsonataDelimiters(state.Timestamp));
    }
    if (state.TimestampPath !== undefined) {
        return elide(state.TimestampPath);
    }
    return '';
}

/**
 * Describe a Map state's failure tolerance, for display on the container header.
 *
 * Arguably the most operationally important setting on a Distributed Map — it is
 * the difference between one bad item failing the whole run and an accepted loss
 * rate — and it is invisible in the AWS console's own graph view. Both a count and
 * a percentage may be set, in which case either threshold failing the state is
 * reflected by showing both.
 *
 * @param state - The Map state to describe
 * @returns A label such as `tolerate 5%`, or an empty string when no tolerance is set
 *
 * @example
 * ```typescript
 * getToleratedFailureLabel({ Type: 'Map', ToleratedFailurePercentage: 5 }); // 'tolerate 5%'
 * getToleratedFailureLabel({ Type: 'Map', ToleratedFailureCount: 100 });    // 'tolerate 100 failures'
 * ```
 */
export function getToleratedFailureLabel(state: AslState): string {
    const parts: string[] = [];

    if (state.ToleratedFailureCount !== undefined) {
        const count = state.ToleratedFailureCount;
        parts.push(`${count} failure${count === 1 ? '' : 's'}`);
    }
    if (state.ToleratedFailurePercentage !== undefined) {
        parts.push(`${state.ToleratedFailurePercentage}%`);
    }

    return parts.length > 0 ? `tolerate ${parts.join(' or ')}` : '';
}

/** Bytes per kibibyte, for rendering `MaxInputBytesPerBatch` at a readable scale. */
const BYTES_PER_KIB = 1024;

/**
 * Describe a Map state's `ItemBatcher` sizing, for display on the container header.
 *
 * Batching changes what a single child execution receives — a batched Distributed
 * Map hands its processor an array rather than one item — which is easy to miss
 * when reading a definition and invisible in the diagram otherwise.
 *
 * @param state - The Map state to describe
 * @returns A label such as `batches of 50`, or an empty string when batching is off
 *
 * @example
 * ```typescript
 * getItemBatchingLabel({ Type: 'Map', ItemBatcher: { MaxItemsPerBatch: 50 } }); // 'batches of 50'
 * ```
 */
export function getItemBatchingLabel(state: AslState): string {
    const batcher = state.ItemBatcher;
    if (!batcher) {
        return '';
    }

    const parts: string[] = [];
    const maxItems = batcher.MaxItemsPerBatch;
    const maxBytes = batcher.MaxInputBytesPerBatch;

    if (typeof maxItems === 'number') {
        parts.push(`of ${maxItems}`);
    }
    if (typeof maxBytes === 'number') {
        parts.push(`≤ ${Math.round(maxBytes / BYTES_PER_KIB)}KB`);
    }

    return parts.length > 0 ? `batches ${parts.join(', ')}` : '';
}

interface GetNodeSubLabelParams {
    node: StateNode;
    showStateType: boolean;
}

/**
 * Build the sub-label shown beneath a node's name.
 *
 * Covers every node type, not just containers: a Parallel/Map header carries its
 * Distributed marker, concurrency, failure tolerance and batching, while a Wait
 * state carries how long it waits. All of these are declared in a definition and
 * would otherwise be invisible in the rendered diagram. The state type itself
 * stays opt-in via `showStateTypes`.
 *
 * @param params.node - The node being rendered
 * @param params.showStateType - Whether the `showStateTypes` option is enabled
 * @returns A `·`-separated label, or an empty string when there is nothing to show
 *
 * @example
 * ```typescript
 * getNodeSubLabel({ node: distributedMapNode, showStateType: false });
 * // 'Distributed · max 100 · tolerate 5% · batches of 50'
 * getNodeSubLabel({ node: waitNode, showStateType: false });
 * // '5s'
 * getNodeSubLabel({ node: collapsedParallelNode, showStateType: false });
 * // '2 states'
 * ```
 */
export function getNodeSubLabel(params: GetNodeSubLabelParams): string {
    const { node, showStateType } = params;
    const parts: string[] = [];

    if (node.collapsed && node.collapsedCount !== undefined) {
        parts.push(`${node.collapsedCount} state${node.collapsedCount === 1 ? '' : 's'}`);
    }
    if (showStateType) {
        // Containers read as "Map state" in their header; a plain node's second line
        // has always shown the bare type, and changing that is not this label's job.
        parts.push(node.isContainer ? `${node.type} state` : node.type);
    }
    if (node.isDistributedMap) {
        parts.push('Distributed');
    }
    if (node.maxConcurrency !== undefined) {
        parts.push(`max ${node.maxConcurrency}`);
    }
    if (node.toleratedFailure !== undefined) {
        parts.push(node.toleratedFailure);
    }
    if (node.itemBatching !== undefined) {
        parts.push(node.itemBatching);
    }
    if (node.waitDuration !== undefined) {
        parts.push(node.waitDuration);
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
