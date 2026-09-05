import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { SvgRenderer } from '../src/renderers';
import { CONTAINER_HEADER_HEIGHT, CONTAINER_PADDING } from '../src/constants/layout';
import type { CustomTheme } from '../src/types';
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

    it('draws the header band at exactly the height the layout reserves', () => {
        // Not a restatement of the constants: this reads the band out of the rendered
        // SVG, so re-introducing a literal in the renderer fails here even though the
        // constants still agree with each other.
        const { edges, nodes } = parseAsl({ definition: loadFixture('parallel') });
        const svg = new SvgRenderer({}).render(new DagreLayout({}).calculate(nodes, edges)).svg;

        const bandHeights = [...svg.matchAll(/<rect [^>]*\sheight="([\d.]+)"[^>]*rx="7"/g)]
            .map((match) => parseFloat(match[1]))
            .filter((value) => value === CONTAINER_PADDING);

        expect(bandHeights.length).toBeGreaterThan(0);
        expect(CONTAINER_HEADER_HEIGHT).toBe(CONTAINER_PADDING);
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
        // font-size is captured alongside because `dominant-baseline="middle"` makes y
        // the text's midpoint, not its extent — comparing the midpoint alone would let
        // half a line of glyphs hang outside the band unnoticed.
        const lines = [
            ...groupMatch![1].matchAll(
                /<text [^>]*\sy="(-?[\d.]+)"[^>]*font-size="([\d.]+)"/g,
            ),
        ].map((match) => ({ fontSize: parseFloat(match[2]), y: parseFloat(match[1]) }));

        expect(lines.length).toBeGreaterThanOrEqual(2);

        for (const line of lines) {
            expect(line.y - line.fontSize / 2).toBeGreaterThanOrEqual(-halfHeight);
            expect(line.y + line.fontSize / 2).toBeLessThanOrEqual(
                -halfHeight + CONTAINER_HEADER_HEIGHT,
            );
        }
    });

    it('drops the sub-label rather than overlapping it for a large custom font', () => {
        // theme.fontSize is public and required on CustomTheme. Fixed baselines tuned
        // to the built-in 14px themes overlap the two lines at 18px and push the
        // sub-label back out of the band at 22px. At 22px two lines cannot fit a 40px
        // band at all, so the name keeps the band and the sub-label is dropped -
        // preferable to two lines drawn on top of each other.
        const bigFontTheme: CustomTheme = {
            background: '#ffffff',
            edgeColors: { choice: '#000', default: '#000', error: '#000', normal: '#000' },
            fontFamily: 'sans-serif',
            fontSize: 22,
            nodeColors: {},
        };

        const { edges, nodes } = parseAsl({ definition: loadFixture('distributed-map') });
        const layout = new DagreLayout({}).calculate(nodes, edges);
        const svg = new SvgRenderer({ theme: bigFontTheme }).render(layout).svg;

        const container = layout.nodes.find((node) => node.id === 'ProcessItems')!;
        const halfHeight = (container.height ?? 0) / 2;

        const groupMatch = svg.match(
            /<g class="container[^"]*" data-state-id="ProcessItems"[^>]*>([\s\S]*?)<\/g>/,
        );
        const lines = [
            ...groupMatch![1].matchAll(
                /<text [^>]*\sy="(-?[\d.]+)"[^>]*font-size="([\d.]+)"/g,
            ),
        ].map((match) => ({ fontSize: parseFloat(match[2]), y: parseFloat(match[1]) }));

        expect(lines).toHaveLength(1);
        for (const line of lines) {
            expect(line.y - line.fontSize / 2).toBeGreaterThanOrEqual(-halfHeight);
            expect(line.y + line.fontSize / 2).toBeLessThanOrEqual(
                -halfHeight + CONTAINER_HEADER_HEIGHT,
            );
        }
    });

    it('omits the container-to-child connector when it would be zero-length', () => {
        // The band now ends exactly where the children begin, so a child directly under
        // the container's centre leaves this connector no room. A zero-length path with
        // a marker-end renders its arrowhead at an arbitrary angle.
        const { edges, nodes } = parseAsl({ definition: loadFixture('map') });
        const svg = new SvgRenderer({}).render(new DagreLayout({}).calculate(nodes, edges)).svg;

        const degenerate = [...svg.matchAll(/d="M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)"/g)]
            .filter((match) => match[1] === match[3] && match[2] === match[4]);

        expect(degenerate).toHaveLength(0);
    });

    it('still shows the sub-label the overlap used to hide', () => {
        const { edges, nodes } = parseAsl({ definition: loadFixture('distributed-map') });
        const svg = new SvgRenderer({}).render(new DagreLayout({}).calculate(nodes, edges)).svg;

        expect(svg).toContain('Distributed');
    });
});
