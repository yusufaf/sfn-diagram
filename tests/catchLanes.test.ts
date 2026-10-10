import { describe, expect, it } from 'vitest';
import {
    buildAcyclicPredecessors,
    CATCH_LANE_MIN_SOURCES,
    findLaneCollisions,
    selectLaneCatchEdges,
} from '../src/layout/catchLanes';
import type { GraphEdge } from '../src/types';

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

    it('reports a route segment through a box', () => {
        const route = {
            points: [
                { x: -80, y: 0 },
                { x: 80, y: 0 },
            ],
        };
        expect(findLaneCollisions({ boxes: [box], routes: [route] })).toBe(true);
    });

    it('ignores a segment that only grazes a box edge', () => {
        const route = {
            points: [
                { x: -80, y: 50 },
                { x: 80, y: 50 },
            ],
        };
        expect(findLaneCollisions({ boxes: [box], routes: [route] })).toBe(false);
    });

    it('reports nothing for routes clear of every box', () => {
        const route = {
            points: [
                { x: -80, y: -200 },
                { x: -80, y: 200 },
                { x: 200, y: 200 },
            ],
        };
        expect(findLaneCollisions({ boxes: [box], routes: [route] })).toBe(false);
    });
});
