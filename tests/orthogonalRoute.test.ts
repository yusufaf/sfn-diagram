import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import {
    buildRoundedOrthogonalPath,
    routeOrthogonalEdges,
} from '../src/layout/orthogonalRoute';
import type { LayoutResult } from '../src/layout/DagreLayout';
import type { AslDefinition, StateNode } from '../src/types';
import { buildSharedCatchChain } from './performance/fixtures';
import { isLaneRoute } from './helpers/catchLaneFixtures';

type RoutedEdge = LayoutResult['edges'][number];
interface Point {
    x: number;
    y: number;
}

const loadFixture = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'));

const makeNode = (overrides: Partial<StateNode> & { id: string }): StateNode => ({
    label: overrides.id,
    type: 'Task',
    style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' },
    x: 0,
    y: 0,
    width: 120,
    height: 60,
    ...overrides,
});

const makeEdge = (from: string, to: string, points: Point[]): RoutedEdge => ({
    from,
    id: `${from}->${to}#normal#0`,
    points,
    to,
    type: 'normal',
});

const pointsOf = (edge: RoutedEdge): Point[] => edge.points ?? [];

describe('routeOrthogonalEdges', () => {
    it('returns self-loops, short and non-finite edges unchanged and never mutates its input', () => {
        const nodes = [makeNode({ id: 'A', x: 100, y: 100 }), makeNode({ id: 'B', x: 300, y: 100 })];
        const selfLoop = makeEdge('A', 'A', [
            { x: 160, y: 90 },
            { x: 190, y: 80 },
            { x: 160, y: 110 },
        ]);
        const single = makeEdge('A', 'B', [{ x: 1, y: 1 }]);
        const missing: RoutedEdge = { from: 'A', id: 'A->B#normal#1', to: 'B', type: 'normal' };
        const nonFinite = makeEdge('A', 'B', [
            { x: 1, y: 1 },
            { x: Number.NaN, y: 2 },
        ]);
        const bent = makeEdge('A', 'B', [
            { x: 100, y: 130 },
            { x: 150, y: 150 },
            { x: 300, y: 130 },
        ]);
        const edges = [selfLoop, single, missing, nonFinite, bent];
        const snapshot = JSON.stringify(edges);

        const routed = routeOrthogonalEdges({ edges, layout: 'TB', nodes });

        expect(routed[0]).toBe(selfLoop);
        expect(routed[1]).toBe(single);
        expect(routed[2]).toBe(missing);
        expect(routed[3]).toBe(nonFinite);
        expect(routed[4]).not.toBe(bent);
        expect(JSON.stringify(edges)).toBe(snapshot);
    });

    it('routes a 2-point edge through the midpoint of the flow axis', () => {
        const [edge] = routeOrthogonalEdges({
            edges: [
                makeEdge('A', 'B', [
                    { x: 165, y: 30 },
                    { x: 250, y: 20 },
                ]),
            ],
            layout: 'TB',
            nodes: [],
        });

        expect(pointsOf(edge)).toEqual([
            { x: 165, y: 30 },
            { x: 165, y: 25 },
            { x: 250, y: 25 },
            { x: 250, y: 20 },
        ]);
    });

    describe('dagre-routed edges', () => {
        const tbNodes = [
            makeNode({ id: 'A', x: 250, y: 50 }),
            makeNode({ id: 'B', x: 420, y: 160 }),
        ];
        const tbEdge = makeEdge('A', 'B', [
            { x: 250, y: 80 },
            { x: 420, y: 105 },
            { x: 420, y: 130 },
        ]);

        it('anchors on the facing sides and clamps the lane to the middle half of a side', () => {
            const [edge] = routeOrthogonalEdges({ edges: [tbEdge], layout: 'TB', nodes: tbNodes });

            expect(pointsOf(edge)).toEqual([
                { x: 280, y: 80 },
                { x: 280, y: 105 },
                { x: 420, y: 105 },
                { x: 420, y: 130 },
            ]);
        });

        it('swaps the flow frame for LR', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('A', 'B', [
                        { x: 310, y: 50 },
                        { x: 335, y: 160 },
                        { x: 360, y: 160 },
                    ]),
                ],
                layout: 'LR',
                nodes: [makeNode({ id: 'A', x: 250, y: 50 }), makeNode({ id: 'B', x: 420, y: 160 })],
            });

            const points = pointsOf(edge);
            expect(points[0].x).toBe(310);
            expect(points[points.length - 1]).toEqual({ x: 360, y: 160 });
            for (let i = 1; i < points.length; i += 1) {
                const aligned = points[i].x === points[i - 1].x || points[i].y === points[i - 1].y;
                expect(aligned).toBe(true);
            }
            // Horizontal first: the first leg leaves along the flow axis.
            expect(points[1].y).toBe(points[0].y);
        });

        it('anchors a back edge on the source top side', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('B', 'A', [
                        { x: 420, y: 130 },
                        { x: 340, y: 105 },
                        { x: 250, y: 80 },
                    ]),
                ],
                layout: 'TB',
                nodes: tbNodes,
            });

            expect(pointsOf(edge)[0].y).toBe(130);
            expect(pointsOf(edge)[pointsOf(edge).length - 1].y).toBe(80);
        });

        it('lands a diamond anchor on the diamond outline', () => {
            const diamond = makeNode({
                id: 'D',
                style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'diamond' },
                x: 250,
                y: 50,
            });
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('D', 'B', [
                        { x: 250, y: 80 },
                        { x: 420, y: 105 },
                        { x: 420, y: 130 },
                    ]),
                ],
                layout: 'TB',
                nodes: [diamond, tbNodes[1]],
            });

            const start = pointsOf(edge)[0];
            expect(Math.abs(start.x - 250) / 60 + Math.abs(start.y - 50) / 30).toBeCloseTo(1, 5);
        });

        it('lands a circle anchor on the circle outline', () => {
            const circle = makeNode({
                id: 'C',
                style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'circle' },
                x: 250,
                y: 50,
                width: 60,
                height: 60,
            });
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('C', 'B', [
                        { x: 250, y: 80 },
                        { x: 420, y: 105 },
                        { x: 420, y: 130 },
                    ]),
                ],
                layout: 'TB',
                nodes: [circle, tbNodes[1]],
            });

            const start = pointsOf(edge)[0];
            expect(Math.hypot(start.x - 250, start.y - 50)).toBeCloseTo(30, 5);
        });

        it('anchors an overridden circle at its drawn radius (width / 2)', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('A', 'B', [
                        { x: 310, y: 50 },
                        { x: 335, y: 50 },
                        { x: 360, y: 160 },
                    ]),
                ],
                layout: 'LR',
                nodeOverrides: { A: { shape: 'circle' } },
                nodes: [makeNode({ id: 'A', x: 250, y: 50 }), makeNode({ id: 'B', x: 420, y: 160 })],
            });

            const start = pointsOf(edge)[0];
            expect(Math.hypot(start.x - 250, start.y - 50)).toBeCloseTo(60, 5);
        });

        it('collapses an aligned edge to two points', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('A', 'B', [
                        { x: 250, y: 80 },
                        { x: 250, y: 105 },
                        { x: 250, y: 130 },
                    ]),
                ],
                layout: 'TB',
                nodes: [makeNode({ id: 'A', x: 250, y: 50 }), makeNode({ id: 'B', x: 250, y: 160 })],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 250, y: 80 },
                { x: 250, y: 130 },
            ]);
        });
    });

    describe('an edge out of a container to a node behind it', () => {
        it('leaves the Map side facing the writer in TB', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('Map', 'Writer', [
                        { x: 165, y: 390 },
                        { x: 420, y: 20 },
                    ]),
                ],
                layout: 'TB',
                nodes: [
                    makeNode({
                        id: 'Map',
                        isContainer: true,
                        children: ['Inner'],
                        x: 165,
                        y: 240,
                        width: 480,
                        height: 300,
                    }),
                    makeNode({ id: 'Writer', x: 420, y: 50 }),
                ],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 405, y: 240 },
                { x: 420, y: 240 },
                { x: 420, y: 80 },
            ]);
        });

        it('leaves the Map side facing the writer in LR', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('Map', 'Writer', [
                        { x: 575, y: 130 },
                        { x: 20, y: 270 },
                    ]),
                ],
                layout: 'LR',
                nodes: [
                    makeNode({
                        id: 'Map',
                        isContainer: true,
                        children: ['Inner'],
                        x: 335,
                        y: 130,
                        width: 480,
                        height: 190,
                    }),
                    makeNode({ id: 'Writer', x: 80, y: 270 }),
                ],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 335, y: 225 },
                { x: 335, y: 270 },
                { x: 140, y: 270 },
            ]);
        });

        it('leaves the Map side facing the writer in BT', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('Map', 'Writer', [
                        { x: 165, y: 106 },
                        { x: 420, y: 476 },
                    ]),
                ],
                layout: 'BT',
                nodes: [
                    makeNode({
                        id: 'Map',
                        isContainer: true,
                        children: ['Inner'],
                        x: 165,
                        y: 256,
                        width: 480,
                        height: 300,
                    }),
                    makeNode({ id: 'Writer', x: 420, y: 446 }),
                ],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 405, y: 256 },
                { x: 420, y: 256 },
                { x: 420, y: 416 },
            ]);
        });

        it('does not fire when the target is not behind the container entry side', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('Fan', 'Each', [
                        { x: 250, y: 280 },
                        { x: 165, y: 266 },
                    ]),
                ],
                layout: 'TB',
                nodes: [
                    makeNode({
                        id: 'Fan',
                        isContainer: true,
                        children: ['Ok'],
                        x: 250,
                        y: 130,
                        width: 540,
                        height: 300,
                    }),
                    makeNode({
                        id: 'Each',
                        isContainer: true,
                        children: [],
                        x: 165,
                        y: 471,
                        width: 370,
                        height: 410,
                    }),
                ],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 250, y: 280 },
                { x: 250, y: 273 },
                { x: 165, y: 273 },
                { x: 165, y: 266 },
            ]);
        });

        it('does not fire for an edge from a container to its own child', () => {
            const [edge] = routeOrthogonalEdges({
                edges: [
                    makeEdge('Map', 'Inner', [
                        { x: 165, y: 390 },
                        { x: 165, y: 20 },
                    ]),
                ],
                layout: 'TB',
                nodes: [
                    makeNode({
                        id: 'Map',
                        isContainer: true,
                        children: ['Inner'],
                        x: 165,
                        y: 240,
                        width: 480,
                        height: 300,
                    }),
                    makeNode({ id: 'Inner', x: 165, y: 50 }),
                ],
            });

            expect(pointsOf(edge)).toEqual([
                { x: 165, y: 390 },
                { x: 165, y: 20 },
            ]);
        });
    });
});

