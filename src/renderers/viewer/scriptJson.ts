/**
 * Match the characters that must not appear raw inside an inline `<script>` block.
 *
 * `<` and `>` are escaped so embedded content cannot terminate the script element or
 * open an HTML comment; U+2028 and U+2029 are valid in JSON but are illegal raw in a
 * JavaScript string literal.
 *
 * Built on demand rather than at module scope: a top-level `new RegExp(...)` reads
 * as a side effect to bundlers, which pins it into builds that never touch the
 * viewer (the GitHub Action bundle, for one).
 */
function scriptUnsafePattern(): RegExp {
    return new RegExp('[<>' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');
}

/** Parameters for {@link serializeForScriptBlock}. */
export interface SerializeForScriptBlockParams {
    /** Any JSON-serializable value to embed. */
    value: unknown;
}

/**
 * Serialize a value to JSON that is safe to embed between `<script>` and `</script>`.
 *
 * Escapes every character that could break out of the script element, so content whose
 * text contains `</script>` cannot terminate the document early.
 *
 * @param params - Parameters for serialization
 * @param params.value - Any JSON-serializable value to embed
 * @returns JSON string safe to embed in an inline script block
 *
 * @example
 * ```typescript
 * const json = serializeForScriptBlock({ value: { Comment: '</script>' } });
 * const html = `<script type="application/json" id="sfn-data">${json}</script>`;
 * ```
 */
export function serializeForScriptBlock(params: SerializeForScriptBlockParams): string {
    const { value } = params;
    return JSON.stringify(value).replace(
        scriptUnsafePattern(),
        (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
    );
}
