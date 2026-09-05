import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { SvgRenderer } from '../src/renderers';
import { CONTAINER_HEADER_HEIGHT, CONTAINER_PADDING } from '../src/constants/layout';
import type { AslDefinition, StateNode } from '../src/types';

/**
 * The container header is drawn by the renderer into a gap the layout leaves above the
 * container's children. The two kept private copies of the geometry and drifted: the
 * band was 50px tall in a 40px gap, so the first child row covered the container's own
 * sub-label — invisible in every diagram with a Parallel or Map state.
 *
 * The box itself cannot simply move up: on the distributed-map fixture there are only
 * ten pixels between the ItemReader/SplitInput row above and the container's top edge.
 */

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf8'),
    ) as AslDefinition;
}

function positioned(definition: AslDefinition): StateNode[] {
    const { edges, nodes } = parseAsl({ definition });
    return new DagreLayout({}).calculate(nodes, edges).nodes;
}

const CONTAINER_FIXTURES = ['parallel', 'map', 'distributed-map'] as const;

describe('container header space', () => {
    it('never draws the header band over a container child', () => {
        for (const fixture of CONTAINER_FIXTURES) {
            const nodes = positioned(loadFixture(fixture));
            const byId = new Map(nodes.map((node) => [node.id, node]));

            for (const container of nodes.filter((node) => node.isContainer)) {
                const children = (container.children ?? [])
                    .map((id) => byId.get(id))
                    .filter((child): child is StateNode => child !== undefined);
                if (children.length === 0) continue;

                const bandBottom =
                    (container.y ?? 0) - (container.height ?? 0) / 2 + CONTAINER_HEADER_HEIGHT;
                const firstChildTop = Math.min(
                    ...children.map((child) => (child.y ?? 0) - (child.height ?? 0) / 2),
                );

                expect(
                    bandBottom,
                    `${fixture}: header band of "${container.id}" overruns its first child`,
                ).toBeLessThanOrEqual(firstChildTop);
            }
        }
    });

    it('keeps the header no taller than the gap the layout leaves for it', () => {
        // The invariant the two modules disagreed on. Stated once, here.
        expect(CONTAINER_HEADER_HEIGHT).toBeLessThanOrEqual(CONTAINER_PADDING);
    });

    it('renders both header lines inside the band', () => {
        const definition = loadFixture('distributed-map');
        const { edges, nodes } = parseAsl({ definition });
        const layout = new DagreLayout({}).calculate(nodes, edges);
        const svg = new SvgRenderer({}).render(layout).svg;

        const container = layout.nodes.find((node) => node.id === 'ProcessItems')!;
        const halfHeight = (container.height ?? 0) / 2;

        // The container group is translated to its centre, so header text y values are
        // relative to that: the band runs from -halfHeight to -halfHeight + header.
        const groupMatch = svg.match(
            /<g class="container[^"]*" data-state-id="ProcessItems"[^>]*>([\s\S]*?)<\/g>/,
        );
        expect(groupMatch).not.toBeNull();

        // `\s` before y: `opacity="0.7"` ends in `y="0.7"` and would match otherwise.
        const textYs = [...groupMatch![1].matchAll(/<text [^>]*\sy="(-?[\d.]+)"/g)].map((match) =>
            parseFloat(match[1]),
        );
        expect(textYs.length).toBeGreaterThanOrEqual(2);

        for (const y of textYs) {
            expect(y).toBeGreaterThanOrEqual(-halfHeight);
            expect(y).toBeLessThanOrEqual(-halfHeight + CONTAINER_HEADER_HEIGHT);
        }
    });

    it('still shows the sub-label the overlap used to hide', () => {
        const { edges, nodes } = parseAsl({ definition: loadFixture('distributed-map') });
        const svg = new SvgRenderer({}).render(new DagreLayout({}).calculate(nodes, edges)).svg;

        expect(svg).toContain('Distributed');
    });
});
