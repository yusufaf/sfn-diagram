import { describe, it, expect } from 'vitest';
import { flattenMarkers } from '../../src/graph';
import type { GraphEdge, StateNode } from '../../src/types';

const node = (overrides: Partial<StateNode> & Pick<StateNode, 'id' | 'type'>): StateNode => ({
    label: overrides.id,
    ...overrides,
});

describe('flattenMarkers', () => {
    it('returns the graph unchanged when there are no marker nodes', () => {
        const nodes: StateNode[] = [node({ id: 'A', type: 'Pass' }), node({ id: 'B', type: 'Succeed' })];
        const edges: GraphEdge[] = [{ from: 'A', to: 'B', id: 'A->B#normal#0' }];

        const result = flattenMarkers({ edges, nodes });

        expect(result.nodes).toBe(nodes);
        expect(result.edges).toBe(edges);
    });

    it('drops a dangling marker with no outgoing edge, and the edge into it', () => {
        // A container whose Map/Parallel has no Next: the marker's incoming edge
        // has nowhere to be rewired to, so it's simply removed.
        const nodes: StateNode[] = [
            node({ id: 'Terminal', type: 'Task' }),
            node({ id: 'Container__iterator__end', type: 'IteratorEnd' }),
        ];
        const edges: GraphEdge[] = [
            { from: 'Terminal', to: 'Container__iterator__end', id: 'Terminal->end#normal#0' },
        ];

        const result = flattenMarkers({ edges, nodes });

        expect(result.nodes.map((n) => n.id)).toEqual(['Terminal']);
        expect(result.edges).toEqual([]);
    });

    it('rewires two branch-terminal edges through their own markers to a shared Next', () => {
        const nodes: StateNode[] = [
            node({ id: 'Container', type: 'Parallel', isContainer: true, children: ['Branch1', 'Branch2'] }),
            node({ id: 'Branch1', type: 'Task' }),
            node({ id: 'Branch2', type: 'Task' }),
            node({ id: 'Container__branch0__end', type: 'BranchEnd' }),
            node({ id: 'Container__branch1__end', type: 'BranchEnd' }),
            node({ id: 'Next', type: 'Succeed' }),
        ];
        const edges: GraphEdge[] = [
            { from: 'Container', to: 'Branch1', id: 'e1', visualOnly: true },
            { from: 'Container', to: 'Branch2', id: 'e2', visualOnly: true },
            { from: 'Branch1', to: 'Container__branch0__end', id: 'e3' },
            { from: 'Container__branch0__end', to: 'Next', id: 'e4' },
            { from: 'Branch2', to: 'Container__branch1__end', id: 'e5' },
            { from: 'Container__branch1__end', to: 'Next', id: 'e6' },
            { from: 'Container', to: 'Next', id: 'e7', visualOnly: true },
        ];

        const result = flattenMarkers({ edges, nodes });

        expect(result.nodes.map((n) => n.id)).toEqual(['Container', 'Branch1', 'Branch2', 'Next']);
        const rewired = result.edges.map((edge) => `${edge.from}->${edge.to}`);
        expect(rewired).toContain('Branch1->Next');
        expect(rewired).toContain('Branch2->Next');
        // The container's own visual `-> Next` edge is now a duplicate of the two
        // rewired branch edges above, so it must not survive alongside them.
        expect(rewired.filter((pair) => pair === 'Container->Next')).toHaveLength(0);
        // The container -> child entry edges are untouched.
        expect(rewired).toContain('Container->Branch1');
        expect(rewired).toContain('Container->Branch2');
    });

    it('keeps a collapsed container reachable through its own -> Next edge', () => {
        // After applyCollapse, the container has children: [] and collapsed: true,
        // and no marker nodes survive - this is its only remaining outgoing edge.
        const nodes: StateNode[] = [
            node({ id: 'Container', type: 'Parallel', isContainer: true, collapsed: true, children: [] }),
            node({ id: 'Next', type: 'Succeed' }),
        ];
        const edges: GraphEdge[] = [{ from: 'Container', to: 'Next', id: 'e1', visualOnly: true }];

        const result = flattenMarkers({ edges, nodes });

        // No markers were present in this graph at all, so the early-return path
        // is what's actually exercised here - still asserting the edge survives.
        expect(result.edges).toEqual(edges);
    });

    it('keeps retry self-loops untouched', () => {
        const nodes: StateNode[] = [
            node({ id: 'Submit', type: 'Task' }),
            node({ id: 'Marker', type: 'BranchEnd' }),
        ];
        const edges: GraphEdge[] = [
            { from: 'Submit', to: 'Submit', id: 'retry', type: 'retry', visualOnly: true, label: '↻' },
            { from: 'Submit', to: 'Marker', id: 'e1' },
        ];

        const result = flattenMarkers({ edges, nodes });

        expect(result.edges).toContainEqual(edges[0]);
    });
});
