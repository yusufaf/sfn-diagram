import type { AslState, RedactCallback } from './types';

/**
 * Redaction of the data a generated document inlines beyond the drawn diagram.
 *
 * Two blobs carry more than the SVG itself shows: `#sfn-state-data`, the raw ASL of
 * every state the detail panel prints, and the payload text on `#sfn-timeline-data`'s
 * entries. Both are governed from here, so a caller has one hook to reason about
 * rather than one per blob.
 *
 * The drawn diagram is deliberately out of scope. State names, choice conditions and
 * variable annotations are rendered as SVG text, so redacting them would change the
 * picture rather than the data travelling beside it.
 */

/**
 * What stands in for a value {@link RedactCallback} asked to redact.
 *
 * A placeholder rather than a deletion: a missing `Parameters` key is
 * indistinguishable from a state that never had one, and a reader of a shared
 * document should be able to tell "withheld" from "absent".
 */
export const REDACTED: string = '[redacted]';

/** Parameters for {@link redactStateData}. */
export interface RedactStateDataParams {
    /** The caller's hook. Omit it and `stateData` is returned untouched, by reference. */
    redact?: RedactCallback;
    /** Raw ASL for each state, keyed by the node id the renderer stamps. */
    stateData: Record<string, AslState>;
}

/** Parameters for {@link redactPayloadText}. */
export interface RedactPayloadTextParams {
    /** Which of a run's payloads this is. */
    field: 'cause' | 'input' | 'output';
    /** The caller's hook. Omit it and `text` is returned unchanged. */
    redact?: RedactCallback;
    /** Node id of the state the run belongs to; omitted for an execution-level cause. */
    stateId?: string;
    /** The payload as it would otherwise be inlined, already capped. */
    text: string;
}

/** True for an object literal, the only thing worth recursing into. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve one callback answer.
 *
 * `undefined` means redact; anything else is what gets inlined. Returning the value
 * that was passed in means "keep it", which is also the signal to keep walking into it.
 */
function resolve(answer: unknown, value: unknown): { kept: boolean; value: unknown } {
    if (answer === undefined) return { kept: false, value: REDACTED };
    return { kept: answer === value, value: answer };
}

/** Parameters for {@link walkState}. */
interface WalkStateParams {
    /** Dotted path to `value` within its state, e.g. `Order.Parameters.Token`. */
    path: string;
    /** The caller's hook, already known to be present. */
    redact: RedactCallback;
    /** Node id of the state being walked. */
    stateId: string;
    /** The value to offer, then descend into if it survives. */
    value: unknown;
}

/**
 * Offer `value` to the hook, then recurse into what it kept.
 *
 * Top-down: a hook that redacts `Parameters` never sees the keys underneath it, which
 * is what makes "drop this whole subtree" a single answer rather than a traversal the
 * caller has to write. A substituted value is taken as final for the same reason.
 *
 * Containers are rebuilt rather than mutated - `collectStateData` hands back
 * references into the caller's own definition, and redaction must not edit it.
 */
function walkState(params: WalkStateParams): unknown {
    const { path, redact, stateId, value } = params;
    const { kept, value: resolved } = resolve(redact({ kind: 'state', path, stateId, value }), value);
    if (!kept) return resolved;

    if (Array.isArray(value)) {
        return value.map((item, index) =>
            walkState({ path: `${path}[${index}]`, redact, stateId, value: item }),
        );
    }
    if (isRecord(value)) {
        const next: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            next[key] = walkState({ path: `${path}.${key}`, redact, stateId, value: item });
        }
        return next;
    }
    return value;
}

/**
 * Run a caller's redaction hook over the raw ASL bound for `#sfn-state-data`.
 *
 * Every state is offered whole first (`path` is just its id), then every field at
 * every depth, so a hook can drop one key, one state, or scrub a value in place.
 *
 * @param params - Redaction parameters
 * @param params.redact - The caller's hook; without it nothing is walked
 * @param params.stateData - Raw ASL for each state, keyed by node id
 * @returns The state data to inline, or `stateData` itself when no hook was given
 *
 * @example
 * ```typescript
 * const safe = redactStateData({
 *     redact: ({ path, value }) => (path.endsWith('.Parameters') ? undefined : value),
 *     stateData: collectStateData({ definition: asl }),
 * });
 * safe.ProcessOrder.Parameters; // => '[redacted]'
 * ```
 *
 * @remarks
 * The hook is called with the value it would inline and returns what to inline
 * instead; returning that same value keeps it and descends into it. So a hook that
 * rebuilds an object it meant to keep stops the walk there - return the argument
 * itself to carry on.
 */
export function redactStateData(params: RedactStateDataParams): Record<string, AslState> {
    const { redact, stateData } = params;
    if (!redact) return stateData;

    const redacted: Record<string, AslState> = {};
    for (const [stateId, state] of Object.entries(stateData)) {
        redacted[stateId] = walkState({
            path: stateId,
            redact,
            stateId,
            value: state,
        }) as AslState;
    }
    return redacted;
}

/**
 * Run a caller's redaction hook over one execution payload.
 *
 * Offered as the single string it is, not parsed: a payload is opaque text that only
 * sometimes happens to be JSON, and a hook that wants to scrub inside it can parse
 * and re-serialize it itself.
 *
 * @param params - Redaction parameters
 * @param params.field - Which of a run's payloads this is
 * @param params.redact - The caller's hook; without it the text is returned unchanged
 * @param params.stateId - Node id of the state the run belongs to
 * @param params.text - The payload as it would otherwise be inlined
 * @returns The text to inline; {@link REDACTED} when the hook redacted it
 *
 * @example
 * ```typescript
 * redactPayloadText({
 *     field: 'input',
 *     redact: ({ kind, value }) => (kind === 'payload' ? undefined : value),
 *     stateId: 'ProcessOrder',
 *     text: '{"token":"abc"}',
 * }); // => '[redacted]'
 * ```
 *
 * @remarks
 * `path` is `<stateId>.<field>`, or `execution.cause` for the failure cause of the
 * execution itself, which belongs to no single state.
 */
export function redactPayloadText(params: RedactPayloadTextParams): string {
    const { field, redact, stateId, text } = params;
    if (!redact) return text;

    const { kept, value } = resolve(
        redact({ kind: 'payload', path: `${stateId ?? 'execution'}.${field}`, stateId, value: text }),
        text,
    );
    if (kept) return text;
    return typeof value === 'string' ? value : REDACTED;
}
