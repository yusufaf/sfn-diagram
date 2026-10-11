/** Parameters for {@link resolveIntrinsics}. */
export interface ResolveIntrinsicsParams {
    /** DefinitionSubstitutions map applied to Fn::Sub / ${Var} placeholders. */
    substitutions?: Record<string, string>;
    /** Any parsed template value (object, array, or scalar). */
    value: unknown;
}

/** Result of {@link resolveIntrinsics}. */
export interface ResolveIntrinsicsResult {
    /** The value with every intrinsic replaced by a placeholder string. */
    value: unknown;
    /** Non-fatal notes about intrinsics that were stubbed generically. */
    warnings: string[];
}

function isPseudoParam(name: string): boolean {
    return name.startsWith('AWS::');
}

// Bounded, not `[^}]+`: unanchored on the right, that rescans to end-of-string from
// every `${` in a template with no closing brace - quadratic, on untrusted input. 255
// covers the whole body (`Logical.Attribute` reaches ~226); a longer name resolves to
// the literal placeholder, as an unknown name already does. See tests/performance.
const SUBSTITUTION_PATTERN = /\$\{([^}]{1,255})\}/g;

interface SubstituteParams {
    substitutions: Record<string, string>;
    template: string;
    /** Fn::Sub only: render `${!Literal}` as `${Literal}`. */
    unescapeLiterals: boolean;
}

function substitute(params: SubstituteParams): string {
    const { substitutions, template, unescapeLiterals } = params;
    // Replace ${Var} with a substitution when known; keep ${AWS::X} pseudo-params.
    return template.replace(SUBSTITUTION_PATTERN, (match, name: string) => {
        if (unescapeLiterals && name.startsWith('!')) return `\${${name.slice(1)}}`;
        if (isPseudoParam(name)) return match;
        // Own keys only: `${constructor}` must not resolve through the prototype.
        if (Object.hasOwn(substitutions, name)) return substitutions[name];
        return match;
    });
}

/** Parameters for {@link applySubstitutions}. */
export interface ApplySubstitutionsParams {
    /** Resolved DefinitionSubstitutions (string to string). */
    substitutions: Record<string, string>;
    /** A definition: a string (unparsed JSON text), or a parsed object, array or scalar. */
    value: unknown;
}

/**
 * Applies `DefinitionSubstitutions` to a state machine definition.
 *
 * A string is substituted as raw text, the way CloudFormation does for a
 * `DefinitionString`, so an unquoted `"Seconds":${Wait}` works; run this
 * *before* `JSON.parse`. For a parsed object or array, every string value and
 * every object key is substituted. Unknown names and `${AWS::X}`
 * pseudo-parameters stay literal, and `${!Literal}` is not unescaped (that is
 * `Fn::Sub` syntax).
 *
 * This is a single pass: a substituted value is not rescanned for placeholders.
 *
 * @param params - The substitutions map and the definition to apply it to.
 * @returns The substituted definition, or `value` itself when the map is empty.
 *
 * @example
 * ```typescript
 * applySubstitutions({ substitutions: { Fn: 'arn:f' }, value: '{"Resource":"${Fn}"}' });
 * // '{"Resource":"arn:f"}'
 * ```
 */
export function applySubstitutions(params: ApplySubstitutionsParams): unknown {
    const { substitutions, value } = params;
    if (Object.keys(substitutions).length === 0) return value;

    function walk(current: unknown): unknown {
        if (typeof current === 'string') {
            return substitute({ substitutions, template: current, unescapeLiterals: false });
        }
        if (Array.isArray(current)) return current.map(walk);
        if (current === null || typeof current !== 'object') return current;
        return Object.fromEntries(
            Object.entries(current).map(([key, entry]) => [walk(key) as string, walk(entry)]),
        );
    }

    return walk(value);
}

/** Parameters for {@link resolveSubstitutions}. */
export interface ResolveSubstitutionsParams {
    /** The raw DefinitionSubstitutions property, as parsed from the template. */
    value: unknown;
}

/** Result of {@link resolveSubstitutions}. */
export interface ResolveSubstitutionsResult {
    /** Every value flattened to a string. */
    substitutions: Record<string, string>;
    /** Non-fatal notes about values replaced with placeholders. */
    warnings: string[];
}

