import type { AslDefinition, AslState, LintDiagnostic, QueryLanguage } from './types';
import { escapePointerToken, parseAslSource, runValidation } from './AslParser';
import type { ScopeContext, StateContext } from './AslParser';
import { resolveQueryLanguage } from './utils/jsonata';

/** Parameters for {@link lintAsl}. */
export interface LintAslParams {
    /** The ASL definition to lint, as an object or a JSON string. */
    definition: AslDefinition | string;
}

/** State types that accept `Retry` and `Catch`. */
const RETRY_CATCH_TYPES: ReadonlySet<string> = new Set(['Map', 'Parallel', 'Task']);

/** Top-level state fields that only exist in JSONPath mode. */
const JSONPATH_ONLY_FIELDS = [
    'CausePath',
    'ErrorPath',
    'HeartbeatSecondsPath',
    'InputPath',
    'ItemsPath',
    'MaxConcurrencyPath',
    'OutputPath',
    'Parameters',
    'ResultPath',
    'ResultSelector',
    'SecondsPath',
    'TimeoutSecondsPath',
    'TimestampPath',
    'ToleratedFailureCountPath',
    'ToleratedFailurePercentagePath',
] as const;

/** Top-level state fields that only exist in JSONata mode. */
const JSONATA_ONLY_FIELDS = ['Arguments', 'Items', 'Output'] as const;

/** Choice-rule fields that only exist in one mode. */
const RULE_FIELDS: Record<QueryLanguage, readonly string[]> = {
    JSONPath: ['Variable', 'And', 'Or', 'Not'].concat(
        // Every JSONPath comparison operator: `StringEquals`, `NumericLessThanPath`, …
        ['String', 'Numeric', 'Boolean', 'Timestamp'].flatMap((kind) =>
            ['Equals', 'LessThan', 'GreaterThan', 'LessThanEquals', 'GreaterThanEquals', 'Matches'].flatMap(
                (operator) => [`${kind}${operator}`, `${kind}${operator}Path`],
            ),
        ),
        ['IsPresent', 'IsNull', 'IsNumeric', 'IsString', 'IsBoolean', 'IsTimestamp'],
    ),
    JSONata: ['Condition'],
};

/** Every transition target a state can reach directly, for the reachability walk. */
function transitionTargets(state: Record<string, unknown>): string[] {
    const targets: string[] = [];
    if (typeof state.Next === 'string') targets.push(state.Next);
    if (typeof state.Default === 'string') targets.push(state.Default);
    for (const field of ['Choices', 'Catch'] as const) {
        const entries = state[field];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries as unknown[]) {
            if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).Next === 'string') {
                targets.push((entry as Record<string, unknown>).Next as string);
            }
        }
    }
    return targets;
}

/** Lint-only rules that look at one state. */
function lintState(context: StateContext, diagnostics: LintDiagnostic[]): void {
    const { machineQueryLanguage, pointer, scope, state, stateName } = context;
    const qualify = (text: string): string => (scope === '' ? text : `${scope}: ${text}`);
    const push = (diagnostic: LintDiagnostic): void => {
        diagnostics.push({ ...diagnostic, message: qualify(diagnostic.message) });
    };
    const stateType = state.Type as string;

    if (state.End === true && 'Next' in state && state.Next !== undefined) {
        push({
            code: 'end-with-next',
            message: `State "${stateName}" sets both "End: true" and "Next"`,
            path: `${pointer}/Next`,
            severity: 'error',
        });
    }

    for (const field of ['Retry', 'Catch'] as const) {
        if (state[field] !== undefined && !RETRY_CATCH_TYPES.has(stateType)) {
            push({
                code: 'unsupported-retry-catch',
                message: `State "${stateName}" (Type: ${stateType}) does not support ${field}; only Task, Parallel and Map do`,
                path: `${pointer}/${field}`,
                severity: 'error',
            });
        }
    }

    if (stateType === 'Choice' && state.Default === undefined) {
        push({
            code: 'choice-without-default',
            message: `Choice state "${stateName}" has no Default; an input matching no rule fails the execution`,
            path: pointer,
            severity: 'warning',
        });
    }

    // A state may opt into JSONata inside a JSONPath machine, not the other way round:
    // Step Functions rejects a JSONPath override under a top-level JSONata.
    if (machineQueryLanguage === 'JSONata' && state.QueryLanguage === 'JSONPath') {
        push({
            code: 'query-language-mismatch',
            message: `State "${stateName}" sets QueryLanguage to JSONPath inside a JSONata state machine; only JSONPath machines may override per state`,
            path: `${pointer}/QueryLanguage`,
            severity: 'error',
        });
    }

    // Field mixing is judged by the declared mode (#233), never by the shape of a value.
    const queryLanguage = resolveQueryLanguage({
        machineQueryLanguage,
        state: state as unknown as AslState,
    });
    const otherLanguage: QueryLanguage = queryLanguage === 'JSONata' ? 'JSONPath' : 'JSONata';
    const foreignFields: readonly string[] = queryLanguage === 'JSONata' ? JSONPATH_ONLY_FIELDS : JSONATA_ONLY_FIELDS;
    for (const field of foreignFields) {
        if (state[field] !== undefined) {
            push({
                code: 'query-language-mismatch',
                message: `State "${stateName}" is in ${queryLanguage} mode but uses the ${otherLanguage}-only field "${field}"`,
                path: `${pointer}/${field}`,
                severity: 'error',
            });
        }
    }
    if (stateType === 'Choice' && Array.isArray(state.Choices)) {
        for (const [index, rule] of (state.Choices as unknown[]).entries()) {
            if (!rule || typeof rule !== 'object') continue;
            const foreign = RULE_FIELDS[otherLanguage].find(
                (field) => (rule as Record<string, unknown>)[field] !== undefined,
            );
            if (foreign !== undefined) {
                push({
                    code: 'query-language-mismatch',
                    message: `State "${stateName}" is in ${queryLanguage} mode but Choices[${index}] uses the ${otherLanguage}-only field "${foreign}"`,
                    path: `${pointer}/Choices/${index}/${foreign}`,
                    severity: 'error',
                });
            }
        }
    }
}

