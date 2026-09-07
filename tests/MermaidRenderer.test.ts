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

            // `;` is Mermaid-significant, so the label's own separator is escaped
            // to `#59;` along with everything else escapeLabel handles.
            expect(result.code).toContain(
                'Submit --> Submit: ↻ States.Timeout (4x)#59; States.ALL (2x)',
            );
        });
    });

    describe('Id collisions', () => {
        // Distinct state names that sanitize to the same Mermaid id must not merge:
        // 'Check X' and 'Check-X' both reduce to 'Check_X'.
        const collidingAsl: AslDefinition = {
            StartAt: 'Check X',
            States: {
                'Check X': { Type: 'Pass', Next: 'Check-X' },
                'Check-X': { Type: 'Pass', Next: 'Done' },
                Done: { Type: 'Succeed' },
            },
        };

        it('should give colliding state names distinct ids', () => {
            const { nodes, edges } = parseAsl({ definition: collidingAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: collidingAsl });

            expect(result.code).toContain('Check_X:');
            expect(result.code).toContain('Check_X_2:');
        });

        it('should preserve the human label for each colliding state', () => {
            const { nodes, edges } = parseAsl({ definition: collidingAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: collidingAsl });

            expect(result.code).toContain('Check_X: Check X');
            expect(result.code).toContain('Check_X_2: Check-X');
        });

        it('should route edges to the correct colliding node, not merge them', () => {
            const { nodes, edges } = parseAsl({ definition: collidingAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: collidingAsl });

            // The transition between the two colliding states must survive as an
            // edge between distinct ids (a merge would produce a Check_X self-loop).
            expect(result.code).toContain('Check_X --> Check_X_2');
            expect(result.code).not.toContain('Check_X --> Check_X\n');
            expect(result.metadata.stateCount).toBe(3);
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

    describe('Label escaping', () => {
        // A state name carrying every Mermaid-significant character at once,
        // plus a literal arrow sequence that must not be read as a transition.
        const escapesAsl: AslDefinition = {
            StartAt: 'Start',
            States: {
                Start: {
                    Type: 'Pass',
                    Next: 'Check#1 "Quoted" <Tag>{brace}`tick`;a-->b',
                },
                'Check#1 "Quoted" <Tag>{brace}`tick`;a-->b': {
                    Type: 'Succeed',
                },
            },
        };

        it('should escape every Mermaid-significant character', () => {
            const { nodes, edges } = parseAsl({ definition: escapesAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: escapesAsl });

            expect(result.code).toContain(
                'Check#35;1 #quot;Quoted#quot; #60;Tag#62;#123;brace#125;#96;tick#96;#59;a--#62;b',
            );
        });

        it('should not let the escaped label contain a raw arrow, quote, or brace', () => {
            const { nodes, edges } = parseAsl({ definition: escapesAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: escapesAsl });

            // Isolate the state definition line so the assertion can't be satisfied
            // by the `-->` transition syntax that legitimately appears elsewhere.
            const definitionLine = result.code
                .split('\n')
                .find((line) => line.trim().startsWith('Check_1'));

            expect(definitionLine).toBeDefined();
            expect(definitionLine).not.toContain('-->');
            expect(definitionLine).not.toContain('"');
            expect(definitionLine).not.toContain('{');
            expect(definitionLine).not.toContain('}');
        });

        it('should still collapse newlines to spaces', () => {
            const asl: AslDefinition = {
                StartAt: 'Multi\nLine',
                States: { 'Multi\nLine': { Type: 'Succeed' } },
            };
            const { nodes, edges } = parseAsl({ definition: asl });
            const result = new MermaidRenderer().render({ nodes, edges, asl });

            expect(result.code).toContain('Multi Line');
        });

        it('should match the full escaped snapshot', () => {
            const { nodes, edges } = parseAsl({ definition: escapesAsl });
            const result = new MermaidRenderer().render({ nodes, edges, asl: escapesAsl });

            expect(result.code).toMatchSnapshot();
        });
    });
});
