import { describe, it, expect } from 'vitest';
import { parseAsl } from '../../src/AslParser';
import { applyCatchHandling } from '../../src/graph';
import type { AslDefinition } from '../../src/types';

// Two tasks, each with its own catch handler that is otherwise unreachable.
const asl: AslDefinition = {
    StartAt: 'TaskA',
    States: {
        TaskA: { Type: 'Task', Resource: 'arn:a', Next: 'TaskB', Catch: [{ ErrorEquals: ['States.ALL'], Next: 'HandleA' }] },
        HandleA: { Type: 'Fail', Error: 'A' },
        TaskB: { Type: 'Task', Resource: 'arn:b', Next: 'Done', Catch: [{ ErrorEquals: ['States.ALL'], Next: 'HandleB' }] },
        HandleB: { Type: 'Fail', Error: 'B' },
        Done: { Type: 'Succeed' },
    },
};

describe('applyCatchHandling', () => {
    it("'show' returns the graph unchanged", () => {
        const { nodes, edges } = parseAsl({ definition: asl });
        const result = applyCatchHandling({ edges, mode: 'show', nodes, startStateId: 'TaskA' });
        expect(result.nodes.length).toBe(nodes.length);
        expect(result.edges.length).toBe(edges.length);
    });

    it("'hide' removes error edges", () => {
        const { nodes, edges } = parseAsl({ definition: asl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        expect(result.edges.some((edge) => edge.type === 'error')).toBe(false);
    });

    it("'hide' removes handler-only nodes but keeps the happy path", () => {
        const { nodes, edges } = parseAsl({ definition: asl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        const ids = result.nodes.map((node) => node.id);
        expect(ids).toContain('TaskA');
        expect(ids).toContain('TaskB');
        expect(ids).toContain('Done');
        expect(ids).not.toContain('HandleA');
        expect(ids).not.toContain('HandleB');
    });

    it("'hide' never removes the start state", () => {
        const { nodes, edges } = parseAsl({ definition: asl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        expect(result.nodes.map((node) => node.id)).toContain('TaskA');
    });
});
