import { describe, it, expect } from 'vitest';
import { MermaidRenderer } from '../src/renderers';
import { parseAsl } from '../src/AslParser';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

describe('MermaidRenderer', () => {
    describe('Basic rendering', () => {
        it('should render valid Mermaid syntax', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toBeDefined();
            expect(typeof result.code).toBe('string');
            expect(result.code).toContain('stateDiagram-v2');
        });

        it('should include start state transition', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('[*] -->');
            expect(result.code).toContain('Start');
        });

        it('should include end state transition for Succeed', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('End --> [*]');
        });

        it('should include end state transition for Fail', () => {
            const asl = loadFixture('wait-fail');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('FailState --> [*]');
        });
    });

    describe('State transitions', () => {
        it('should render all transitions', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('Start --> Process');
            expect(result.code).toContain('Process --> End');
        });

        it('should include edge labels', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('Default');
        });

        it('should render retry policies as a self-transition', () => {
            const asl = loadFixture('retry');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain(
                'Submit --> Submit: ↻ States.Timeout (4x); States.ALL (2x)',
            );
        });
    });

    describe('CSS classes', () => {
        it('should apply successState class to Succeed states', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('class End successState');
        });

        it('should apply failState class to Fail states', () => {
            const asl = loadFixture('wait-fail');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('class FailState failState');
        });

        it('should apply choiceState class to Choice states', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('class CheckValue choiceState');
        });

        it('should apply taskState class to Task states', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('class Process taskState');
        });

        it('should include CSS class definitions', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('classDef successState');
            expect(result.code).toContain('classDef failState');
            expect(result.code).toContain('classDef choiceState');
            expect(result.code).toContain('classDef taskState');
        });
    });

    describe('ID sanitization', () => {
        it('should handle special characters in state names', () => {
            const asl: AslDefinition = {
                StartAt: 'State-With-Dashes',
                States: {
                    'State-With-Dashes': {
                        Type: 'Pass',
                        Next: 'State.With.Dots',
                    },
                    'State.With.Dots': {
                        Type: 'Succeed',
                    },
                },
            };

            const { nodes, edges } = parseAsl({ definition: asl });
            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toBeDefined();
            // Should sanitize IDs but still render
        });
    });

    describe('Metadata', () => {
        it('should include state count', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.metadata.stateCount).toBe(3);
        });

        it('should include edge count', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.metadata.edgeCount).toBe(2);
        });
    });

    describe('Complex state machines', () => {
        it('should handle Choice states with multiple branches', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('CheckValue');
            expect(result.code).toContain('HighValue');
            expect(result.code).toContain('LowValue');
            expect(result.code).toContain('DefaultPath');
        });

        it('should handle Parallel states', () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('ParallelExecution');
            expect(result.code).toContain('Branch1');
            expect(result.code).toContain('Branch2');
        });

        it('should handle error transitions', () => {
            const asl = loadFixture('error-handling');
            const { nodes, edges } = parseAsl({ definition: asl });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes, edges, asl });

            expect(result.code).toContain('RiskyTask');
            expect(result.code).toContain('HandleError');
        });
    });
});
