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
