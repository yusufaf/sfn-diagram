import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAsl } from '../src/AslParser';
import {
    getArgumentsLabel,
    getChildExecutionLabel,
    getItemSelectorLabel,
    getNodeSubLabel,
    getOutputLabel,
} from '../src/constants/labels';
import { generateMermaid, generateSvg } from '../src/index';
import type { AslDefinition, AslState, StateNode } from '../src/types';

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

const jsonata = (state: AslState) => ({ queryLanguage: 'JSONata' as const, state });
const jsonPath = (state: AslState) => ({ queryLanguage: 'JSONPath' as const, state });

describe('getArgumentsLabel', () => {
    it('lists the keys of an Arguments object', () => {
        const state: AslState = {
            Arguments: { FunctionName: 'f', Payload: '{% $states.input %}' },
            Type: 'Task',
        };
        expect(getArgumentsLabel(jsonata(state))).toBe('args FunctionName, Payload');
    });

    it('caps a long key list with a +N more suffix', () => {
        const state: AslState = { Arguments: { a: 1, b: 2, c: 3, d: 4, e: 5 }, Type: 'Task' };
        expect(getArgumentsLabel(jsonata(state))).toBe('args a, b, c +2 more');
    });

    it('unwraps a whole-field expression in JSONata mode only', () => {
        const state: AslState = { Arguments: '{% $states.input %}', Type: 'Task' };
        expect(getArgumentsLabel(jsonata(state))).toBe('args $states.input');
        expect(getArgumentsLabel(jsonPath(state))).toBe('args {% $states.input %}');
    });

    it('treats an empty, null or non-object value as unset', () => {
        expect(getArgumentsLabel(jsonata({ Arguments: {}, Type: 'Task' }))).toBe('');
        expect(getArgumentsLabel(jsonata({ Arguments: '', Type: 'Task' }))).toBe('');
        expect(
            getArgumentsLabel(jsonata({ Arguments: null, Type: 'Task' } as unknown as AslState)),
        ).toBe('');
        expect(getArgumentsLabel(jsonata({ Type: 'Task' }))).toBe('');
    });
});

describe('getOutputLabel', () => {
    it('lists the keys of an Output object', () => {
        const state: AslState = { Output: { orderId: '{% $id %}', total: 1 }, Type: 'Pass' };
        expect(getOutputLabel(jsonata(state))).toBe('output orderId, total');
    });

    it('unwraps a whole-field expression', () => {
        const state: AslState = { Output: '{% $merge($states.result) %}', Type: 'Parallel' };
        expect(getOutputLabel(jsonata(state))).toBe('output $merge($states.result)');
    });

    it('shows a non-object literal as written', () => {
        expect(getOutputLabel(jsonata({ Output: true, Type: 'Succeed' }))).toBe('output true');
        expect(getOutputLabel(jsonata({ Output: 42, Type: 'Succeed' }))).toBe('output 42');
        expect(getOutputLabel(jsonata({ Output: [1, 2], Type: 'Succeed' }))).toBe('output [1,2]');
    });

    it('elides a long expression', () => {
        const state: AslState = { Output: `{% ${'$x'.repeat(40)} %}`, Type: 'Pass' };
        const label = getOutputLabel(jsonata(state));
        expect(label.endsWith('…')).toBe(true);
        expect(label.length).toBeLessThan(50);
    });
});

describe('getItemSelectorLabel', () => {
    it('strips the JSONPath `.$` key suffix in JSONPath mode only', () => {
        const state: AslState = {
            ItemSelector: { 'item.$': '$$.Map.Item.Value', 'index.$': '$$.Map.Item.Index' },
            Type: 'Map',
        };
        expect(getItemSelectorLabel(jsonPath(state))).toBe('selector item, index');
        expect(getItemSelectorLabel(jsonata(state))).toBe('selector item.$, index.$');
    });

    it('lists JSONata keys as written', () => {
        const state: AslState = {
            ItemSelector: { item: '{% $states.context.Map.Item.Value %}' },
            Type: 'Map',
        };
        expect(getItemSelectorLabel(jsonata(state))).toBe('selector item');
    });
});

