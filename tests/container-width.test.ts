import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { SvgRenderer } from '../src/renderers';
import { CONTAINER_MAX_HEADER_WIDTH, CONTAINER_PADDING } from '../src/constants';
import type { AslDefinition, StateNode } from '../src/types';

/**
 * A container's box was sized purely from its children, so a Distributed Map's full
 * sub-label (mode, concurrency, tolerance, batching) or a long container name could
 * need more width than the children left it - see the `distributed-map` fixture,
 * where the header used to render `Distributed · max 100 · …` instead of the full
 * line. DagreLayout.calculateContainerBounds now widens a container to fit its
 * header too, capped at CONTAINER_MAX_HEADER_WIDTH so a single long expression
 * can't stretch a container across the whole diagram instead of eliding.
 */

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf8'),
    ) as AslDefinition;
}

function render(definition: AslDefinition): { nodes: StateNode[]; svg: string } {
    const { edges, nodes } = parseAsl({ definition });
    const layout = new DagreLayout({}).calculate(nodes, edges);
    return { nodes: layout.nodes, svg: new SvgRenderer({}).render(layout).svg };
}

interface Box {
    id: string;
    xMax: number;
    xMin: number;
    yMax: number;
    yMin: number;
}

function boxOf(node: StateNode): Box {
    const halfWidth = (node.width ?? 0) / 2;
    const halfHeight = (node.height ?? 0) / 2;
    return {
        id: node.id,
        xMax: (node.x ?? 0) + halfWidth,
        xMin: (node.x ?? 0) - halfWidth,
        yMax: (node.y ?? 0) + halfHeight,
        yMin: (node.y ?? 0) - halfHeight,
    };
}

function overlaps(a: Box, b: Box): boolean {
    return a.xMin < b.xMax && a.xMax > b.xMin && a.yMin < b.yMax && a.yMax > b.yMin;
}

/**
 * The container's own name text, not the `data-state-id`/edge-id attributes that
 * necessarily carry the full, un-elided id alongside it.
 */
function headerNameText(svg: string, containerId: string): string {
    const group = svg.match(
        new RegExp(`<g class="container[^"]*" data-state-id="${containerId}"[^>]*>([\\s\\S]*?)</g>`),
    );
    expect(group).not.toBeNull();
    const nameText = group![1].match(/<text [^>]*>([^<]*)<\/text>/);
    expect(nameText).not.toBeNull();
    return nameText![1];
}

/** Every id reachable from a container through nested `children` links, container included. */
function descendantIds(node: StateNode, byId: Map<string, StateNode>): Set<string> {
    const ids = new Set<string>([node.id]);
    for (const childId of node.children ?? []) {
        const child = byId.get(childId);
        if (!child) continue;
        for (const id of descendantIds(child, byId)) ids.add(id);
    }
    return ids;
}

describe('container header width', () => {
    it('renders the full sub-label on distributed-map, with nothing elided', () => {
        const { svg } = render(loadFixture('distributed-map'));
        expect(svg).toContain('Distributed · max 100 · tolerate 5% · batches of 50');
        expect(svg).not.toContain('…');
    });

    it('does not horizontally overlap a container box with an unrelated node', () => {
        const fixtureFiles = readdirSync(join(__dirname, 'fixtures')).filter((file) =>
            file.endsWith('.asl.json'),
        );

        for (const file of fixtureFiles) {
            const name = basename(file, '.asl.json');
            const { nodes } = render(loadFixture(name));
            const byId = new Map(nodes.map((node) => [node.id, node]));
            const containers = nodes.filter((node) => node.isContainer);

            // A container nested inside another (e.g. `nested-map`'s Map-in-Parallel) is
            // excluded here: nesting isn't handled at all yet - the outer container's
            // children never include the inner one's descendants (they resolve to
            // `undefined` and are silently skipped) - so an inner container already
            // overlaps its own outer siblings before this fix, for reasons unrelated to
            // header width. Only a top-level container's widening is this test's concern.
            const nestedContainerIds = new Set(
                containers.flatMap((container) =>
                    [...descendantIds(container, byId)].filter((id) => id !== container.id),
                ),
            );

            for (const container of containers) {
                if (nestedContainerIds.has(container.id)) continue;
                const related = descendantIds(container, byId);
                const containerBox = boxOf(container);

                for (const other of nodes) {
                    if (related.has(other.id)) continue;
                    expect(
                        overlaps(containerBox, boxOf(other)),
                        `${name}: container "${container.id}" overlaps unrelated node "${other.id}"`,
                    ).toBe(false);
                }
            }
        }
    });

    it('caps a very long container name at CONTAINER_MAX_HEADER_WIDTH and elides it', () => {
        const longName = 'VeryLongContainerNameThatWouldOtherwiseStretchTheDiagram'.repeat(3);
        const definition: AslDefinition = {
            StartAt: longName,
            States: {
                [longName]: {
                    Type: 'Parallel',
                    Branches: [
                        {
                            StartAt: 'A',
                            States: { A: { Type: 'Pass', End: true } },
                        },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        };

        const { nodes, svg } = render(definition);
        const container = nodes.find((node) => node.id === longName)!;

        expect(container.width).toBe(CONTAINER_MAX_HEADER_WIDTH);
        const nameText = headerNameText(svg, longName);
        expect(nameText).not.toBe(longName);
        expect(nameText).toContain('…');
    });

    it('keeps the children-derived width when children need more room than the header', () => {
        const definition: AslDefinition = {
            StartAt: 'P',
            States: {
                P: {
                    Type: 'Parallel',
                    Branches: [
                        {
                            StartAt: 'BranchA',
                            States: {
                                BranchA: {
                                    Type: 'Task',
                                    Resource: 'arn:aws:lambda:::function:a-fairly-long-resource-name',
                                    End: true,
                                },
                            },
                        },
                        {
                            StartAt: 'BranchB',
                            States: {
                                BranchB: {
                                    Type: 'Task',
                                    Resource: 'arn:aws:lambda:::function:another-fairly-long-one',
                                    End: true,
                                },
                            },
                        },
                    ],
                    Next: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        };

        const { nodes } = render(definition);
        const byId = new Map(nodes.map((node) => [node.id, node]));
        const container = nodes.find((node) => node.id === 'P')!;

        const children = (container.children ?? [])
            .map((id) => byId.get(id))
            .filter((child): child is StateNode => child !== undefined);
        let minX = Infinity;
        let maxX = -Infinity;
        for (const child of children) {
            const halfWidth = (child.width ?? 0) / 2;
            minX = Math.min(minX, (child.x ?? 0) - halfWidth);
            maxX = Math.max(maxX, (child.x ?? 0) + halfWidth);
        }
        // Reconstructs the pre-fix, children-only formula to confirm the short name
        // "P" left the width exactly where the children put it, rather than growing
        // or shrinking it toward a header-driven minimum.
        expect(container.width).toBe(maxX - minX + CONTAINER_PADDING * 2);
    });
});