/**
 * Flattens a `DefinitionSubstitutions` property into a string-to-string map.
 *
 * String values are kept and numbers or booleans stringified (YAML parses
 * `Timeout: 30` as a number). Intrinsic values (`Ref`, `Fn::GetAtt`, `Fn::Sub`,
 * ...) go through {@link resolveIntrinsics}, so they render the same
 * placeholders as inside the definition. A value that cannot become a string
 * is replaced with `<Key>` and reported in `warnings`.
 *
 * @param params - The raw `DefinitionSubstitutions` property.
 * @returns The flattened map and any non-fatal warnings.
 *
 * @example
 * ```typescript
 * resolveSubstitutions({ value: { Fn: { 'Fn::GetAtt': ['Fn', 'Arn'] } } });
 * // { substitutions: { Fn: '<Fn.Arn>' }, warnings: [] }
 * ```
 */
export function resolveSubstitutions(params: ResolveSubstitutionsParams): ResolveSubstitutionsResult {
    const { value } = params;
    const warnings: string[] = [];

    if (value === undefined) return { substitutions: {}, warnings };
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        warnings.push('DefinitionSubstitutions is not a key-value map; ignored');
        return { substitutions: {}, warnings };
    }

    const entries = Object.entries(value).map(([name, entry]): [string, string] => {
        if (typeof entry === 'string') return [name, entry];
        if (typeof entry === 'number' || typeof entry === 'boolean') return [name, String(entry)];
        const { value: resolved, warnings: entryWarnings } = resolveIntrinsics({ value: entry });
        warnings.push(...entryWarnings);
        if (typeof resolved === 'string') return [name, resolved];
        warnings.push(
            `DefinitionSubstitutions value for '${name}' is not a string or a supported intrinsic; replaced with placeholder <${name}>`,
        );
        return [name, `<${name}>`];
    });

    return { substitutions: Object.fromEntries(entries), warnings };
}

/**
 * Replaces every CloudFormation intrinsic in a parsed template value with a
 * readable placeholder string, so the result can be parsed as ASL.
 *
 * `Fn::Join` is concatenated, `Fn::Sub` variables are filled from the
 * substitutions map, `Ref`/`Fn::GetAtt` become `<Ref:Id>` / `<Res.Attr>`, and
 * pseudo-parameters stay as `${AWS::Partition}`-style tokens. Anything else is
 * stubbed as `<Fn::Name>` and reported in `warnings`.
 *
 * @param params - The value to resolve plus optional DefinitionSubstitutions.
 * @returns The resolved value and any non-fatal warnings.
 *
 * @example
 * ```typescript
 * const { value } = resolveIntrinsics({ value: { Ref: 'AWS::Partition' } });
 * // value === '${AWS::Partition}'
 * ```
 */
export function resolveIntrinsics(params: ResolveIntrinsicsParams): ResolveIntrinsicsResult {
    const { substitutions = {}, value } = params;
    const warnings: string[] = [];

    function walk(current: unknown): unknown {
        if (Array.isArray(current)) {
            return current.map(walk);
        }
        if (current === null || typeof current !== 'object') {
            return current;
        }

        const objectKeys = Object.keys(current as object);

        // Intrinsics are single-key objects like { Ref: ... } or { "Fn::Join": ... }.
        if (objectKeys.length === 1) {
            const key = objectKeys[0];
            const inner = (current as Record<string, unknown>)[key];

            if (key === 'Ref' && typeof inner === 'string') {
                return isPseudoParam(inner) ? `\${${inner}}` : `<Ref:${inner}>`;
            }
            if (key === 'Fn::GetAtt') {
                const parts = Array.isArray(inner) ? inner : String(inner).split('.');
                return `<${parts.join('.')}>`;
            }
            if (key === 'Fn::Join') {
                const [delimiter, parts] = inner as [string, unknown[]];
                return parts.map((part) => String(walk(part))).join(delimiter);
            }
            if (key === 'Fn::Sub') {
                if (typeof inner === 'string') {
                    return substitute({ substitutions, template: inner, unescapeLiterals: true });
                }
                if (Array.isArray(inner)) {
                    const [subTemplate, localMap] = inner as [string, Record<string, unknown>];
                    const localResolved: Record<string, string> = { ...substitutions };
                    for (const localKey of Object.keys(localMap)) {
                        localResolved[localKey] = String(walk(localMap[localKey]));
                    }
                    return substitute({
                        substitutions: localResolved,
                        template: subTemplate,
                        unescapeLiterals: true,
                    });
                }
            }
            if (key.startsWith('Fn::')) {
                warnings.push(`Unresolved intrinsic ${key} replaced with placeholder`);
                return `<${key}>`;
            }
        }

        // Plain object — recurse over every value.
        const output: Record<string, unknown> = {};
        for (const key of objectKeys) {
            output[key] = walk((current as Record<string, unknown>)[key]);
        }
        return output;
    }

    return { value: walk(value), warnings };
}