describe('getChildExecutionLabel', () => {
    it('shows the Label as a prefixed part', () => {
        expect(getChildExecutionLabel({ Label: 'OrderBatch', Type: 'Map' })).toBe('label OrderBatch');
    });

    it('treats an empty or non-string Label as unset', () => {
        expect(getChildExecutionLabel({ Label: '', Type: 'Map' })).toBe('');
        expect(getChildExecutionLabel({ Label: 5, Type: 'Map' } as unknown as AslState)).toBe('');
        expect(getChildExecutionLabel({ Type: 'Map' })).toBe('');
    });
});

describe('parseAsl surfaces JSONata I/O fields', () => {
    const definition = loadFixture('jsonata-io');
    const { nodes } = parseAsl({ definition });

    it('sets arguments and output on a Task', () => {
        const task = nodeById(nodes, 'LoadOrder');
        expect(task.arguments).toBe('args FunctionName, Payload');
        expect(task.output).toBe('output orderId, items');
    });

    it('sets itemSelector, mapLabel and output on a Map', () => {
        const map = nodeById(nodes, 'ProcessItems');
        expect(map.itemSelector).toBe('selector item, index, orderId');
        expect(map.mapLabel).toBe('label OrderItems');
        expect(map.output).toBe("output { 'orderId': $states.input.orde…");
        expect(map.arguments).toBeUndefined();
    });

    it('sets whole-field expressions on a nested Task', () => {
        const nested = nodeById(nodes, 'PriceItem');
        expect(nested.arguments).toBe('args $states.input');
        expect(nested.output).toBe('output $states.result.Payload');
    });

    it('sets a literal Output on a Succeed', () => {
        expect(nodeById(nodes, 'Done').output).toBe('output true');
    });

    it('does not set ItemSelector or Label on a non-Map state', () => {
        const { nodes: plain } = parseAsl({
            definition: {
                StartAt: 'A',
                States: { A: { End: true, ItemSelector: { x: 1 }, Label: 'L', Type: 'Pass' } },
            },
        });
        expect(nodeById(plain, 'A').itemSelector).toBeUndefined();
        expect(nodeById(plain, 'A').mapLabel).toBeUndefined();
    });

    it('orders the Map header parts with selector and label after items', () => {
        const map = nodeById(nodes, 'ProcessItems');
        expect(getNodeSubLabel({ node: map, showStateType: false })).toBe(
            "Distributed · selector item, index, orderId · label OrderItems · output { 'orderId': $states.input.orde…",
        );
    });

    it('puts args and output last on a Task, after the timing parts', () => {
        const { nodes: withTimeout } = parseAsl({
            definition: {
                QueryLanguage: 'JSONata',
                StartAt: 'Work',
                States: {
                    Work: {
                        Arguments: { a: 1 },
                        End: true,
                        Output: { b: 2 },
                        Resource: 'arn:x',
                        TimeoutSeconds: 30,
                        Type: 'Task',
                    },
                },
            },
        });
        expect(getNodeSubLabel({ node: nodeById(withTimeout, 'Work'), showStateType: false })).toBe(
            'timeout 30s · args a · output b',
        );
    });
});

describe('jsonata-io fixture renders', () => {
    const definition = loadFixture('jsonata-io');

    it('shows the fields in Mermaid with Mermaid-significant characters escaped', () => {
        const { code } = generateMermaid({ aslDefinition: definition });

        expect(code).toContain('LoadOrder: LoadOrder (args FunctionName, Payload · output orderId, items)');
        expect(code).toContain('label OrderItems');
        expect(code).toContain('Done: Done (output true)');
        // The Map Output is a JSONata object literal: its braces must be entities on
        // the state line, since `{`/`}` open a composite state in stateDiagram-v2.
        const mapLine = code.split('\n').find((line) => line.includes('ProcessItems: '));
        expect(mapLine).toContain('#123;');
        expect(mapLine).not.toMatch(/[{}"]/);
    });

    it('shows the fields in the SVG, width-fitted to the node', () => {
        const { svg } = generateSvg({ aslDefinition: definition });
        // A default-width Task has room for the head of its args part only.
        expect(svg).toContain('args FunctionNa…');
        expect(svg).toContain('args $states.input');
        expect(svg).toContain('output true');
    });
});
