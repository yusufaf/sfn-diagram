import { describe, it, expect } from 'vitest';
import { parseAsl, validateAsl, AslValidationError } from '../src/AslParser';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';
import { applyCollapse } from '../src/graph';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

describe('AslParser', () => {
    describe('Simple state machines', () => {
        it('should parse a simple linear state machine', () => {
            const asl = loadFixture('simple');
            const result = parseAsl({ definition: asl });

            expect(result.nodes).toHaveLength(3);
            expect(result.edges).toHaveLength(2);

            // Check nodes
            expect(result.nodes.find((n) => n.id === 'Start')).toBeDefined();
            expect(result.nodes.find((n) => n.id === 'Process')).toBeDefined();
            expect(result.nodes.find((n) => n.id === 'End')).toBeDefined();

            // Check edges
            expect(result.edges.find((e) => e.from === 'Start' && e.to === 'Process')).toBeDefined();
            expect(result.edges.find((e) => e.from === 'Process' && e.to === 'End')).toBeDefined();
        });

        it('should correctly identify state types', () => {
            const asl = loadFixture('simple');
            const result = parseAsl({ definition: asl });

            const startNode = result.nodes.find((n) => n.id === 'Start');
            const processNode = result.nodes.find((n) => n.id === 'Process');
            const endNode = result.nodes.find((n) => n.id === 'End');

            expect(startNode?.type).toBe('Pass');
            expect(processNode?.type).toBe('Task');
            expect(endNode?.type).toBe('Succeed');
        });

        it('should honor the includeComments option for node labels', () => {
            const asl: AslDefinition = {
                StartAt: 'DoWork',
                States: {
                    DoWork: { Type: 'Pass', Comment: 'Human readable step', End: true },
                },
            };

            // Default (includeComments defaults to true): Comment is used as the label
            const withComments = parseAsl({ definition: asl });
            expect(withComments.nodes.find((node) => node.id === 'DoWork')?.label).toBe(
                'Human readable step'
            );

            // Disabled: the canonical state name is used instead
            const withoutComments = parseAsl({ definition: asl, options: { includeComments: false } });
            expect(withoutComments.nodes.find((node) => node.id === 'DoWork')?.label).toBe('DoWork');
        });
    });

    describe('Choice states', () => {
        it('should parse Choice state with multiple branches', () => {
            const asl = loadFixture('choice');
            const result = parseAsl({ definition: asl });

            expect(result.nodes).toHaveLength(5);

            // Check for choice node
            const choiceNode = result.nodes.find((n) => n.id === 'CheckValue');
            expect(choiceNode?.type).toBe('Choice');

            // Check edges from choice state
            const choiceEdges = result.edges.filter((e) => e.from === 'CheckValue');
            expect(choiceEdges).toHaveLength(3); // 2 choices + 1 default

            // Check edge labels
            expect(choiceEdges.some((e) => e.label?.includes('>'))).toBe(true);
            expect(choiceEdges.some((e) => e.label?.includes('Default'))).toBe(true);
        });

        it('should build readable labels for a range of comparison operators', () => {
            const asl = loadFixture('choice-operators');
            const result = parseAsl({ definition: asl });

            const labels = result.edges
                .filter((edge) => edge.from === 'Route' && edge.type === 'choice')
                .map((edge) => edge.label);

            expect(labels).toContain('$.status == "APPROVED"');
            expect(labels).toContain('$.score >= 90');
            expect(labels).toContain('$.age >= 18 AND $.country == "US"');
            expect(labels).toContain('NOT ($.email is present)');

            // None should fall back to the generic placeholder
            expect(labels).not.toContain('Condition');
        });

        it('should label JSONata Choice conditions from the Condition field', () => {
            const asl = loadFixture('jsonata');
            const result = parseAsl({ definition: asl });

            const labels = result.edges
                .filter((edge) => edge.from === 'Classify' && edge.type === 'choice')
                .map((edge) => edge.label);

            // JSONata delimiters are stripped and the expression is used as-is
            expect(labels).toContain('$states.input.score >= 0.8');
            expect(labels).toContain('$states.input.score < 0.5');
            // A boolean catch-all Condition renders instead of the generic placeholder
            expect(labels).toContain('true');
            expect(labels).not.toContain('Condition');
        });
    });

    describe('Parallel states', () => {
        it('should parse Parallel state with branches', () => {
            const asl = loadFixture('parallel');
            const result = parseAsl({ definition: asl });

            // ParallelExecution and FinalState are top-level
            // Branch states are nested, so check for at least 2 nodes
            expect(result.nodes.length).toBeGreaterThanOrEqual(2);

            const parallelNode = result.nodes.find((n) => n.id === 'ParallelExecution');
            expect(parallelNode?.type).toBe('Parallel');
            expect(parallelNode?.isContainer).toBe(true);

            const finalNode = result.nodes.find((n) => n.id === 'FinalState');
            expect(finalNode?.type).toBe('Succeed');

            // Check edges from branch end markers to final (not from Parallel container directly)
            const edgesToFinal = result.edges.filter((edge) => edge.to === 'FinalState');
            expect(edgesToFinal.length).toBeGreaterThan(0);
            expect(edgesToFinal.some((edge) => edge.from.includes('__branch'))).toBe(true);
        });
    });

    describe('Map states', () => {
        it('should parse a Map state as a container with iterator children', () => {
            const asl = loadFixture('map');
            const result = parseAsl({ definition: asl });

            const mapNode = result.nodes.find((node) => node.id === 'ProcessItems');
            expect(mapNode?.type).toBe('Map');
            expect(mapNode?.isContainer).toBe(true);

            // Iterator states and the virtual end marker are tracked as children
            expect(mapNode?.children).toContain('ProcessItem');
            expect(mapNode?.children).toContain('ValidateItem');
            expect(mapNode?.children).toContain('ProcessItems__iterator__end');
        });

        it('should extract iterator states as their own nodes', () => {
            const asl = loadFixture('map');
            const result = parseAsl({ definition: asl });

            expect(result.nodes.find((node) => node.id === 'ProcessItem')?.type).toBe('Task');
            expect(result.nodes.find((node) => node.id === 'ValidateItem')?.type).toBe('Pass');

            const endMarker = result.nodes.find(
                (node) => node.id === 'ProcessItems__iterator__end'
            );
            expect(endMarker?.type).toBe('IteratorEnd');
            expect(endMarker?.isContainer).toBe(false);
        });

        it('should extract edges within the iterator and to the end marker', () => {
            const asl = loadFixture('map');
            const result = parseAsl({ definition: asl });

            // Internal iterator transition
            expect(
                result.edges.some(
                    (edge) => edge.from === 'ProcessItem' && edge.to === 'ValidateItem'
                )
            ).toBe(true);

            // Terminal iterator state connects to the virtual end marker
            expect(
                result.edges.some(
                    (edge) =>
                        edge.from === 'ValidateItem' &&
                        edge.to === 'ProcessItems__iterator__end'
                )
            ).toBe(true);

            // The end marker connects to the Map's Next state (not the container directly)
            expect(
                result.edges.some(
                    (edge) =>
                        edge.from === 'ProcessItems__iterator__end' && edge.to === 'Done'
                )
            ).toBe(true);
        });

        it('should recurse into nested Parallel/Map containers', () => {
            const asl = loadFixture('nested-map');
            const result = parseAsl({ definition: asl });

            const parallelNode = result.nodes.find((node) => node.id === 'FanOut');
            expect(parallelNode?.isContainer).toBe(true);

            const mapNode = result.nodes.find((node) => node.id === 'ProcessBatch');
            expect(mapNode?.type).toBe('Map');
            expect(mapNode?.isContainer).toBe(true);

            // The deeply-nested iterator task is still extracted as a node
            expect(result.nodes.find((node) => node.id === 'HandleRecord')?.type).toBe('Task');

            // And its edge to the nested Map's end marker exists
            expect(
                result.edges.some(
                    (edge) =>
                        edge.from === 'HandleRecord' &&
                        edge.to === 'ProcessBatch__iterator__end'
                )
            ).toBe(true);
        });

        it('should parse a Distributed Map using ItemProcessor like a legacy Iterator', () => {
            const asl = loadFixture('distributed-map');
            const result = parseAsl({ definition: asl });

            const mapNode = result.nodes.find((node) => node.id === 'ProcessItems');
            expect(mapNode?.type).toBe('Map');
            expect(mapNode?.isContainer).toBe(true);

            // ItemProcessor states are extracted as nodes and tracked as children
            expect(result.nodes.find((node) => node.id === 'ProcessItem')?.type).toBe('Task');
            expect(mapNode?.children).toContain('ProcessItem');
            expect(mapNode?.children).toContain('ValidateItem');
            expect(mapNode?.children).toContain('ProcessItems__iterator__end');

            // Internal transition and end-marker wiring match the Iterator behaviour
            expect(
                result.edges.some(
                    (edge) => edge.from === 'ProcessItem' && edge.to === 'ValidateItem'
                )
            ).toBe(true);
            expect(
                result.edges.some(
                    (edge) =>
                        edge.from === 'ProcessItems__iterator__end' && edge.to === 'Done'
                )
            ).toBe(true);
        });
    });

    describe('Retry policies', () => {
        it('should emit a self-loop retry edge summarizing all retriers', () => {
            const asl = loadFixture('retry');
            const result = parseAsl({ definition: asl });

            const retryEdges = result.edges.filter((edge) => edge.type === 'retry');
            expect(retryEdges).toHaveLength(1);

            const retry = retryEdges[0];
            expect(retry.from).toBe('Submit');
            expect(retry.to).toBe('Submit'); // self-loop
            expect(retry.visualOnly).toBe(true); // excluded from dagre ranking
            expect(retry.label).toBe('↻ States.Timeout (4x); States.ALL (2x)');
        });

        it('should default MaxAttempts to 3 when omitted', () => {
            const asl: AslDefinition = {
                StartAt: 'Work',
                States: {
                    Work: {
                        Type: 'Task',
                        Resource: 'arn:aws:lambda:::function:fn',
                        Retry: [{ ErrorEquals: ['States.ALL'] }],
                        End: true,
                    },
                },
            };
            const result = parseAsl({ definition: asl });
            const retry = result.edges.find((edge) => edge.type === 'retry');
            expect(retry?.label).toBe('↻ States.ALL (3x)');
        });
    });

    describe('Error handling', () => {
        it('should parse Catch blocks as error edges', () => {
            const asl = loadFixture('error-handling');
            const result = parseAsl({ definition: asl });

            const errorEdges = result.edges.filter((e) => e.type === 'error');
            expect(errorEdges.length).toBeGreaterThan(0);

            // Check error edge labels
            const taskFailedEdge = errorEdges.find((e) => e.label?.includes('TaskFailed'));
            expect(taskFailedEdge).toBeDefined();

            const allErrorsEdge = errorEdges.find((e) => e.label?.includes('ALL'));
            expect(allErrorsEdge).toBeDefined();
        });
    });

    describe('Wait and Fail states', () => {
        it('should parse Wait state', () => {
            const asl = loadFixture('wait-fail');
            const result = parseAsl({ definition: asl });

            const waitNode = result.nodes.find((n) => n.id === 'WaitState');
            expect(waitNode?.type).toBe('Wait');
        });

        it('should parse Fail state', () => {
            const asl = loadFixture('wait-fail');
            const result = parseAsl({ definition: asl });

            const failNode = result.nodes.find((n) => n.id === 'FailState');
            expect(failNode?.type).toBe('Fail');
        });
    });

    describe('Edge cases', () => {
        it('should handle minimal state machine', () => {
            const asl: AslDefinition = {
                StartAt: 'OnlyState',
                States: {
                    OnlyState: {
                        Type: 'Succeed',
                    },
                },
            };

            const result = parseAsl({ definition: asl });
            expect(result.nodes).toHaveLength(1);
            expect(result.edges).toHaveLength(0);
        });

        it('should preserve state comments as labels', () => {
            const asl = loadFixture('simple');
            const result = parseAsl({ definition: asl });

            const startNode = result.nodes.find((n) => n.id === 'Start');
            expect(startNode?.label).toBe('Starting state');
        });
    });

    describe('ASL Validation', () => {
        describe('Basic structure validation', () => {
            it('should throw on null definition', () => {
                expect(() => validateAsl({ definition: null })).toThrow(AslValidationError);
                expect(() => validateAsl({ definition: null })).toThrow('must be a non-null object');
            });

            it('should throw on non-object definition', () => {
                expect(() => validateAsl({ definition: 'not an object' })).toThrow(AslValidationError);
                expect(() => validateAsl({ definition: 123 })).toThrow(AslValidationError);
            });

            it('should throw when StartAt is missing', () => {
                const invalid = { States: { Foo: { Type: 'Pass', End: true } } };
                expect(() => validateAsl({ definition: invalid })).toThrow('missing required field: StartAt');
            });

            it('should throw when StartAt is empty string', () => {
                const invalid = { StartAt: '', States: { Foo: { Type: 'Pass', End: true } } };
                expect(() => validateAsl({ definition: invalid })).toThrow('non-empty string');
            });

            it('should throw when States is missing', () => {
                const invalid = { StartAt: 'Foo' };
                expect(() => validateAsl({ definition: invalid })).toThrow('missing required field: States');
            });

            it('should throw when States is empty', () => {
                const invalid = { StartAt: 'Foo', States: {} };
                expect(() => validateAsl({ definition: invalid })).toThrow('cannot be empty');
            });
        });

        describe('StartAt reference validation', () => {
            it('should throw when StartAt references non-existent state', () => {
                const invalid = {
                    StartAt: 'NonExistent',
                    States: {
                        RealState: { Type: 'Succeed' },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('non-existent state: "NonExistent"');
                expect(() => validateAsl({ definition: invalid })).toThrow('Available states: RealState');
            });
        });

        describe('State type validation', () => {
            it('should throw when state Type is missing', () => {
                const invalid = {
                    StartAt: 'BadState',
                    States: {
                        BadState: { End: true },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('missing required field: Type');
            });

            it('should throw on invalid state Type', () => {
                const invalid = {
                    StartAt: 'BadState',
                    States: {
                        BadState: { Type: 'InvalidType', End: true },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('invalid Type: "InvalidType"');
                expect(() => validateAsl({ definition: invalid })).toThrow('Valid types:');
            });

            it('should accept all valid state types', () => {
                const validTypes = ['Pass', 'Task', 'Choice', 'Wait', 'Succeed', 'Fail', 'Parallel', 'Map'];
                for (const type of validTypes) {
                    const definition = {
                        StartAt: 'TestState',
                        States: {
                            TestState: type === 'Choice'
                                ? { Type: type, Choices: [{ Variable: '$.x', NumericEquals: 1, Next: 'TestState' }], Default: 'TestState' }
                                : type === 'Parallel'
                                    ? { Type: type, Branches: [{ StartAt: 'Inner', States: { Inner: { Type: 'Pass', End: true } } }], End: true }
                                    : type === 'Map'
                                        ? { Type: type, Iterator: { StartAt: 'Inner', States: { Inner: { Type: 'Pass', End: true } } }, End: true }
                                        : { Type: type, End: true },
                        },
                    };
                    expect(() => validateAsl({ definition })).not.toThrow();
                }
            });
        });

        describe('State transition validation', () => {
            it('should throw when Next references non-existent state', () => {
                const invalid = {
                    StartAt: 'First',
                    States: {
                        First: { Type: 'Pass', Next: 'NonExistent' },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('Next references non-existent state "NonExistent"');
            });

            it('should throw when Default references non-existent state', () => {
                const invalid = {
                    StartAt: 'ChoiceState',
                    States: {
                        ChoiceState: {
                            Type: 'Choice',
                            Choices: [{ Variable: '$.x', NumericEquals: 1, Next: 'ChoiceState' }],
                            Default: 'NonExistent',
                        },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('Default references non-existent state "NonExistent"');
            });

            it('should throw when Choice.Next references non-existent state', () => {
                const invalid = {
                    StartAt: 'ChoiceState',
                    States: {
                        ChoiceState: {
                            Type: 'Choice',
                            Choices: [{ Variable: '$.x', NumericEquals: 1, Next: 'BadTarget' }],
                            Default: 'ChoiceState',
                        },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('Choices[0].Next references non-existent state "BadTarget"');
            });

            it('should throw when Catch.Next references non-existent state', () => {
                const invalid = {
                    StartAt: 'TaskState',
                    States: {
                        TaskState: {
                            Type: 'Task',
                            Resource: 'arn:aws:lambda:us-east-1:123456789:function:test',
                            Catch: [{ ErrorEquals: ['States.ALL'], Next: 'NonExistentHandler' }],
                            End: true,
                        },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('Catch[0].Next references non-existent state "NonExistentHandler"');
            });
        });

        describe('Next/End requirement validation', () => {
            it('should throw when non-terminal state lacks Next and End', () => {
                const invalid = {
                    StartAt: 'PassState',
                    States: {
                        PassState: { Type: 'Pass' },
                    },
                };
                expect(() => validateAsl({ definition: invalid })).toThrow('must have either "Next" or "End: true"');
            });

            it('should not throw for terminal states without Next', () => {
                const succeedDef = {
                    StartAt: 'SucceedState',
                    States: { SucceedState: { Type: 'Succeed' } },
                };
                expect(() => validateAsl({ definition: succeedDef })).not.toThrow();

                const failDef = {
                    StartAt: 'FailState',
                    States: { FailState: { Type: 'Fail', Error: 'TestError', Cause: 'Testing' } },
                };
                expect(() => validateAsl({ definition: failDef })).not.toThrow();
            });

            it('should not throw for Choice states without Next (uses Choices/Default)', () => {
                const choiceDef = {
                    StartAt: 'ChoiceState',
                    States: {
                        ChoiceState: {
                            Type: 'Choice',
                            Choices: [{ Variable: '$.x', NumericEquals: 1, Next: 'ChoiceState' }],
                            Default: 'ChoiceState',
                        },
                    },
                };
                expect(() => validateAsl({ definition: choiceDef })).not.toThrow();
            });
        });

        describe('Nested scope validation', () => {
            const parallelWith = (branch: unknown): unknown => ({
                StartAt: 'Fanout',
                States: {
                    Fanout: { Type: 'Parallel', Branches: [branch], End: true },
                },
            });

            it('rejects a dangling Next inside a Parallel branch', () => {
                const definition = parallelWith({
                    StartAt: 'Work',
                    States: { Work: { Type: 'Pass', Next: 'Nowhere' } },
                });

                expect(() => validateAsl({ definition })).toThrow(AslValidationError);
                expect(() => validateAsl({ definition })).toThrow(
                    'Parallel state "Fanout" branch 1: State "Work": Next references non-existent state "Nowhere"',
                );
            });

            it('rejects a dangling Next inside a Map processor', () => {
                const definition = {
                    StartAt: 'Each',
                    States: {
                        Each: {
                            Type: 'Map',
                            End: true,
                            ItemProcessor: {
                                StartAt: 'Handle',
                                States: { Handle: { Type: 'Pass', Next: 'Gone' } },
                            },
                        },
                    },
                };

                expect(() => validateAsl({ definition })).toThrow(
                    'Map state "Each" processor: State "Handle": Next references non-existent state "Gone"',
                );
            });

            it('reports a branch with no States as a validation error, not a TypeError', () => {
                const definition = parallelWith({ StartAt: 'Work' });

                // Previously this slipped past validation and blew up inside
                // extractStatesRecursively converting undefined to an object.
                expect(() => validateAsl({ definition })).toThrow(AslValidationError);
                expect(() => parseAsl({ definition: definition as AslDefinition })).toThrow(
                    AslValidationError,
                );
            });

            it('rejects a branch whose StartAt names no state in that branch', () => {
                const definition = parallelWith({
                    StartAt: 'Missing',
                    States: { Work: { Type: 'Pass', End: true } },
                });

                expect(() => validateAsl({ definition })).toThrow(
                    'Parallel state "Fanout" branch 1: StartAt references non-existent state: "Missing"',
                );
            });

            it('names the offending branch by its index', () => {
                const definition = {
                    StartAt: 'Fanout',
                    States: {
                        Fanout: {
                            Type: 'Parallel',
                            End: true,
                            Branches: [
                                { StartAt: 'Ok', States: { Ok: { Type: 'Pass', End: true } } },
                                {
                                    StartAt: 'Bad',
                                    States: { Bad: { Type: 'Pass', Next: 'Nowhere' } },
                                },
                            ],
                        },
                    },
                };

                expect(() => validateAsl({ definition })).toThrow('branch 2:');
            });

            it('rejects a non-array Branches instead of crashing on forEach', () => {
                const definition = {
                    StartAt: 'Fanout',
                    States: { Fanout: { Type: 'Parallel', Branches: {}, End: true } },
                };

                expect(() => validateAsl({ definition })).toThrow(
                    'State "Fanout": Branches must be an array',
                );
            });

            it('scopes names per branch, so the same name in two branches is valid', () => {
                // ASL only requires a name to be unique within its own States block.
                const definition: AslDefinition = {
                    StartAt: 'Fanout',
                    States: {
                        Fanout: {
                            Type: 'Parallel',
                            End: true,
                            Branches: [
                                {
                                    StartAt: 'Validate',
                                    States: { Validate: { Type: 'Pass', End: true } },
                                },
                                {
                                    StartAt: 'Validate',
                                    States: { Validate: { Type: 'Pass', End: true } },
                                },
                            ],
                        },
                    },
                };

                expect(() => validateAsl({ definition })).not.toThrow();
            });

            it('does not let a branch reach a state outside its own scope', () => {
                // Cleanup exists at the root, but a branch's Next may not target it.
                const definition = {
                    StartAt: 'Fanout',
                    States: {
                        Fanout: {
                            Type: 'Parallel',
                            Next: 'Cleanup',
                            Branches: [
                                {
                                    StartAt: 'Work',
                                    States: { Work: { Type: 'Pass', Next: 'Cleanup' } },
                                },
                            ],
                        },
                        Cleanup: { Type: 'Succeed' },
                    },
                };

                expect(() => validateAsl({ definition })).toThrow(
                    'Parallel state "Fanout" branch 1: State "Work": Next references non-existent state "Cleanup"',
                );
            });

            it('validates the legacy Iterator the same as ItemProcessor', () => {
                const definition = {
                    StartAt: 'Each',
                    States: {
                        Each: {
                            Type: 'Map',
                            End: true,
                            Iterator: {
                                StartAt: 'Handle',
                                States: { Handle: { Type: 'Pass', Next: 'Gone' } },
                            },
                        },
                    },
                };

                expect(() => validateAsl({ definition })).toThrow(AslValidationError);
            });

            it('composes scope labels so a fault two levels down is unambiguous', () => {
                // The same Map name in two different branches: without composition both
                // faults report 'Map state "Each" processor' and neither says which
                // branch it is in.
                const branch = (next: string): unknown => ({
                    StartAt: 'Each',
                    States: {
                        Each: {
                            Type: 'Map',
                            End: true,
                            ItemProcessor: {
                                StartAt: 'Handle',
                                States: { Handle: { Type: 'Pass', Next: next } },
                            },
                        },
                    },
                });

                const definition = {
                    StartAt: 'Fanout',
                    States: {
                        Fanout: {
                            Type: 'Parallel',
                            End: true,
                            Branches: [branch('Handle'), branch('Nowhere')],
                        },
                    },
                };

                expect(() => validateAsl({ definition })).toThrow(
                    'Parallel state "Fanout" branch 2 > Map state "Each" processor: ' +
                        'State "Handle": Next references non-existent state "Nowhere"',
                );
            });

            it('leaves root-level messages unqualified', () => {
                const definition = {
                    StartAt: 'Work',
                    States: { Work: { Type: 'Pass', Next: 'Nowhere' } },
                };

                expect(() => validateAsl({ definition })).toThrow(
                    'State "Work": Next references non-existent state "Nowhere"',
                );
            });
        });

        describe('Integration with parseAsl', () => {
            it('should reject invalid ASL during parsing', () => {
                const invalid = {
                    StartAt: 'NonExistent',
                    States: {
                        RealState: { Type: 'Succeed' },
                    },
                };
                expect(() => parseAsl({ definition: invalid as AslDefinition })).toThrow(AslValidationError);
            });

            it('should parse valid ASL after validation', () => {
                const valid: AslDefinition = {
                    StartAt: 'MyState',
                    States: {
                        MyState: { Type: 'Succeed' },
                    },
                };
                const result = parseAsl({ definition: valid });
                expect(result.nodes).toHaveLength(1);
            });
        });
    });

    describe('edge identity', () => {
        it('gives every edge in a colliding graph a unique id', () => {
            const { edges } = parseAsl({ definition: loadFixture('parallel-edges') });

            const ids = edges.map((edge) => edge.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('distinguishes two Choice rules that share a Next', () => {
            const { edges } = parseAsl({ definition: loadFixture('parallel-edges') });

            const routeToWork = edges.filter(
                (edge) => edge.from === 'Route' && edge.to === 'Work',
            );

            expect(routeToWork).toHaveLength(2);
            expect(routeToWork.map((edge) => edge.id)).toEqual([
                'Route->Work#choice#0',
                'Route->Work#choice#1',
            ]);
            expect(routeToWork[0].label).not.toBe(routeToWork[1].label);
        });

        it('distinguishes the three self-loops on one state', () => {
            const { edges } = parseAsl({ definition: loadFixture('parallel-edges') });

            const selfLoops = edges.filter(
                (edge) => edge.from === 'Work' && edge.to === 'Work',
            );

            expect(selfLoops.map((edge) => edge.id).sort()).toEqual([
                'Work->Work#error#0',
                'Work->Work#normal#0',
                'Work->Work#retry#0',
            ]);
        });

        it('keeps ids unchanged when applyCollapse removes edges', () => {
            const parsed = parseAsl({ definition: loadFixture('parallel') });
            const idsBefore = new Set(parsed.edges.map((edge) => edge.id));

            const collapsed = applyCollapse({
                collapse: true,
                edges: parsed.edges,
                nodes: parsed.nodes,
            });

            // applyCollapse only filters — every surviving edge must still carry the exact id
            // parseAsl gave it, never a renumbered one.
            expect(collapsed.edges.length).toBeLessThan(parsed.edges.length);
            for (const edge of collapsed.edges) {
                expect(idsBefore.has(edge.id)).toBe(true);
            }
        });
    });
});
