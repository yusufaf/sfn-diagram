/**
 * Strip the JSONata delimiters (`{% ... %}`) that wrap an expression in a
 * JSONata-mode definition, leaving the expression itself.
 *
 * ASL wraps every JSONata expression in these delimiters wherever a field would
 * otherwise hold a literal, so they carry no information once a value is known to
 * be an expression — and they cost horizontal space in a node or edge label.
 *
 * Shared rather than kept beside one caller because both a Choice rule's condition
 * and a Wait state's duration can be JSONata, and they are read in different modules.
 * Lives here, not in `constants/labels`, so `AslParser` can use it without the two
 * modules importing each other.
 *
 * @param expression - A field value that may be wrapped in `{% %}`
 * @returns The expression without its delimiters, trimmed; unchanged if unwrapped
 *
 * @example
 * ```typescript
 * stripJsonataDelimiters('{% $states.input.delaySeconds %}'); // '$states.input.delaySeconds'
 * stripJsonataDelimiters('$.value > 10');                     // '$.value > 10'
 * ```
 */
export function stripJsonataDelimiters(expression: string): string {
    return expression
        .replace(/^\{%\s*/, '')
        .replace(/\s*%\}$/, '')
        .trim();
}