describe('buildRoundedOrthogonalPath', () => {
    it('returns null for fewer than two points', () => {
        expect(buildRoundedOrthogonalPath({ points: [{ x: 0, y: 0 }], radius: 5 })).toBeNull();
    });

    it('draws a straight line through two points', () => {
        expect(
            buildRoundedOrthogonalPath({
                points: [
                    { x: 0, y: 0 },
                    { x: 0, y: 40 },
                ],
                radius: 5,
            }),
        ).toBe('M0,0L0,40');
    });

    it('rounds a corner with both control points on the vertex', () => {
        expect(
            buildRoundedOrthogonalPath({
                points: [
                    { x: 0, y: 0 },
                    { x: 0, y: 50 },
                    { x: 100, y: 50 },
                ],
                radius: 5,
            }),
        ).toBe('M0,0L0,45C0,50,0,50,5,50L100,50');
    });

    it('clamps the radius to half of a short leg', () => {
        expect(
            buildRoundedOrthogonalPath({
                points: [
                    { x: 0, y: 0 },
                    { x: 0, y: 4 },
                    { x: 50, y: 4 },
                ],
                radius: 5,
            }),
        ).toBe('M0,0L0,2C0,4,0,4,2,4L50,4');
    });
});

interface CollinearOverlapParams {
    first: Point[];
    second: Point[];
}

