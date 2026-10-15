import { describe, expect, it } from 'vitest';
import { generateSvg } from '../src';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import {
    anchorCatchLaneEnds,
    buildAcyclicPredecessors,
    CATCH_LANE_MIN_SOURCES,
    findLaneCollisions,
    routeCatchLanes,
    selectLaneCatchEdges,
} from '../src/layout/catchLanes';
import { measureEdgeLabel } from '../src/layout/edgeLabel';
import type { GraphEdge, StateNode } from '../src/types';
import { buildSharedCatchChain } from './performance/fixtures';

const flow = (from: string, to: string): { from: string; id: string; to: string } => ({
    from,
    id: `${from}->${to}#normal#0`,
    to,
});

const catchEdge = (from: string, to: string, ordinal = 0): GraphEdge => ({
    from,
    id: `${from}->${to}#error#${ordinal}`,
    to,
    type: 'error',
});

describe('buildAcyclicPredecessors', () => {
    it('lists predecessors along a chain', () => {
        const predecessors = buildAcyclicPredecessors({
            edges: [flow('A', 'B'), flow('B', 'C')],
            nodeIds: ['A', 'B', 'C'],
        });
        expect(predecessors.get('B')).toEqual(['A']);
        expect(predecessors.get('C')).toEqual(['B']);
        expect(predecessors.has('A')).toBe(false);
    });

    it('collects every predecessor of a join', () => {
        const predecessors = buildAcyclicPredecessors({
            edges: [flow('A', 'B'), flow('B', 'D'), flow('A', 'D')],
            nodeIds: ['A', 'B', 'D'],
        });
        expect(predecessors.get('D')).toEqual(['B', 'A']);
    });

    it('drops the back edge of a cycle', () => {
        const predecessors = buildAcyclicPredecessors({
            edges: [flow('A', 'B'), flow('B', 'C'), flow('C', 'A')],
            nodeIds: ['A', 'B', 'C'],
        });
        expect(predecessors.has('A')).toBe(false);
        expect(predecessors.get('C')).toEqual(['B']);
    });

    it('handles an 8000-node chain without overflowing the stack', () => {
        const nodeIds = Array.from({ length: 8000 }, (_, index) => `N${index}`);
        const edges = nodeIds.slice(1).map((id, index) => flow(nodeIds[index], id));
        const predecessors = buildAcyclicPredecessors({ edges, nodeIds });
        expect(predecessors.get('N7999')).toEqual(['N7998']);
    });
});

describe('selectLaneCatchEdges', () => {
    const chain = (names: string[]): Array<{ from: string; id: string; to: string }> =>
        names.slice(1).map((name, index) => flow(names[index], name));

    it('returns nothing below CATCH_LANE_MIN_SOURCES', () => {
        const names = ['A', 'B', 'C', 'F'];
        const candidates = names.slice(0, 3).map((name) => catchEdge(name, 'F'));
        expect(CATCH_LANE_MIN_SOURCES).toBe(4);
        expect(
            selectLaneCatchEdges({ candidates, nodeIds: names, rankedEdges: chain(names) }).size,
        ).toBe(0);
    });

    it('withholds every catcher that leads to another catcher', () => {
        const names = ['A', 'B', 'C', 'D', 'F'];
        const candidates = names.slice(0, 4).map((name) => catchEdge(name, 'F'));
        const withheld = selectLaneCatchEdges({
            candidates,
            nodeIds: names,
            rankedEdges: [...chain(names.slice(0, 4)), ...candidates.map((edge) => ({ from: edge.from, id: edge.id, to: edge.to }))],
        });
        expect([...withheld].sort()).toEqual([candidates[0].id, candidates[1].id, candidates[2].id].sort());
    });

    it('keeps catchers on separate branches', () => {
        const names = ['Choice', 'A0', 'A1', 'A2', 'Join', 'X', 'B0', 'F'];
        const flowEdges = [
            flow('Choice', 'A0'),
            flow('A0', 'A1'),
            flow('A1', 'A2'),
            flow('A2', 'Join'),
            flow('Join', 'X'),
            flow('Choice', 'B0'),
            flow('B0', 'X'),
        ];
        const candidates = ['A0', 'A1', 'A2', 'B0'].map((name) => catchEdge(name, 'F'));
        const withheld = selectLaneCatchEdges({ candidates, nodeIds: names, rankedEdges: flowEdges });
        expect([...withheld].sort()).toEqual([candidates[0].id, candidates[1].id].sort());
    });

    it('ignores catch edges when deciding ancestry', () => {
        const names = ['A', 'B', 'C', 'D', 'F', 'G'];
        const candidates = ['A', 'B', 'C', 'D'].map((name) => catchEdge(name, 'F'));
        const linking = ['A', 'B', 'C', 'D'].map((name) => ({ ...catchEdge(name, 'G'), id: `${name}->G#error#0` }));
        const rankedEdges = [...candidates, ...linking].map((edge) => ({
            from: edge.from,
            id: edge.id,
            to: edge.to,
        }));
        expect(selectLaneCatchEdges({ candidates, nodeIds: names, rankedEdges }).size).toBe(0);
    });

    it('withholds every duplicate catch edge of a withheld state', () => {
        const names = ['A', 'B', 'C', 'D', 'F'];
        const candidates = [
            catchEdge('A', 'F', 0),
            catchEdge('A', 'F', 1),
            catchEdge('B', 'F'),
            catchEdge('C', 'F'),
            catchEdge('D', 'F'),
        ];
        const withheld = selectLaneCatchEdges({
            candidates,
            nodeIds: names,
            rankedEdges: chain(names.slice(0, 4)),
        });
        expect(withheld.has(candidates[0].id)).toBe(true);
        expect(withheld.has(candidates[1].id)).toBe(true);
        expect(withheld.has(candidates[4].id)).toBe(false);
    });
});

