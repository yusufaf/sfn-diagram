import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAsl } from '../src/AslParser';
import { generateMermaid, generateSvg } from '../src/index';
import { resolveQueryLanguage, unwrapExpression } from '../src/utils/jsonata';
import type { AslDefinition, StateNode } from '../src/types';

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'),
    ) as AslDefinition;
}

function nodeById(nodes: StateNode[], id: string): StateNode {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
}

describe('resolveQueryLanguage', () => {
    it('defaults to JSONPath when neither the machine nor the state declares one', () => {
        expect(resolveQueryLanguage({ machineQueryLanguage: undefined, state: { Type: 'Pass' } })).toBe(
            'JSONPath',
        );
    });

    it('uses the machine-level value when the state declares none', () => {
        expect(resolveQueryLanguage({ machineQueryLanguage: 'JSONata', state: { Type: 'Pass' } })).toBe(
            'JSONata',
        );
    });

    it('lets a state override the machine-level value in either direction', () => {
        expect(
            resolveQueryLanguage({
                machineQueryLanguage: 'JSONPath',
                state: { QueryLanguage: 'JSONata', Type: 'Pass' },
            }),
        ).toBe('JSONata');
        expect(
            resolveQueryLanguage({
                machineQueryLanguage: 'JSONata',
                state: { QueryLanguage: 'JSONPath', Type: 'Pass' },
            }),
        ).toBe('JSONPath');
    });
});

describe('unwrapExpression', () => {
    it('strips JSONata delimiters only in JSONata mode', () => {
        expect(unwrapExpression({ queryLanguage: 'JSONata', value: '{% $x %}' })).toBe('$x');
        expect(unwrapExpression({ queryLanguage: 'JSONPath', value: '{% $x %}' })).toBe('{% $x %}');
    });

    it('leaves a plain value alone in both modes', () => {
        expect(unwrapExpression({ queryLanguage: 'JSONata', value: '$.plain' })).toBe('$.plain');
        expect(unwrapExpression({ queryLanguage: 'JSONPath', value: '$.plain' })).toBe('$.plain');
    });
});

