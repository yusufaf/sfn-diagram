import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { SvgRenderer } from '../src/renderers';
import { CONTAINER_HEADER_TEXT_HEIGHT, CONTAINER_PADDING } from '../src/constants';
import type { AslDefinition, CustomTheme, StateNode } from '../src/types';

/**
 * A container's header text is drawn by the renderer into a gap the layout leaves above
 * its children, and the two modules kept private copies of the geometry. The renderer
 * laid the text out against the header *band* (50px) rather than the space actually
 * clear of children (40px), so the sub-label's baseline landed below the first child's
 * top edge and the child — painted after the container — covered it.
 *
 * The band itself is deliberately left alone: its lower strip is simply hidden behind
 * that first child row, and shrinking it would move the container's bottom edge and the
 * connectors that start at the band's foot.
 */

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf8')
    ) as AslDefinition;
}

function render(name: string, theme?: CustomTheme): { nodes: StateNode[]; svg: string } {
    const { edges, nodes } = parseAsl({ definition: loadFixture(name) });
    // Same options object to both: the layout resolves the theme to size a
    // container's header-driven minimum width, and must agree with what the
    // renderer actually draws that header at.
    const options = theme ? { theme } : {};
    const layout = new DagreLayout(options).calculate(nodes, edges);
    return { nodes: layout.nodes, svg: new SvgRenderer(options).render(layout).svg };
}

/** Header text lines of one container, as `{ y, fontSize }` in the group's own frame. */
function headerLines(svg: string, containerId: string): Array<{ fontSize: number; y: number }> {
    const group = svg.match(
        new RegExp(`<g class="container[^"]*" data-state-id="${containerId}"[^>]*>([\\s\\S]*?)</g>`)
    );
    expect(group).not.toBeNull();

    // `\s` before y: `opacity="0.7"` ends in `y="0.7"`. font-size is captured too —
    // `dominant-baseline="middle"` makes y the midpoint, not the extent, so comparing
    // y alone would let half a line of glyphs hang outside unnoticed.
    return [
        ...group![1].matchAll(/<text [^>]*\sy="(-?[\d.]+)"[^>]*font-size="([\d.]+)"/g),
    ].map((match) => ({ fontSize: parseFloat(match[2]), y: parseFloat(match[1]) }));
}

const CONTAINER_FIXTURES = ['parallel', 'map', 'distributed-map'] as const;