/** Lint-only rules that look at a whole `States` block. */
function lintScope(context: ScopeContext, diagnostics: LintDiagnostic[]): void {
    const { pointer, scope, startAt, states } = context;
    // A missing or dangling StartAt is already an error; flagging every state as
    // unreachable on top would bury it.
    if (startAt === undefined) return;

    const reached = new Set<string>();
    const queue = [startAt];
    while (queue.length > 0) {
        const name = queue.pop()!;
        if (reached.has(name) || !Object.hasOwn(states, name)) continue;
        reached.add(name);
        const state = states[name];
        if (state && typeof state === 'object') {
            queue.push(...transitionTargets(state as Record<string, unknown>));
        }
    }

    for (const name of Object.keys(states)) {
        if (reached.has(name)) continue;
        const text = `State "${name}" is unreachable from StartAt "${startAt}"`;
        diagnostics.push({
            code: 'unreachable-state',
            message: scope === '' ? text : `${scope}: ${text}`,
            path: `${pointer}/States/${escapePointerToken(name)}`,
            severity: 'warning',
        });
    }
}

/**
 * Lint an ASL definition and return every finding, instead of throwing on the first.
 *
 * Runs the same structural traversal as `validateAsl` (every fault that would
 * make the render path throw comes back as an `error`), plus rules a definition
 * can violate while still rendering:
 *
 * | code | severity | rule |
 * | --- | --- | --- |
 * | `unreachable-state` | warning | no path from the scope's `StartAt` reaches the state |
 * | `dangling-transition` | error | `StartAt` / `Next` / `Default` / `Choices[].Next` / `Catch[].Next` names a state missing from its scope |
 * | `choice-without-default` | warning | a Choice has no `Default` |
 * | `duplicate-state-name` | warning | a state name is reused in another `States` block |
 * | `end-with-next` | error | `End: true` together with `Next` |
 * | `unsupported-retry-catch` | error | `Retry` / `Catch` on a Pass, Wait, Choice, Succeed or Fail state |
 * | `query-language-mismatch` | error | a JSONPath-only field (`InputPath`, `Parameters`, `ResultPath`, …) in a JSONata state, or `Arguments` / `Output` / `Items` in a JSONPath state, judged by the resolved `QueryLanguage` |
 *
 * Structural codes (`invalid-structure`, `invalid-state-type`, `invalid-field`,
 * `missing-transition`) mirror `validateAsl`'s messages one to one. A string that is
 * not valid JSON yields a single `invalid-json` error.
 *
 * @param params - Object parameters
 * @param params.definition - The ASL definition, as an object or a JSON string
 * @returns Diagnostics in traversal order; empty when the definition is clean
 *
 * @example
 * ```typescript
 * const diagnostics = lintAsl({ definition: asl });
 * const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
 * for (const { path, code, message } of diagnostics) {
 *     console.log(`${path} [${code}] ${message}`);
 * }
 * ```
 */
export function lintAsl(params: LintAslParams): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    let definition: AslDefinition;
    try {
        definition = parseAslSource({ source: params.definition });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ code: 'invalid-json', message, path: '', severity: 'error' }];
    }

    // Name -> pointer of the first scope that used it, for the duplicate rule.
    const firstUse = new Map<string, string>();

    runValidation({
        definition,
        sink: {
            onScope: (context) => {
                lintScope(context, diagnostics);
                for (const name of Object.keys(context.states)) {
                    const path = `${context.pointer}/States/${escapePointerToken(name)}`;
                    const previous = firstUse.get(name);
                    if (previous === undefined) {
                        firstUse.set(name, path);
                        continue;
                    }
                    const text = `State name "${name}" is also used at ${previous}`;
                    diagnostics.push({
                        code: 'duplicate-state-name',
                        message: context.scope === '' ? text : `${context.scope}: ${text}`,
                        path,
                        severity: 'warning',
                    });
                }
            },
            onState: (context) => lintState(context, diagnostics),
            report: (diagnostic) => diagnostics.push(diagnostic),
        },
    });

    return diagnostics;
}
