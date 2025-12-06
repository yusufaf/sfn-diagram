import { describe, it, expect } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

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
            expect(choiceEdges.some((e) => e.label?.includes('>')));
            expect(choiceEdges.some((e) => e.label?.includes('Default')));
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
});