describe('container header space', () => {
    it('leaves the layout geometry untouched', () => {
        // The point of the fix: only the text moved. If a container's box or its
        // children shifted, so would the bottom gap its branch end markers sit in.
        const { nodes } = render('distributed-map');
        const container = nodes.find((node) => node.id === 'ProcessItems')!;

        expect(container.y! - container.height! / 2).toBe(90);
        expect(container.height).toBe(300);
    });

    it('keeps every header line clear of the first child row', () => {
        for (const fixture of CONTAINER_FIXTURES) {
            const { nodes, svg } = render(fixture);
            const byId = new Map(nodes.map((node) => [node.id, node]));

            for (const container of nodes.filter((node) => node.isContainer)) {
                const children = (container.children ?? [])
                    .map((id) => byId.get(id))
                    .filter((child): child is StateNode => child !== undefined);
                if (children.length === 0) continue;

                const centre = container.y ?? 0;
                const firstChildTop = Math.min(
                    ...children.map((child) => (child.y ?? 0) - (child.height ?? 0) / 2)
                );

                for (const line of headerLines(svg, container.id)) {
                    // Header text y values are relative to the group's own centre.
                    const bottom = centre + line.y + line.fontSize / 2;
                    expect(
                        bottom,
                        `${fixture}: a header line of "${container.id}" reaches the first child`
                    ).toBeLessThanOrEqual(firstChildTop);
                }
            }
        }
    });

    it('lays the text out within the space clear of children, not the band', () => {
        const { nodes, svg } = render('distributed-map');
        const container = nodes.find((node) => node.id === 'ProcessItems')!;
        const halfHeight = (container.height ?? 0) / 2;

        const lines = headerLines(svg, 'ProcessItems');
        expect(lines.length).toBeGreaterThanOrEqual(2);

        for (const line of lines) {
            expect(line.y - line.fontSize / 2).toBeGreaterThanOrEqual(-halfHeight);
            expect(line.y + line.fontSize / 2).toBeLessThanOrEqual(
                -halfHeight + CONTAINER_HEADER_TEXT_HEIGHT
            );
        }
    });

    it('shrinks the sub-label instead of dropping it for a large custom font', () => {
        // theme.fontSize is public and required on CustomTheme, and the text height is a
        // compile-time constant a caller cannot raise. Dropping the sub-label would
        // silently lose the Distributed marker, concurrency, tolerance and batching.
        const bigFont: CustomTheme = {
            background: '#ffffff',
            edgeColors: { choice: '#000', default: '#000', error: '#000', normal: '#000' },
            fontFamily: 'sans-serif',
            fontSize: 26,
            nodeColors: {},
        };

        const { nodes, svg } = render('distributed-map', bigFont);
        const container = nodes.find((node) => node.id === 'ProcessItems')!;
        const halfHeight = (container.height ?? 0) / 2;

        const lines = headerLines(svg, 'ProcessItems');
        expect(lines).toHaveLength(2);

        const [name, sub] = lines;
        expect(name.fontSize).toBe(26);
        expect(sub.fontSize).toBeLessThan(name.fontSize);
        // Still legible, and still inside the space clear of children.
        expect(sub.fontSize).toBeGreaterThanOrEqual(8);
        for (const line of lines) {
            expect(line.y + line.fontSize / 2).toBeLessThanOrEqual(
                -halfHeight + CONTAINER_HEADER_TEXT_HEIGHT
            );
        }
    });

    it('never overlaps the two header lines, even at a font size the sub-label floor cannot fit', () => {
        // At fontSize 35 the MIN_SUB_LABEL_FONT_SIZE floor (8px) no longer fits inside
        // CONTAINER_HEADER_TEXT_HEIGHT - nameFontSize (5px here), which previously
        // forced the two clamped lines to overlap by design of the independent clamp.
        const hugeFont: CustomTheme = {
            background: '#ffffff',
            edgeColors: { choice: '#000', default: '#000', error: '#000', normal: '#000' },
            fontFamily: 'sans-serif',
            fontSize: 35,
            nodeColors: {},
        };

        const { nodes, svg } = render('distributed-map', hugeFont);
        const container = nodes.find((node) => node.id === 'ProcessItems')!;
        const halfHeight = (container.height ?? 0) / 2;

        const lines = headerLines(svg, 'ProcessItems');
        // The sub-label is dropped rather than overlapping the name: only one line.
        expect(lines).toHaveLength(1);
        expect(lines[0].fontSize).toBe(35);
        expect(svg).not.toContain('Distributed');

        for (const line of lines) {
            expect(line.y - line.fontSize / 2).toBeGreaterThanOrEqual(-halfHeight);
            expect(line.y + line.fontSize / 2).toBeLessThanOrEqual(
                -halfHeight + CONTAINER_HEADER_TEXT_HEIGHT
            );
        }
    });

    it('states the text height as the gap the layout actually leaves', () => {
        // Derived from the layout rather than restating a constant: the text height is
        // the container's top padding, which is what separates its box from its children.
        const { nodes } = render('parallel');
        const byId = new Map(nodes.map((node) => [node.id, node]));
        const container = nodes.find((node) => node.isContainer)!;

        const children = (container.children ?? [])
            .map((id) => byId.get(id))
            .filter((child): child is StateNode => child !== undefined);
        const containerTop = (container.y ?? 0) - (container.height ?? 0) / 2;
        const firstChildTop = Math.min(
            ...children.map((child) => (child.y ?? 0) - (child.height ?? 0) / 2)
        );

        expect(firstChildTop - containerTop).toBe(CONTAINER_PADDING);
        expect(CONTAINER_HEADER_TEXT_HEIGHT).toBe(firstChildTop - containerTop);
    });

    it('still shows the sub-label the overlap used to hide', () => {
        expect(render('distributed-map').svg).toContain('Distributed');
    });
});
