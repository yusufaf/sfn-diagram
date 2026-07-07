import type { CatchLabelStyle, RetryBlock } from '../types';

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
