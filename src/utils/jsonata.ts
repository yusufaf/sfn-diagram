import type { AslState, QueryLanguage } from '../types';

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

/** The query language ASL assumes when a definition declares none. */
export const DEFAULT_QUERY_LANGUAGE: QueryLanguage = 'JSONPath';

interface ResolveQueryLanguageParams {
    /** The top-level `QueryLanguage` of the state machine, if it declares one. */
    machineQueryLanguage: QueryLanguage | undefined;
    /** The state whose effective query language is wanted. */
    state: AslState;
}

/**
 * Resolve the query language a state's fields are evaluated in.
 *
 * A state-level `QueryLanguage` overrides the state machine's top-level one for
 * that state alone; a state that declares none uses the top-level value, and a
 * machine that declares none is JSONPath. States nested in a Parallel branch or a
 * Map processor fall back to the top-level value, not to their container's
 * override — that is how ASL resolves it, so a container converted to JSONata
 * does not silently convert the states it contains.
 *
 * @param params.machineQueryLanguage - The top-level `QueryLanguage`, or undefined when omitted
 * @param params.state - The state to resolve for
 * @returns `'JSONata'` or `'JSONPath'`
 *
 * @example
 * ```typescript
 * resolveQueryLanguage({ machineQueryLanguage: undefined, state: { Type: 'Pass' } });
 * // 'JSONPath'
 * resolveQueryLanguage({ machineQueryLanguage: 'JSONPath', state: { Type: 'Pass', QueryLanguage: 'JSONata' } });
 * // 'JSONata'
 * ```
 */
export function resolveQueryLanguage(params: ResolveQueryLanguageParams): QueryLanguage {
    const { machineQueryLanguage, state } = params;
    return state.QueryLanguage ?? machineQueryLanguage ?? DEFAULT_QUERY_LANGUAGE;
}

interface UnwrapExpressionParams {
    /** The query language the field holding `value` is evaluated in. */
    queryLanguage: QueryLanguage;
    /** A string field value that may be a JSONata expression. */
    value: string;
}

/**
 * Prepare a string field value for display under the query language it is
 * evaluated in: in JSONata mode the `{% %}` delimiters are stripped, in JSONPath
 * mode the value is a literal and is shown as written.
 *
 * Branching on the declared mode rather than on the shape of the string keeps a
 * JSONPath literal that happens to start with `{%` intact.
 *
 * @param params.queryLanguage - The resolved query language of the state
 * @param params.value - The field value
 * @returns The display form of the value
 *
 * @example
 * ```typescript
 * unwrapExpression({ queryLanguage: 'JSONata', value: '{% $states.input.delay %}' }); // '$states.input.delay'
 * unwrapExpression({ queryLanguage: 'JSONPath', value: '{% literal %}' });           // '{% literal %}'
 * ```
 */
export function unwrapExpression(params: UnwrapExpressionParams): string {
    const { queryLanguage, value } = params;
    return queryLanguage === 'JSONata' ? stripJsonataDelimiters(value) : value;
}
