import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAsl } from '../src/AslParser';
import { generateMermaid, generateSvg } from '../src/index';
import {
    fitSubLabel,
    getAssignedVariablesLabel,
    getNodeSubLabel,
    getNodeSubLabelParts,
} from '../src/constants/labels';
import type { AslDefinition, StateNode } from '../src/types';

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8')
    ) as AslDefinition;
}

describe('ASL Variables (Assign)', () => {
    const definition = loadFixture('variables');

    describe('parseAsl', () => {
        it('records assigned variable names in declaration order', () => {
            const { nodes } = parseAsl({ definition });
            const loadOrder = nodes.find((node) => node.id === 'LoadOrder');

            expect(loadOrder?.assignedVariables).toEqual(['orderId', 'total']);
        });

        it('strips the JSONPath `.$` suffix from assigned variable names', () => {
            // In JSONPath mode a key ending in `.$` marks its value as a path to
            // resolve; the variable itself is named without the suffix.
            const jsonPathAssign: AslDefinition = {
                StartAt: 'LoadOrder',
                States: {
                    LoadOrder: {
                        Assign: { 'orderId.$': '$.order.id', region: 'us-east-1' },
                        End: true,
                        Type: 'Pass',
                    },
                },
            };

            const { nodes } = parseAsl({ definition: jsonPathAssign });
            const loadOrder = nodes.find((node) => node.id === 'LoadOrder');

            expect(loadOrder?.assignedVariables).toEqual(['orderId', 'region']);
            expect(getAssignedVariablesLabel(loadOrder?.assignedVariables ?? [])).toBe(
                '$orderId, $region'
            );
        });

        it('leaves assignedVariables undefined for states that assign nothing', () => {
            const { nodes } = parseAsl({ definition });
            const done = nodes.find((node) => node.id === 'Done');

            expect(done?.assignedVariables).toBeUndefined();
        });
    });

    describe('getAssignedVariablesLabel', () => {
        it('prefixes names with $ and joins them', () => {
            expect(getAssignedVariablesLabel(['orderId', 'total'])).toBe('$orderId, $total');
        });

        it('caps the list so a many-variable state cannot blow out node width', () => {
            expect(getAssignedVariablesLabel(['a', 'b', 'c', 'd', 'e'])).toBe(
                '$a, $b, $c +2 more'
            );
        });

        it('returns an empty string when nothing is assigned', () => {
            expect(getAssignedVariablesLabel([])).toBe('');
        });
    });

    describe('rendering', () => {
        it('renders assigned variables into the SVG by default', () => {
            const { svg } = generateSvg({ aslDefinition: definition });

            expect(svg).toContain('$orderId, $total');
            expect(svg).toContain('class="node-variables"');
        });

        it('caps the variable list in rendered output', () => {
            const { svg } = generateSvg({ aslDefinition: definition });

            // ChargeCustomer assigns five variables
            expect(svg).toContain('+2 more');
        });

        it('omits variables from the SVG when showVariables is false', () => {
            const { svg } = generateSvg({ aslDefinition: definition, showVariables: false });

            expect(svg).not.toContain('$orderId');
            expect(svg).not.toContain('class="node-variables"');
        });

        it('appends assigned variables to Mermaid state labels', () => {
            const { code } = generateMermaid({ aslDefinition: definition });

            expect(code).toContain('LoadOrder: LoadOrder ($orderId, $total)');
        });

        it('omits variables from Mermaid when showVariables is false', () => {
            const { code } = generateMermaid({
                aslDefinition: definition,
                showVariables: false,
            });

            expect(code).not.toContain('$orderId');
        });
    });
});

