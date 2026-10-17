import type { RedactCallback } from './types';

/** Parameters for {@link buildCliRedact}. */
export interface BuildCliRedactParams {
    /** ASL field names to redact wherever they appear; empty for none. */
    fields: string[];
    /** `false` redacts every state's ASL whole, from `--no-raw-state`. */
    includeRawState: boolean;
}

/**
 * Translate `--redact-fields` and `--no-raw-state` into the library's `redact` hook.
 *
 * The CLI cannot take a function, so it takes data and builds the function here; the
 * walk itself stays in `redactStateData`, the one implementation every sink shares.
 *
 * @param params - Redaction settings
 * @param params.fields - Field names to redact at any depth of a state's ASL
 * @param params.includeRawState - `false` to redact every state's entry whole
 * @returns The hook, or `undefined` when there is nothing to redact, so the document
 * is byte-identical to one generated without either flag
 *
 * @example
 * ```typescript
 * const redact = buildCliRedact({ fields: ['Parameters'], includeRawState: true });
 * await generateHtmlAsync({ aslDefinition, redact });
 * ```
 *
 * @remarks
 * A name matches a key exactly and case-sensitively, at any depth, so a nested
 * state's copy inside its Parallel or Map container is caught too. `Foo` also matches
 * `Foo.$`, the same field with a dynamic value, and a dotted name such as
 * `Parameters.Token` names a nested key. Matching runs on the path inside a state,
 * never on the state id, so a state named `Parameters` keeps its entry. A name that
 * matches nothing is not an error. Execution payloads pass through untouched.
 */
export function buildCliRedact(
    params: BuildCliRedactParams,
): RedactCallback | undefined {
    const { fields, includeRawState } = params;
    if (includeRawState && fields.length === 0) return undefined;

    const names = fields.flatMap((field) => [field, `${field}.$`]);
    const suffixes = names.map((name) => `.${name}`);

    return ({ kind, path, stateId, value }) => {
        if (kind !== 'state' || stateId === undefined) return value;
        if (path === stateId) return includeRawState ? value : undefined;

        const inner = path.slice(stateId.length + 1);
        if (
            names.includes(inner) ||
            suffixes.some((suffix) => inner.endsWith(suffix))
        ) {
            return undefined;
        }
        return value;
    };
}
