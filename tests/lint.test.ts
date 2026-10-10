import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AslValidationError, lintAsl, validateAsl } from '../src/index';
import type { AslDefinition, LintDiagnostic } from '../src/types';

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'),
    ) as AslDefinition;
}

function codes(diagnostics: LintDiagnostic[]): string[] {
    return diagnostics.map((diagnostic) => diagnostic.code);
}

describe('lintAsl', () => {
    it.each(['simple', 'choice', 'parallel', 'map', 'distributed-map', 'jsonata', 'jsonata-io', 'jsonpath', 'variables', 'error-handling', 'retry'])(
        'reports nothing for the %s fixture',
        (name) => {
            expect(lintAsl({ definition: loadFixture(name) })).toEqual([]);
        },
    );

    it('returns every diagnostic with the alphabetised shape', () => {
        const [diagnostic] = lintAsl({
            definition: { StartAt: 'A', States: { A: { Next: 'Gone', Type: 'Pass' } } },
        });

        expect(Object.keys(diagnostic)).toEqual(['code', 'message', 'path', 'severity']);
        expect(diagnostic).toEqual({
            code: 'dangling-transition',
            message: 'State "A": Next references non-existent state "Gone"',
            path: '/States/A/Next',
            severity: 'error',
        });
    });

    it('does not throw on invalid JSON and reports it instead', () => {
        const diagnostics = lintAsl({ definition: '{ not json' });

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ code: 'invalid-json', path: '', severity: 'error' });
    });

    it('keeps reporting after a structural fault instead of stopping at the first', () => {
        const definition = {
            StartAt: 'A',
            States: {
                A: { Next: 'Gone', Type: 'Pass' },
                B: { Type: 'Task' },
                C: { Type: 'Nope' },
            },
        };

        expect(() => validateAsl({ definition })).toThrow(AslValidationError);
        expect(codes(lintAsl({ definition: definition as unknown as AslDefinition }))).toEqual([
            'dangling-transition',
            'missing-transition',
            'invalid-state-type',
            'unreachable-state',
            'unreachable-state',
        ]);
    });

    it('mirrors the validateAsl message for every structural error', () => {
        const cases: unknown[] = [
            null,
            { States: { A: { End: true, Type: 'Pass' } } },
            { StartAt: '', States: { A: { End: true, Type: 'Pass' } } },
            { StartAt: 'A' },
            { StartAt: 'A', States: {} },
            { StartAt: 'Missing', States: { A: { End: true, Type: 'Pass' } } },
            { StartAt: 'A', States: { A: null } },
            { StartAt: 'A', States: { A: { End: true } } },
            { StartAt: 'A', States: { A: { End: true, Type: 'Pass', Next: 5 } } },
            { StartAt: 'A', States: { A: { Choices: 'x', Type: 'Choice' } } },
            {
                StartAt: 'A',
                States: { A: { Choices: [{ NumericEquals: 1, Variable: '$.a' }], Type: 'Choice' } },
            },
            {
                StartAt: 'A',
                States: {
                    A: { Catch: [{ ErrorEquals: ['States.ALL'] }], End: true, Resource: 'arn:a', Type: 'Task' },
                },
            },
            { StartAt: 'A', States: { A: { Branches: {}, End: true, Type: 'Parallel' } } },
            {
                StartAt: 'A',
                States: {
                    A: {
                        Branches: [{ StartAt: 'B', States: { B: { Next: 'Nope', Type: 'Pass' } } }],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            },
        ];

        for (const definition of cases) {
            let thrown: unknown;
            try {
                validateAsl({ definition });
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(AslValidationError);
            const diagnostics = lintAsl({ definition: definition as AslDefinition });
            expect(diagnostics[0]?.severity).toBe('error');
            expect(diagnostics[0]?.message).toBe((thrown as Error).message);
        }
    });

    it('flags a Choice rule with no Next', () => {
        expect(lintAsl({ definition: loadFixture('invalid/choice-rule-missing-next') })).toEqual([
            {
                code: 'missing-transition',
                message: 'State "C": Choices[0] must have "Next"',
                path: '/States/C/Choices/0/Next',
                severity: 'error',
            },
        ]);
    });

    it('flags a Catch entry with no Next, including inside a Parallel branch', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        Branches: [
                            {
                                StartAt: 'T',
                                States: {
                                    T: {
                                        Catch: [{ ErrorEquals: ['States.ALL'] }],
                                        End: true,
                                        Resource: 'arn:t',
                                        Type: 'Task',
                                    },
                                },
                            },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            },
        });

        expect(diagnostics).toEqual([
            {
                code: 'missing-transition',
                message: 'Parallel state "Fan" branch 1: State "T": Catch[0] must have "Next"',
                path: '/States/Fan/Branches/0/States/T/Catch/0/Next',
                severity: 'error',
            },
        ]);
    });

    it('flags unreachable states per scope', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'A',
                States: {
                    A: { End: true, Type: 'Pass' },
                    Orphan: { End: true, Type: 'Pass' },
                    Fan: {
                        Branches: [
                            {
                                StartAt: 'X',
                                States: {
                                    X: { End: true, Type: 'Pass' },
                                    Y: { End: true, Type: 'Pass' },
                                },
                            },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            },
        });

        expect(diagnostics.filter((diagnostic) => diagnostic.code === 'unreachable-state')).toEqual([
            {
                code: 'unreachable-state',
                message: 'State "Orphan" is unreachable from StartAt "A"',
                path: '/States/Orphan',
                severity: 'warning',
            },
            {
                code: 'unreachable-state',
                message: 'State "Fan" is unreachable from StartAt "A"',
                path: '/States/Fan',
                severity: 'warning',
            },
            {
                code: 'unreachable-state',
                message: 'Parallel state "Fan" branch 1: State "Y" is unreachable from StartAt "X"',
                path: '/States/Fan/Branches/0/States/Y',
                severity: 'warning',
            },
        ]);
    });

    it('follows Choices, Default and Catch when computing reachability', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'Pick',
                States: {
                    Pick: {
                        Choices: [{ Next: 'Yes', StringEquals: 'y', Variable: '$.x' }],
                        Default: 'No',
                        Type: 'Choice',
                    },
                    Yes: {
                        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Recover' }],
                        End: true,
                        Resource: 'arn:y',
                        Type: 'Task',
                    },
                    No: { End: true, Type: 'Pass' },
                    Recover: { End: true, Type: 'Pass' },
                },
            },
        });

        expect(diagnostics).toEqual([]);
    });

    it('warns on a Choice without a Default', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'Pick',
                States: {
                    Pick: { Choices: [{ Next: 'A', StringEquals: 'y', Variable: '$.x' }], Type: 'Choice' },
                    A: { End: true, Type: 'Pass' },
                },
            },
        });

        expect(diagnostics).toEqual([
            {
                code: 'choice-without-default',
                message: 'Choice state "Pick" has no Default; an input matching no rule fails the execution',
                path: '/States/Pick',
                severity: 'warning',
            },
        ]);
    });

    it('warns on a state name reused in another scope, pointing at the first use', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'Validate',
                States: {
                    Validate: { Next: 'Fan', Type: 'Pass' },
                    Fan: {
                        Branches: [
                            { StartAt: 'Validate', States: { Validate: { End: true, Type: 'Pass' } } },
                            { StartAt: 'Validate', States: { Validate: { End: true, Type: 'Pass' } } },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            },
        });

        expect(diagnostics).toEqual([
            {
                code: 'duplicate-state-name',
                message: 'Parallel state "Fan" branch 1: State name "Validate" is also used at /States/Validate',
                path: '/States/Fan/Branches/0/States/Validate',
                severity: 'warning',
            },
            {
                code: 'duplicate-state-name',
                message: 'Parallel state "Fan" branch 2: State name "Validate" is also used at /States/Validate',
                path: '/States/Fan/Branches/1/States/Validate',
                severity: 'warning',
            },
        ]);
    });

    it('errors on End together with Next', () => {
        const diagnostics = lintAsl({
            definition: { StartAt: 'A', States: { A: { End: true, Next: 'A', Type: 'Pass' } } },
        });

        expect(diagnostics).toEqual([
            {
                code: 'end-with-next',
                message: 'State "A" sets both "End: true" and "Next"',
                path: '/States/A/Next',
                severity: 'error',
            },
        ]);
    });

    it('errors on Retry or Catch on a state type that does not support them', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'W',
                States: {
                    W: { Catch: [{ ErrorEquals: ['States.ALL'], Next: 'P' }], Next: 'P', Retry: [], Seconds: 1, Type: 'Wait' },
                    P: { End: true, Type: 'Pass' },
                    T: { End: true, Resource: 'arn:t', Retry: [], Type: 'Task' },
                },
            },
        });

        expect(codes(diagnostics)).toEqual(['unsupported-retry-catch', 'unsupported-retry-catch', 'unreachable-state']);
        expect(diagnostics[0]).toMatchObject({ path: '/States/W/Retry', severity: 'error' });
        expect(diagnostics[1]).toMatchObject({ path: '/States/W/Catch', severity: 'error' });
    });

    describe('query-language-mismatch', () => {
        it('flags JSONPath-only fields in a JSONata state, by declared mode', () => {
            const diagnostics = lintAsl({
                definition: {
                    QueryLanguage: 'JSONata',
                    StartAt: 'A',
                    States: {
                        A: { InputPath: '$.x', Next: 'B', ResultPath: '$.y', Type: 'Pass' },
                        B: { End: true, Resource: 'arn:b', ResultSelector: {}, Type: 'Task' },
                    },
                },
            });

            expect(diagnostics.map(({ code, path }) => `${code} ${path}`)).toEqual([
                'query-language-mismatch /States/A/InputPath',
                'query-language-mismatch /States/A/ResultPath',
                'query-language-mismatch /States/B/ResultSelector',
            ]);
            expect(diagnostics[0]).toMatchObject({
                message: 'State "A" is in JSONata mode but uses the JSONPath-only field "InputPath"',
                severity: 'error',
            });
        });

        it('flags JSONata-only fields in a JSONPath state', () => {
            const diagnostics = lintAsl({
                definition: {
                    StartAt: 'A',
                    States: {
                        A: { Arguments: { x: 1 }, End: true, Output: '{% $states.result %}', Resource: 'arn:a', Type: 'Task' },
                    },
                },
            });

            expect(diagnostics.map(({ path }) => path)).toEqual(['/States/A/Arguments', '/States/A/Output']);
        });

        it('honours a per-state JSONata override inside a JSONPath machine', () => {
            const diagnostics = lintAsl({
                definition: {
                    StartAt: 'A',
                    States: {
                        A: { End: true, InputPath: '$.x', Output: '{% 1 %}', QueryLanguage: 'JSONata', Type: 'Pass' },
                    },
                },
            });

            expect(diagnostics.map(({ path }) => path)).toEqual(['/States/A/InputPath']);
        });

        it('rejects a per-state JSONPath override inside a JSONata machine', () => {
            const diagnostics = lintAsl({
                definition: {
                    QueryLanguage: 'JSONata',
                    StartAt: 'A',
                    States: {
                        A: { End: true, InputPath: '$.x', QueryLanguage: 'JSONPath', Type: 'Pass' },
                    },
                },
            });

            expect(diagnostics).toEqual([
                {
                    code: 'query-language-mismatch',
                    message:
                        'State "A" sets QueryLanguage to JSONPath inside a JSONata state machine; only JSONPath machines may override per state',
                    path: '/States/A/QueryLanguage',
                    severity: 'error',
                },
            ]);
        });

        it('does not judge by the shape of a value', () => {
            // A JSONPath literal that happens to look like a JSONata expression is fine.
            const diagnostics = lintAsl({
                definition: {
                    StartAt: 'A',
                    States: { A: { End: true, Parameters: { x: '{% looks like jsonata %}' }, Type: 'Pass' } },
                },
            });

            expect(diagnostics).toEqual([]);
        });

        it('flags Variable-style Choice rules in a JSONata Choice and Condition rules in a JSONPath one', () => {
            const jsonata = lintAsl({
                definition: {
                    QueryLanguage: 'JSONata',
                    StartAt: 'Pick',
                    States: {
                        Pick: {
                            Choices: [{ Next: 'A', StringEquals: 'y', Variable: '$.x' }],
                            Default: 'A',
                            Type: 'Choice',
                        },
                        A: { End: true, Type: 'Pass' },
                    },
                },
            });
            const jsonpath = lintAsl({
                definition: {
                    StartAt: 'Pick',
                    States: {
                        Pick: { Choices: [{ Condition: '{% true %}', Next: 'A' }], Default: 'A', Type: 'Choice' },
                        A: { End: true, Type: 'Pass' },
                    },
                },
            });

            expect(jsonata).toEqual([
                {
                    code: 'query-language-mismatch',
                    message: 'State "Pick" is in JSONata mode but Choices[0] uses the JSONPath-only field "Variable"',
                    path: '/States/Pick/Choices/0/Variable',
                    severity: 'error',
                },
            ]);
            expect(jsonpath.map(({ path }) => path)).toEqual(['/States/Pick/Choices/0/Condition']);
        });
    });

    it('escapes "/" and "~" in state names inside the JSON Pointer', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'A',
                States: {
                    A: { End: true, Type: 'Pass' },
                    'a/b~c': { End: true, Type: 'Pass' },
                },
            },
        });

        expect(diagnostics.map(({ path }) => path)).toEqual(['/States/a~1b~0c']);
    });

    it('points nested Map diagnostics at the processor field that was used', () => {
        const legacy = lintAsl({
            definition: {
                StartAt: 'M',
                States: {
                    M: {
                        End: true,
                        Iterator: { StartAt: 'X', States: { X: { End: true, Type: 'Pass' }, Y: { End: true, Type: 'Pass' } } },
                        Type: 'Map',
                    },
                },
            },
        });
        const modern = lintAsl({
            definition: {
                StartAt: 'M',
                States: {
                    M: {
                        End: true,
                        ItemProcessor: { StartAt: 'X', States: { X: { End: true, Type: 'Pass' }, Y: { End: true, Type: 'Pass' } } },
                        Type: 'Map',
                    },
                },
            },
        });

        expect(legacy.map(({ path }) => path)).toEqual(['/States/M/Iterator/States/Y']);
        expect(modern.map(({ path }) => path)).toEqual(['/States/M/ItemProcessor/States/Y']);
    });
});