describe('Distributed Map', () => {
    const distributed = loadFixture('distributed-map');
    const inline = loadFixture('map');

    it('flags a Map whose ItemProcessor declares Mode: DISTRIBUTED', () => {
        const { nodes } = parseAsl({ definition: distributed });
        const mapNode = nodes.find((node) => node.id === 'ProcessItems');

        expect(mapNode?.isDistributedMap).toBe(true);
        expect(mapNode?.maxConcurrency).toBe(100);
    });

    it('does not flag an inline Map', () => {
        const { nodes } = parseAsl({ definition: inline });
        const mapNode = nodes.find((node) => node.id === 'ProcessItems');

        expect(mapNode?.isDistributedMap).toBeUndefined();
        expect(mapNode?.maxConcurrency).toBe(4);
    });

    it('distinguishes the two in rendered SVG', () => {
        expect(generateSvg({ aslDefinition: distributed }).svg).toContain(
            'Distributed · max 100'
        );
        expect(generateSvg({ aslDefinition: inline }).svg).not.toContain('Distributed');
    });

    it('distinguishes the two in rendered Mermaid', () => {
        expect(generateMermaid({ aslDefinition: distributed }).code).toContain(
            'ProcessItems: ProcessItems (Distributed · max 100 · tolerate 5% · batches of 50 · items $.items)'
        );
        expect(generateMermaid({ aslDefinition: inline }).code).not.toContain('Distributed');
    });

    describe('ItemReader / ResultWriter satellites', () => {
        it('creates a satellite node per configured I/O role', () => {
            const { nodes } = parseAsl({ definition: distributed });

            const reader = nodes.find((node) => node.id === 'ProcessItems__itemreader');
            const writer = nodes.find((node) => node.id === 'ProcessItems__resultwriter');

            expect(reader?.type).toBe('ItemReader');
            expect(reader?.label).toBe('ItemReader (s3)');
            expect(writer?.type).toBe('ResultWriter');
            expect(writer?.label).toBe('ResultWriter (s3)');
        });

        it('wires the reader into the Map and the Map into the writer', () => {
            const { edges } = parseAsl({ definition: distributed });

            expect(edges).toContainEqual({
                from: 'ProcessItems__itemreader',
                id: 'ProcessItems__itemreader->ProcessItems#normal#0',
                label: 'ItemReader',
                to: 'ProcessItems',
            });
            expect(edges).toContainEqual({
                from: 'ProcessItems',
                id: 'ProcessItems->ProcessItems__resultwriter#normal#0',
                label: 'ResultWriter',
                to: 'ProcessItems__resultwriter',
            });
        });

        it('creates no satellites for a Map without ItemReader or ResultWriter', () => {
            const { nodes } = parseAsl({ definition: inline });

            expect(nodes.some((node) => node.type === 'ItemReader')).toBe(false);
            expect(nodes.some((node) => node.type === 'ResultWriter')).toBe(false);
        });

        it('attaches a service icon when showIcons is enabled', () => {
            const { nodes } = parseAsl({
                definition: distributed,
                options: { showIcons: true },
            });
            const reader = nodes.find((node) => node.id === 'ProcessItems__itemreader');

            expect(reader?.serviceType).toBe('s3');
            expect(reader?.iconUrl).toBeTruthy();
        });

        it('renders both satellites into the SVG', () => {
            const { svg } = generateSvg({ aslDefinition: distributed });

            expect(svg).toContain('ItemReader (s3)');
            expect(svg).toContain('ResultWriter (s3)');
        });

        // An ItemReader is a graph source: its only edge points at the Map, so a
        // forward reachability pass from the start state never visits it. Without
        // explicit handling, catchHandling 'hide' pruned the reader while keeping
        // the writer.
        it('keeps both satellites when catch branches are hidden', () => {
            const { svg } = generateSvg({
                aslDefinition: distributed,
                catchHandling: 'hide',
            });

            expect(svg).toContain('ItemReader (s3)');
            expect(svg).toContain('ResultWriter (s3)');
        });
    });

    describe('fitSubLabel', () => {
        // One unit per character keeps the arithmetic in these cases obvious.
        const measure = (text: string): number => text.length;

        it('returns the joined parts untouched when they already fit', () => {
            expect(
                fitSubLabel({ availableWidth: 40, measure, parts: ['Distributed', 'max 100'] }),
            ).toBe('Distributed · max 100');
        });

        it('drops whole parts rather than cutting inside a value', () => {
            // `tolerate 100 failures` cut mid-value reads as a different number, so the
            // part goes entirely and the ellipsis says something was dropped.
            const fitted = fitSubLabel({
                availableWidth: 30,
                measure,
                parts: ['Distributed', 'max 100', 'tolerate 100 failures'],
            });

            expect(fitted).toBe('Distributed · max 100 · …');
            expect(fitted).not.toContain('tolerate');
        });

        it('keeps dropping until what remains fits', () => {
            expect(
                fitSubLabel({
                    availableWidth: 17,
                    measure,
                    parts: ['Distributed', 'max 100', 'tolerate 5%'],
                }),
            ).toBe('Distributed · …');
        });

        it('falls back to cutting characters only when one part cannot fit alone', () => {
            const fitted = fitSubLabel({
                availableWidth: 8,
                measure,
                parts: ['$states.input.delaySeconds'],
            });

            expect(fitted.endsWith('…')).toBe(true);
            expect(measure(fitted)).toBeLessThanOrEqual(8);
        });

        it('does not leave a trailing space before the ellipsis', () => {
            expect(
                fitSubLabel({ availableWidth: 8, measure, parts: ['abcd efghij'] }),
            ).not.toContain(' …');
        });

        it('drops the label entirely when not even a stub fits', () => {
            expect(fitSubLabel({ availableWidth: 2, measure, parts: ['Distributed'] })).toBe('');
        });

        it('passes an empty part list straight through', () => {
            expect(fitSubLabel({ availableWidth: 0, measure, parts: [] })).toBe('');
        });
    });

    describe('getNodeSubLabel', () => {
        const node: StateNode = {
            id: 'ProcessItems',
            isContainer: true,
            isDistributedMap: true,
            label: 'ProcessItems',
            maxConcurrency: 100,
            type: 'Map',
        };

        it('shows the distributed marker and concurrency without showStateType', () => {
            expect(getNodeSubLabel({ node, showStateType: false })).toBe(
                'Distributed · max 100'
            );
        });

        it('prepends the state type when showStateType is enabled', () => {
            expect(getNodeSubLabel({ node, showStateType: true })).toBe(
                'Map state · Distributed · max 100'
            );
        });

        it('returns an empty string for a plain container with nothing to report', () => {
            const plain: StateNode = {
                id: 'Branches',
                isContainer: true,
                label: 'Branches',
                type: 'Parallel',
            };

            expect(getNodeSubLabel({ node: plain, showStateType: false })).toBe('');
        });

        it('appends Map tolerance and batching after concurrency', () => {
            expect(
                getNodeSubLabel({
                    node: { ...node, itemBatching: 'batches of 50', toleratedFailure: 'tolerate 5%' },
                    showStateType: false,
                }),
            ).toBe('Distributed · max 100 · tolerate 5% · batches of 50');
        });

        it('appends the items source last, so it is the first Map part dropped when width is tight', () => {
            const parts = getNodeSubLabelParts({
                node: { ...node, itemsPath: 'items $.orders', toleratedFailure: 'tolerate 5%' },
                showStateType: false,
            });

            expect(parts).toEqual([
                'Distributed',
                'max 100',
                'tolerate 5%',
                'items $.orders',
            ]);
            expect(parts.at(-1)).toBe('items $.orders');
        });

        it('surfaces an inline Map\'s ItemsPath on the node', () => {
            const { nodes } = parseAsl({ definition: inline });
            const mapNode = nodes.find((candidate) => candidate.id === 'ProcessItems');

            expect(mapNode?.itemsPath).toBe('items $.items');
            expect(generateSvg({ aslDefinition: inline }).svg).toContain('items $.items');
            expect(generateMermaid({ aslDefinition: inline }).code).toContain(
                'ProcessItems: ProcessItems (max 4 · items $.items)'
            );
        });

        // A definition read from a file, a CloudFormation template or an AWS API
        // response can carry a malformed ItemsPath. Parsing such a definition used
        // to work, so neither a crash nor a dangling `items ` part is acceptable.
        it.each([
            ['null', null],
            ['a number', 5],
            ['an empty string', ''],
        ])('ignores an ItemsPath that is %s', (_description, itemsPath) => {
            const asl = {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        End: true,
                        ItemProcessor: {
                            StartAt: 'Work',
                            States: { Work: { End: true, Type: 'Pass' } },
                        },
                        ItemsPath: itemsPath,
                        MaxConcurrency: 4,
                        Type: 'Map',
                    },
                },
            } as unknown as AslDefinition;

            const { nodes } = parseAsl({ definition: asl });
            const mapNode = nodes.find((candidate) => candidate.id === 'Fan');

            expect(mapNode?.itemsPath).toBeUndefined();
            expect(getNodeSubLabel({ node: mapNode!, showStateType: false })).toBe('max 4');
        });

        it('leaves itemsPath unset on a Map without ItemsPath', () => {
            const asl: AslDefinition = {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        End: true,
                        ItemProcessor: {
                            StartAt: 'Work',
                            States: { Work: { End: true, Type: 'Pass' } },
                        },
                        Type: 'Map',
                    },
                },
            };

            const { nodes } = parseAsl({ definition: asl });
            expect(nodes.find((candidate) => candidate.id === 'Fan')?.itemsPath).toBeUndefined();
        });

        it('strips JSONata delimiters from MaxConcurrency, like its ToleratedFailure siblings', () => {
            const asl: AslDefinition = {
                StartAt: 'Fan',
                States: {
                    Fan: {
                        End: true,
                        ItemProcessor: {
                            StartAt: 'Work',
                            States: { Work: { End: true, Type: 'Pass' } },
                        },
                        MaxConcurrency: '{% $limit %}',
                        Type: 'Map',
                    },
                },
            };

            const { nodes } = parseAsl({ definition: asl });
            const container = nodes.find((candidate) => candidate.id === 'Fan')!;

            expect(getNodeSubLabel({ node: container, showStateType: false })).toBe('max $limit');
        });

        it('shows the duration of a Wait state', () => {
            const wait: StateNode = {
                id: 'Pause',
                label: 'Pause',
                type: 'Wait',
                waitDuration: '5s',
            };

            expect(getNodeSubLabel({ node: wait, showStateType: false })).toBe('5s');
        });

        it('shows a Fail state\'s error before its cause', () => {
            const fail: StateNode = {
                failCause: 'cause: Payment declined',
                failError: 'error: PaymentFailed',
                id: 'Abort',
                label: 'Abort',
                type: 'Fail',
            };

            expect(getNodeSubLabel({ node: fail, showStateType: false })).toBe(
                'error: PaymentFailed · cause: Payment declined',
            );
        });

        it('shows a Task state\'s timeout before its heartbeat', () => {
            const task: StateNode = {
                id: 'Work',
                label: 'Work',
                taskHeartbeat: 'heartbeat 10s',
                taskTimeout: 'timeout 30s',
                type: 'Task',
            };

            expect(getNodeSubLabel({ node: task, showStateType: true })).toBe(
                'Task · timeout 30s · heartbeat 10s',
            );
        });

        it('renders a Fail state\'s error into SVG and Mermaid', () => {
            const definition = loadFixture('wait-fail');

            // A default-width node cannot fit the whole error name, so the SVG shows the
            // usual character-fitted form; the Mermaid label is never width-constrained.
            expect(generateSvg({ aslDefinition: definition }).svg).toMatch(/error: InvalidStat/);
            expect(generateMermaid({ aslDefinition: definition }).code).toContain(
                'error: InvalidStatus · cause: Status was not success',
            );
        });

        it('keeps the bare type on a non-container, as the second line always has', () => {
            const task: StateNode = { id: 'Work', label: 'Work', type: 'Task' };

            expect(getNodeSubLabel({ node: task, showStateType: true })).toBe('Task');
        });
    });
});
