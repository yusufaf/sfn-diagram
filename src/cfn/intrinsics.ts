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

function substitute(template: string, substitutions: Record<string, string>): string {
    // Replace ${Var} with a substitution when known; keep ${AWS::X} pseudo-params.
    return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => {
        if (isPseudoParam(name)) return match;
        if (name in substitutions) return substitutions[name];
        return match;
    });
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
                    return substitute(inner, substitutions);
                }
                if (Array.isArray(inner)) {
                    const [subTemplate, localMap] = inner as [string, Record<string, unknown>];
                    const localResolved: Record<string, string> = { ...substitutions };
                    for (const localKey of Object.keys(localMap)) {
                        localResolved[localKey] = String(walk(localMap[localKey]));
                    }
                    return substitute(subTemplate, localResolved);
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
