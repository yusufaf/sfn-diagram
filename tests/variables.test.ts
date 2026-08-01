import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAsl } from '../src/AslParser';
import { generateMermaid, generateSvg } from '../src/index';
import { getAssignedVariablesLabel, getContainerSubLabel } from '../src/constants/labels';
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
            'ProcessItems: ProcessItems (Distributed · max 100)'
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
                label: 'ItemReader',
                to: 'ProcessItems',
            });
            expect(edges).toContainEqual({
                from: 'ProcessItems',
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
    });

    describe('getContainerSubLabel', () => {
        const node: StateNode = {
            id: 'ProcessItems',
            isContainer: true,
            isDistributedMap: true,
            label: 'ProcessItems',
            maxConcurrency: 100,
            type: 'Map',
        };

        it('shows the distributed marker and concurrency without showStateType', () => {
            expect(getContainerSubLabel({ node, showStateType: false })).toBe(
                'Distributed · max 100'
            );
        });

        it('prepends the state type when showStateType is enabled', () => {
            expect(getContainerSubLabel({ node, showStateType: true })).toBe(
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

            expect(getContainerSubLabel({ node: plain, showStateType: false })).toBe('');
        });
    });
});