/** Total length over which two polylines run on top of each other (same x or same y). */
function collinearOverlap(params: CollinearOverlapParams): number {
    const { first, second } = params;
    let total = 0;
    for (let i = 1; i < first.length; i += 1) {
        for (let j = 1; j < second.length; j += 1) {
            const [a1, a2, b1, b2] = [first[i - 1], first[i], second[j - 1], second[j]];
            const bothVertical =
                Math.abs(a1.x - a2.x) < 1e-3 && Math.abs(b1.x - b2.x) < 1e-3 && Math.abs(a1.x - b1.x) < 1e-3;
            const bothHorizontal =
                Math.abs(a1.y - a2.y) < 1e-3 && Math.abs(b1.y - b2.y) < 1e-3 && Math.abs(a1.y - b1.y) < 1e-3;
            const key = bothVertical ? 'y' : bothHorizontal ? 'x' : undefined;
            if (!key) continue;
            const overlap =
                Math.min(Math.max(a1[key], a2[key]), Math.max(b1[key], b2[key])) -
                Math.max(Math.min(a1[key], a2[key]), Math.min(b1[key], b2[key]));
            if (overlap > 0) total += overlap;
        }
    }
    return total;
}

describe('routeOrthogonalEdges on fixtures', () => {
    const loopDefinition: AslDefinition = {
        StartAt: 'Submit',
        States: {
            Submit: { Type: 'Task', Resource: 'arn:aws:lambda:::submit', Next: 'Wait' },
            Wait: { Type: 'Wait', Seconds: 5, Next: 'Check' },
            Check: {
                Type: 'Choice',
                Choices: [
                    { Variable: '$.status', StringEquals: 'PENDING', Next: 'Wait' },
                    { Variable: '$.status', StringEquals: 'RETRY', Next: 'Submit' },
                ],
                Default: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    };
    const definitions: Array<[string, AslDefinition]> = [
        ...[
            'choice',
            'error-handling',
            'parallel',
            'nested-map',
            'map',
            'distributed-map',
            'jsonata-io',
        ].map((name): [string, AslDefinition] => [name, loadFixture(name)]),
        ['loop', loopDefinition],
    ];

    it.each(definitions)('never overlaps two edges that share no endpoint (%s)', (name, definition) => {
        for (const layout of ['TB', 'LR', 'BT', 'RL'] as const) {
            const { nodes, edges } = parseAsl({ definition });
            const positioned = new DagreLayout({ layout }).calculate(nodes, edges);
            const routed = routeOrthogonalEdges({ edges: positioned.edges, layout, nodes: positioned.nodes })
                .filter((edge) => edge.from !== edge.to && edge.points);

            for (let i = 0; i < routed.length; i += 1) {
                for (let j = i + 1; j < routed.length; j += 1) {
                    const [first, second] = [routed[i], routed[j]];
                    if (new Set([first.from, first.to, second.from, second.to]).size < 4) continue;
                    const overlap = collinearOverlap({
                        first: pointsOf(first),
                        second: pointsOf(second),
                    });
                    expect(overlap, `${name} ${layout} ${first.id} <> ${second.id}`).toBeLessThanOrEqual(1e-3);
                }
            }
        }
    });
});

describe('catch lane routes', () => {
    it.each(['TB', 'LR'] as const)("keeps a lane route's corners when orthogonalized (%s)", (layout) => {
        const { nodes, edges } = parseAsl({ definition: buildSharedCatchChain({ length: 12 }) });
        const positioned = new DagreLayout({ layout }).calculate(nodes, edges);
        const routed = routeOrthogonalEdges({ edges: positioned.edges, layout, nodes: positioned.nodes });
        const laneEdges = positioned.edges.filter((edge) => isLaneRoute({ edge, layout, nodes: positioned.nodes }));
        expect(laneEdges.length).toBe(11);
        for (const laneEdge of laneEdges) {
            const original = laneEdge.points ?? [];
            const expected = [0, 1, 2, 7, 8, 9].map((index) => original[index]);
            const actual = routed.find((edge) => edge.id === laneEdge.id)?.points ?? [];
            expect(actual).toHaveLength(6);
            actual.forEach((point, index) => {
                expect(point.x).toBeCloseTo(expected[index].x, 6);
                expect(point.y).toBeCloseTo(expected[index].y, 6);
            });
        }
    });
});
