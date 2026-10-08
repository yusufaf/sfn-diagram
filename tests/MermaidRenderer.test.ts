import { describe, it, expect } from 'vitest';
import { generateMermaid } from '../src';
import { MermaidRenderer } from '../src/renderers';
import { parseAsl } from '../src/AslParser';
import { applyCollapse } from '../src/graph';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

/** The diagram's structural lines: no blank lines and no styling (`class` / `classDef`). */
const structure = (code: string): string[] =>
    code.split('\n').filter((line) => line.trim() !== '' && !/^\s*class(Def)?\s/.test(line));

const renderFixture = (name: string) => {
    const asl = loadFixture(name);
    const { nodes, edges } = parseAsl({ definition: asl });
    return new MermaidRenderer().render({ nodes, edges, asl });
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

    describe('Layout and theme options', () => {
        it('should default to a TB direction when layout is not given', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const result = new MermaidRenderer().render({ nodes, edges, asl });

            expect(result.code).toContain('    direction TB');
        });

        it('should emit the requested layout direction', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const result = new MermaidRenderer().render({ nodes, edges, asl, layout: 'LR' });

            expect(result.code).toContain('    direction LR');
        });

        it('should derive classDef colours from the light theme by default', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const result = new MermaidRenderer().render({ nodes, edges, asl });

            expect(result.code).toContain('classDef taskState fill:#fff3e0,stroke:#d84315,stroke-width:2px');
            expect(result.code).not.toContain("%%{init:");
        });

        it('should switch classDef colours and emit a dark init directive for theme: dark', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });

            const result = new MermaidRenderer().render({ nodes, edges, asl, theme: 'dark' });

            expect(result.code.startsWith("%%{init: {'theme':'dark'}}%%\n")).toBe(true);
            expect(result.code).toContain('classDef taskState fill:#9c3400,stroke:#ffb74d,stroke-width:2px');
        });

        it('should classify a dark CustomTheme by background luminance', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const customTheme = {
                background: '#101820',
                edgeColors: { choice: '#fff', default: '#fff', error: '#fff', normal: '#fff' },
                fontFamily: 'Arial, sans-serif',
                fontSize: 14,
                nodeColors: {
                    Pass: { fill: '#000', stroke: '#fff' },
                    Task: { fill: '#111111', stroke: '#fff' },
                    Choice: { fill: '#000', stroke: '#fff' },
                    Wait: { fill: '#000', stroke: '#fff' },
                    Succeed: { fill: '#000', stroke: '#fff' },
                    Fail: { fill: '#000', stroke: '#fff' },
                    Parallel: { fill: '#000', stroke: '#fff' },
                    Map: { fill: '#000', stroke: '#fff' },
                },
                textColor: '#fff',
            };

            const result = new MermaidRenderer().render({ nodes, edges, asl, theme: customTheme });

            expect(result.code.startsWith("%%{init:")).toBe(true);
            expect(result.code).toContain('classDef taskState fill:#111111,stroke:#fff,stroke-width:2px');
        });

        it('should style container and pass/wait states, not just the original four types', () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });

            const result = new MermaidRenderer().render({ nodes, edges, asl });

            expect(result.code).toContain('classDef parallelState');
            expect(result.code).toContain('class ParallelExecution parallelState');
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

        it('should not emit branch/iterator end marker states or entry edges as transitions', () => {
            const result = renderFixture('parallel');

            expect(structure(result.code)).toEqual([
                'stateDiagram-v2',
                '    direction TB',
                '    [*] --> ParallelExecution',
                '    state ParallelExecution {',
                '        [*] --> Branch1',
                '        Branch1 --> [*]',
                '        --',
                '        [*] --> Branch2',
                '        Branch2 --> [*]',
                '    }',
                '    ParallelExecution --> FinalState',
                '    FinalState --> [*]',
            ]);
            expect(result.code).not.toContain('__end');
            expect(result.code).not.toContain('__branch');
            expect(result.code).not.toContain('ParallelExecution --> Branch1');
            expect(result.metadata.stateCount).toBe(4);
            expect(result.metadata.edgeCount).toBe(1);
        });

        it('should nest a Map processor as a composite and draw its Next once', () => {
            const { code } = renderFixture('map');

            expect(code).not.toContain('__iterator__end');
            expect(code).toContain('    state ProcessItems {');
            expect(code).toContain('        [*] --> ProcessItem');
            expect(code).toContain('        ValidateItem --> [*]');
            expect(code).toContain('    ProcessItems --> Done');
            expect(code.match(/--> Done/g)).toHaveLength(1);
            expect(code).toMatch(/^ {4}ProcessItems: ProcessItems \(/m);
        });

        it('should nest a container inside a branch without leaking markers', () => {
            const { code } = renderFixture('nested-map');

            expect(structure(code)).toEqual([
                'stateDiagram-v2',
                '    direction TB',
                '    [*] --> FanOut',
                '    state FanOut {',
                '        [*] --> ProcessBatch',
                '        ProcessBatch: ProcessBatch (items $.batch)',
                '        state ProcessBatch {',
                '            [*] --> HandleRecord',
                '            HandleRecord --> [*]',
                '        }',
                '        ProcessBatch --> [*]',
                '        --',
                '        [*] --> Notify',
                '        Notify --> [*]',
                '    }',
                '    FanOut --> Complete',
                '    Complete --> [*]',
            ]);
        });

        it('should keep a collapsed container reachable via its placeholder', () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });
            const collapsed = applyCollapse({ collapse: true, edges, nodes });

            const renderer = new MermaidRenderer();
            const result = renderer.render({ nodes: collapsed.nodes, edges: collapsed.edges, asl });

            // No branch markers survive the collapse itself, and the container's own
            // -> Next visual edge - its only remaining link to the rest of the graph -
            // must not be mistaken for a now-nonexistent duplicate and dropped too.
            expect(result.code).toContain('ParallelExecution --> FinalState');
            expect(result.code).not.toContain('state ParallelExecution {');
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

    describe('End states and composites (#371)', () => {
        it('ends the machine at a Task with End: true, not only at Succeed/Fail', () => {
            const { code } = renderFixture('end-on-task');

            expect(code).toContain('    Work --> [*]');
            expect(code).toContain('    Failed --> [*]');
            expect(code).not.toContain('Prepare --> [*]');
            expect(code.match(/--> \[\*\]/g)).toHaveLength(2);
        });

        it('ends a Pass with End: true', () => {
            const asl: AslDefinition = {
                StartAt: 'A',
                States: {
                    A: { Next: 'B', Type: 'Pass' },
                    B: { End: true, Type: 'Pass' },
                },
            };
            const { nodes, edges } = parseAsl({ definition: asl });
            const { code } = new MermaidRenderer().render({ asl, edges, nodes });

            expect(structure(code)).toEqual([
                'stateDiagram-v2',
                '    direction TB',
                '    [*] --> A',
                '    A --> B',
                '    B --> [*]',
            ]);
        });

        it('scopes terminal states to their own branch or processor', () => {
            const { code } = renderFixture('nested-terminals');

            expect(structure(code)).toEqual([
                'stateDiagram-v2',
                '    direction TB',
                '    [*] --> Fan',
                '    state Fan {',
                '        [*] --> Ok',
                '        Ok --> [*]',
                '        --',
                '        [*] --> Check',
                '        Check --> Bad: $.bad == true',
                '        Check --> Work: Default',
                '        Work --> [*]',
                '        Bad --> [*]',
                '    }',
                '    state Each {',
                '        [*] --> Item',
                '        Item --> Valid',
                '        Valid --> Reject: $.ok == false',
                '        Valid --> Keep: Default',
                '        Keep --> [*]',
                '        Reject --> [*]',
                '    }',
                '    Fan --> Each',
                '    Each --> [*]',
            ]);
        });

        it('keeps a nested Distributed Map ItemReader inside its branch', () => {
            const aslDefinition: AslDefinition = {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        Branches: [
                            {
                                StartAt: 'Dist',
                                States: {
                                    Dist: {
                                        End: true,
                                        ItemProcessor: {
                                            ProcessorConfig: { ExecutionType: 'STANDARD', Mode: 'DISTRIBUTED' },
                                            StartAt: 'Item',
                                            States: { Item: { End: true, Type: 'Pass' } },
                                        },
                                        ItemReader: { Resource: 'arn:aws:states:::s3:listObjectsV2' },
                                        Type: 'Map',
                                    },
                                },
                            },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            };
            const { code } = generateMermaid({ aslDefinition });

            expect(code).toMatch(/^ {8}Dist__itemreader --> Dist: ItemReader$/m);
            expect(code).toMatch(/^ {8}Dist__itemreader: /m);
        });

        it('does not resurrect a catch-hidden state through a container child list', () => {
            const aslDefinition: AslDefinition = {
                StartAt: 'P',
                States: {
                    P: {
                        Branches: [
                            {
                                StartAt: 'Try',
                                States: {
                                    Recover: { End: true, Type: 'Pass' },
                                    Try: {
                                        Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Recover' }],
                                        End: true,
                                        Type: 'Pass',
                                    },
                                },
                            },
                        ],
                        End: true,
                        Type: 'Parallel',
                    },
                },
            };
            const { code } = generateMermaid({ aslDefinition, catchHandling: 'hide' });

            expect(code).not.toContain('Recover');
            expect(code).toContain('Try --> [*]');
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