describe('parseAsl honours QueryLanguage', () => {
    const machine = (
        queryLanguage: 'JSONata' | 'JSONPath' | undefined,
        states: AslDefinition['States'],
    ): AslDefinition => ({
        ...(queryLanguage === undefined ? {} : { QueryLanguage: queryLanguage }),
        StartAt: Object.keys(states)[0]!,
        States: states,
    });

    it('shows a JSONPath-mode literal that looks like an expression as written', () => {
        // A `{% %}` string in a JSONPath state is a literal, not an expression: the
        // declared mode decides, not the shape of the value.
        const { nodes } = parseAsl({
            definition: machine(undefined, {
                Abort: { Cause: '{% literally this %}', Type: 'Fail' },
            }),
        });

        expect(nodeById(nodes, 'Abort').failCause).toBe('cause: {% literally this %}');
    });

    it('unwraps expressions in a JSONata-mode machine', () => {
        const { nodes } = parseAsl({
            definition: machine('JSONata', {
                Abort: { Cause: '{% $states.input.reason %}', Type: 'Fail' },
            }),
        });

        expect(nodeById(nodes, 'Abort').failCause).toBe('cause: $states.input.reason');
    });

    it('applies a state-level override over the machine default', () => {
        const { nodes } = parseAsl({
            definition: machine('JSONPath', {
                Pause: {
                    Next: 'Abort',
                    QueryLanguage: 'JSONata',
                    Seconds: '{% $states.input.delay %}',
                    Type: 'Wait',
                },
                Abort: { Cause: '{% not an expression %}', Type: 'Fail' },
            }),
        });

        expect(nodeById(nodes, 'Pause').waitDuration).toBe('$states.input.delay');
        expect(nodeById(nodes, 'Abort').failCause).toBe('cause: {% not an expression %}');
    });

    it('strips the JSONPath `.$` Assign suffix only in JSONPath mode', () => {
        const jsonPath = parseAsl({
            definition: machine('JSONPath', {
                Load: { Assign: { 'orderId.$': '$.id' }, End: true, Type: 'Pass' },
            }),
        });
        const jsonata = parseAsl({
            definition: machine('JSONata', {
                Load: { Assign: { 'orderId.$': '{% $states.input.id %}' }, End: true, Type: 'Pass' },
            }),
        });

        expect(nodeById(jsonPath.nodes, 'Load').assignedVariables).toEqual(['orderId']);
        expect(nodeById(jsonata.nodes, 'Load').assignedVariables).toEqual(['orderId.$']);
    });

    it('unwraps a JSONata MaxConcurrency at parse time and leaves a JSONPath one alone', () => {
        const processor = { StartAt: 'Work', States: { Work: { End: true, Type: 'Pass' } } };
        const jsonata = parseAsl({
            definition: machine('JSONata', {
                Fan: { End: true, ItemProcessor: processor, MaxConcurrency: '{% $limit %}', Type: 'Map' },
            }),
        });
        const jsonPath = parseAsl({
            definition: machine('JSONPath', {
                Fan: { End: true, ItemProcessor: processor, MaxConcurrency: '{% $limit %}', Type: 'Map' },
            }),
        });

        expect(nodeById(jsonata.nodes, 'Fan').maxConcurrency).toBe('$limit');
        expect(nodeById(jsonPath.nodes, 'Fan').maxConcurrency).toBe('{% $limit %}');
    });

    it('labels a Choice Condition by the Choice state’s own mode', () => {
        const choices = [{ Condition: '{% $states.input.ok %}', Next: 'Done' }];
        const jsonata = parseAsl({
            definition: machine('JSONPath', {
                Route: { Choices: choices, Default: 'Done', QueryLanguage: 'JSONata', Type: 'Choice' },
                Done: { Type: 'Succeed' },
            }),
        });
        const jsonPath = parseAsl({
            definition: machine('JSONPath', {
                Route: { Choices: choices, Default: 'Done', Type: 'Choice' },
                Done: { Type: 'Succeed' },
            }),
        });

        const labelOf = (edges: { from: string; label?: string; type: string }[]): string | undefined =>
            edges.find((edge) => edge.from === 'Route' && edge.type === 'choice')?.label;

        expect(labelOf(jsonata.edges)).toBe('$states.input.ok');
        expect(labelOf(jsonPath.edges)).toBe('{% $states.input.ok %}');
    });

    it('resolves a nested state against the machine default, not its container’s override', () => {
        // ASL scopes a state-level QueryLanguage to that state alone; the states a
        // Parallel or Map contains fall back to the top-level value.
        const { nodes } = parseAsl({
            definition: machine('JSONPath', {
                Both: {
                    Branches: [
                        {
                            StartAt: 'Pause',
                            States: {
                                Pause: { End: true, Seconds: '{% $states.input.delay %}', Type: 'Wait' },
                            },
                        },
                    ],
                    End: true,
                    QueryLanguage: 'JSONata',
                    Type: 'Parallel',
                },
            }),
        });

        expect(nodeById(nodes, 'Pause').waitDuration).toBe('{% $states.input.delay %}');
    });
});

describe('jsonpath fixture', () => {
    const definition = loadFixture('jsonpath');

    it('renders JSONPath idioms as paths and the overridden state as an expression', () => {
        const { edges, nodes } = parseAsl({ definition });

        expect(nodeById(nodes, 'LoadOrder').taskTimeout).toBe('timeout $.limits.loadTimeout');
        expect(nodeById(nodes, 'LoadOrder').assignedVariables).toEqual(['orderId', 'region']);
        expect(nodeById(nodes, 'Reject').failError).toBe('error: $.Payload.error');
        expect(nodeById(nodes, 'Reject').failCause).toBe('cause: $.Payload.reason');
        // The one JSONata state in the machine
        expect(nodeById(nodes, 'Review').waitDuration).toBe('$states.input.delay');

        const choiceLabels = edges
            .filter((edge) => edge.from === 'Classify' && edge.type === 'choice')
            .map((edge) => edge.label);
        expect(choiceLabels).toEqual(['$.Payload.score >= 0.8', '$.Payload.score < 0.5']);
    });

    it('renders to SVG and Mermaid without the delimiters leaking', () => {
        const { svg } = generateSvg({ aslDefinition: definition });
        const { code } = generateMermaid({ aslDefinition: definition });

        // The SVG width-fits the sub-label, so only the head of the expression survives.
        expect(svg).toContain('$states.input.de');
        expect(svg).not.toContain('{%');
        expect(code).toContain('$states.input.delay');
        expect(code).not.toContain('{%');
    });
});