describe('findLaneCollisions', () => {
    const box = { height: 100, width: 100, x: 0, y: 0 };
    const through = {
        points: [
            { x: -80, y: 0 },
            { x: 80, y: 0 },
        ],
    };
    const grazing = {
        points: [
            { x: -80, y: 50 },
            { x: 80, y: 50 },
        ],
    };
    const clear = {
        points: [
            { x: -80, y: -200 },
            { x: -80, y: 200 },
            { x: 200, y: 200 },
        ],
    };

    it('reports a route segment through a box', () => {
        expect([...findLaneCollisions({ boxes: [box], routes: new Map([['through', through]]) })]).toEqual(['through']);
    });

    it('ignores a segment that only grazes a box edge', () => {
        expect(findLaneCollisions({ boxes: [box], routes: new Map([['grazing', grazing]]) }).size).toBe(0);
    });

    it('reports nothing for routes clear of every box', () => {
        expect(findLaneCollisions({ boxes: [box], routes: new Map([['clear', clear]]) }).size).toBe(0);
    });

    it('reports only the colliding routes', () => {
        const routes = new Map([
            ['clear', clear],
            ['through', through],
            ['grazing', grazing],
        ]);
        expect([...findLaneCollisions({ boxes: [box], routes })]).toEqual(['through']);
    });
});

describe('routeCatchLanes', () => {
    const node = (id: string, y: number, x = 100): StateNode => ({ height: 40, id, label: id, type: 'Task', width: 100, x, y });

    it('keeps routes finite when an endpoint is an open container', () => {
        const container: StateNode = { ...node('Box', 300), height: 120, isContainer: true, width: 200 };
        const routes = routeCatchLanes({
            edges: ['A', 'B', 'C', 'D'].map((id) => catchEdge(id, 'Box')),
            layout: 'TB',
            nodes: [node('A', 0), node('B', 60), node('C', 120), node('D', 180), container],
            obstacleEdges: [],
            rankSeparation: 50,
            themeFontSize: 14,
        });
        expect(routes.size).toBe(4);
        for (const route of routes.values()) {
            for (const point of route.points) {
                expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
            }
        }
    });

    it('steps into an open container outside its box when a plain state shares its row', () => {
        const container: StateNode = { ...node('Box', 300), height: 120, isContainer: true, width: 200 };
        const routes = routeCatchLanes({
            edges: ['A', 'B', 'C', 'D'].map((id) => catchEdge(id, 'Box')),
            layout: 'TB',
            nodes: [node('A', 0), node('B', 60), node('C', 120), node('D', 180), node('Side', 300, 400), container],
            obstacleEdges: [],
            rankSeparation: 50,
            themeFontSize: 14,
        });
        const boxTop = 300 - 120 / 2;
        for (const route of routes.values()) {
            expect(route.points[route.points.length - 2].y).toBeLessThanOrEqual(boxTop);
        }
    });

    it('moves a label too long for any stretch off a trunk that already has one', () => {
        // A and B share the row just above H, so neither label fits its one-gap stretch
        // on any trunk; each is centred on it, so B needs its own trunk to avoid A's.
        const label = 'Error: States.TaskFailed';
        const routes = routeCatchLanes({
            edges: [
                { ...catchEdge('A', 'H'), label },
                { ...catchEdge('B', 'H'), label },
            ],
            layout: 'TB',
            nodes: [node('A', 100, 100), node('B', 100, 300), node('H', 190, 200)],
            obstacleEdges: [],
            rankSeparation: 50,
            themeFontSize: 14,
        });
        const first = routes.get('A->H#error#0');
        const second = routes.get('B->H#error#0');
        expect(first?.labelPosition).toBeDefined();
        expect(second?.labelPosition).toBeDefined();
        expect(first?.labelPosition).not.toEqual(second?.labelPosition);
        expect(first?.points[2].x).not.toBe(second?.points[2].x);
    });

    it('opens no trunk for a label too long for its stretch on any trunk', () => {
        // U and L share the row just above H; U's unlabelled stub joins the trunk first,
        // and L's label cannot fit the one-gap stretch on this trunk or a fresh one.
        const labelled = { ...catchEdge('L', 'H'), label: 'Error: States.TaskFailed' };
        const routes = routeCatchLanes({
            edges: [catchEdge('U', 'H'), labelled],
            layout: 'TB',
            nodes: [node('U', 100, 100), node('L', 100, 300), node('H', 190, 200)],
            obstacleEdges: [],
            rankSeparation: 50,
            themeFontSize: 14,
        });
        const unlabelledLane = routes.get('U->H#error#0')?.points[2].x;
        const labelledLane = routes.get('L->H#error#0')?.points[2].x;
        expect(unlabelledLane).toBeDefined();
        expect(labelledLane).toBe(unlabelledLane);
    });

    it('keeps the lane clear of a label the renderer centres on its path', () => {
        const label = 'A fairly long label on a hand-routed edge';
        const width = measureEdgeLabel({ label, themeFontSize: 14 }).width;
        const routes = routeCatchLanes({
            edges: [catchEdge('S', 'H')],
            layout: 'TB',
            nodes: [node('S', 100), node('H', 300)],
            obstacleEdges: [
                {
                    label,
                    points: [
                        { x: 40, y: 150 },
                        { x: 40, y: 250 },
                    ],
                },
            ],
            rankSeparation: 50,
            themeFontSize: 14,
        });
        const laneX = routes.get('S->H#error#0')?.points[2].x ?? Infinity;
        expect(laneX).toBeLessThanOrEqual(40 - width / 2 - 20 + 1e-6);
    });
});