describe('structural rules', () => {
    const pass = { End: true, Type: 'Pass' } as const;
    const rule = { BooleanEquals: true, Next: 'A', Variable: '$.ok' };

    function error(code: LintDiagnostic['code'], message: string, path: string): LintDiagnostic {
        return { code, message, path, severity: 'error' };
    }

    it('errors on a Choice with no Choices or an empty one', () => {
        const missing = lintAsl({
            definition: { StartAt: 'C', States: { A: pass, C: { Default: 'A', Type: 'Choice' } } } as AslDefinition,
        });
        const empty = lintAsl({
            definition: { StartAt: 'C', States: { A: pass, C: { Choices: [], Default: 'A', Type: 'Choice' } } } as AslDefinition,
        });
        const message = 'Choice state "C" must have a non-empty "Choices" array';

        expect(missing).toEqual([error('choice-without-choices', message, '/States/C')]);
        expect(empty).toEqual([error('choice-without-choices', message, '/States/C/Choices')]);
        expect(
            lintAsl({
                definition: { StartAt: 'C', States: { A: pass, C: { Choices: [rule], Default: 'A', Type: 'Choice' } } } as AslDefinition,
            }),
        ).toEqual([]);
    });

    it('errors on Next or End on a Choice, Succeed or Fail state', () => {
        const succeed = lintAsl({
            definition: { StartAt: 'S', States: { A: pass, S: { Next: 'A', Type: 'Succeed' } } } as AslDefinition,
        });
        const fail = lintAsl({
            definition: { StartAt: 'F', States: { F: { End: true, Type: 'Fail' } } } as AslDefinition,
        });
        const choice = lintAsl({
            definition: {
                StartAt: 'C',
                States: { A: pass, C: { Choices: [rule], Default: 'A', End: true, Next: 'A', Type: 'Choice' } },
            } as AslDefinition,
        });

        expect(succeed).toEqual([
            error('unsupported-transition', 'State "S" (Type: Succeed) does not support "Next"; it is a terminal state', '/States/S/Next'),
        ]);
        expect(fail).toEqual([
            error('unsupported-transition', 'State "F" (Type: Fail) does not support "End"; it is a terminal state', '/States/F/End'),
        ]);
        expect(choice).toEqual([
            error('unsupported-transition', 'State "C" (Type: Choice) does not support "Next"; it transitions through Choices and Default', '/States/C/Next'),
            error('unsupported-transition', 'State "C" (Type: Choice) does not support "End"; it transitions through Choices and Default', '/States/C/End'),
        ]);
        expect(
            lintAsl({ definition: { StartAt: 'S', States: { S: { Type: 'Succeed' } } } as AslDefinition }),
        ).toEqual([]);
        expect(lintAsl({ definition: { StartAt: 'F', States: { F: { Type: 'Fail' } } } as AslDefinition })).toEqual([]);
    });

    it('errors on a Wait with no duration', () => {
        const wait = (extra: Record<string, unknown>) =>
            ({ StartAt: 'W', States: { W: { End: true, Type: 'Wait', ...extra } } }) as AslDefinition;

        expect(lintAsl({ definition: wait({}) })).toEqual([
            error(
                'wait-without-duration',
                'Wait state "W" must set exactly one of Seconds, SecondsPath, Timestamp or TimestampPath',
                '/States/W',
            ),
        ]);
        expect(lintAsl({ definition: wait({ Seconds: 1 }) })).toEqual([]);
        expect(
            lintAsl({
                definition: { ...wait({ Timestamp: '{% $now() %}' }), QueryLanguage: 'JSONata' } as AslDefinition,
            }),
        ).toEqual([]);
    });

    it('errors on a Wait with more than one duration', () => {
        const diagnostics = lintAsl({
            definition: {
                StartAt: 'W',
                States: { W: { End: true, Seconds: 1, TimestampPath: '$.t', Type: 'Wait' } },
            } as AslDefinition,
        });

        expect(diagnostics).toEqual([
            error(
                'wait-multiple-durations',
                'Wait state "W" sets Seconds, TimestampPath; exactly one duration field is allowed',
                '/States/W/TimestampPath',
            ),
        ]);
    });

    it('errors on a Fail with both a literal and a path field', () => {
        const fail = (extra: Record<string, unknown>) =>
            ({ StartAt: 'F', States: { F: { Type: 'Fail', ...extra } } }) as AslDefinition;

        expect(
            lintAsl({ definition: fail({ Cause: 'c', CausePath: '$.c', Error: 'e', ErrorPath: '$.e' }) }),
        ).toEqual([
            error('fail-conflicting-fields', 'Fail state "F" sets both "Error" and "ErrorPath"', '/States/F/ErrorPath'),
            error('fail-conflicting-fields', 'Fail state "F" sets both "Cause" and "CausePath"', '/States/F/CausePath'),
        ]);
        expect(lintAsl({ definition: fail({ CausePath: '$.c', Error: 'e' }) })).toEqual([]);
    });

    it('errors on a state name over 80 characters, counting code points', () => {
        const only = (name: string) =>
            ({ StartAt: name, States: { [name]: { End: true, Type: 'Pass' } } }) as AslDefinition;
        const long = 'x'.repeat(81);

        expect(lintAsl({ definition: only(long) })).toEqual([
            error(
                'state-name-too-long',
                `State name "${long}" is 81 characters long; Step Functions allows at most 80`,
                `/States/${long}`,
            ),
        ]);
        expect(lintAsl({ definition: only('x'.repeat(80)) })).toEqual([]);
        expect(lintAsl({ definition: only('😀'.repeat(80)) })).toEqual([]);

        const nested = lintAsl({
            definition: {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        Branches: [{ StartAt: long, States: { [long]: { End: true, Type: 'Pass' } } }],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            } as AslDefinition,
        });
        expect(nested).toEqual([
            error(
                'state-name-too-long',
                `Parallel state "Fan" branch 1: State name "${long}" is 81 characters long; Step Functions allows at most 80`,
                `/States/Fan/Branches/0/States/${long}`,
            ),
        ]);
    });
});