describe('anchorCatchLaneEnds', () => {
    const layoutChain = () => {
        const { nodes, edges } = parseAsl({ definition: buildSharedCatchChain({ length: 12 }) });
        return new DagreLayout({ layout: 'TB' }).calculate(nodes, edges);
    };

    it('re-attaches a lane end to the shape an override draws', () => {
        const result = layoutChain();
        const failed = result.nodes.find((candidate) => candidate.id === 'Failed') as StateNode;
        expect(failed.style?.shape ?? 'rect').toBe('rect');
        const edge = result.edges.find((candidate) => candidate.catchLane && candidate.to === 'Failed');
        const points = anchorCatchLaneEnds({
            edge: edge as GraphEdge & { points: Array<{ x: number; y: number }> },
            layout: 'TB',
            nodeOverrides: { Failed: { shape: 'circle' } },
            nodesById: new Map(result.nodes.map((candidate) => [candidate.id, candidate])),
        });
        const original = edge?.points ?? [];
        const end = points[points.length - 1];
        // renderCircle draws a circle of radius width / 2 about the node centre.
        const radius = (failed.width ?? 0) / 2;
        const offset = end.x - (failed.x ?? 0);
        expect(end.y).toBeCloseTo((failed.y ?? 0) - Math.sqrt(radius * radius - offset * offset), 6);
        expect(Math.abs(end.y - original[original.length - 1].y)).toBeGreaterThan(1);
        expect(points[points.length - 2].x).toBeCloseTo(end.x, 6);
        expect(points[0]).toEqual(original[0]);
    });

    it('is applied by the curved renderer', () => {
        const pathEnd = (svg: string): number[] => {
            const tag = svg.match(/<path[^>]*data-edge-id="Step0-(?:>|&gt;)Failed#error#0"[^>]*>/)?.[0] ?? '';
            const numbers = (tag.match(/ d="([^"]*)"/)?.[1] ?? '').match(/-?\d+(\.\d+)?/g) ?? [];
            return numbers.slice(-2).map(Number);
        };
        const aslDefinition = buildSharedCatchChain({ length: 12 });
        const plain = pathEnd(generateSvg({ aslDefinition, edgeStyle: 'curved' }).svg);
        const overridden = pathEnd(
            generateSvg({ aslDefinition, edgeStyle: 'curved', nodeOverrides: { Failed: { shape: 'circle' } } }).svg,
        );
        expect(plain).toHaveLength(2);
        expect(overridden).toHaveLength(2);
        expect(Math.abs(overridden[1] - plain[1])).toBeGreaterThan(1);
    });
});
