import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { generateSvg } from '../../src';
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

    // Guards the forward-BFS reachability rule: a node is kept when it is still
    // reachable from the start over non-error edges, even if it is ALSO a catch
    // target. An in-degree check would wrongly drop it once its error edge goes.
    it("'hide' keeps a handler that is also on the happy path", () => {
        const sharedTargetAsl: AslDefinition = {
            StartAt: 'TaskA',
            States: {
                TaskA: {
                    Type: 'Task',
                    Resource: 'arn:a',
                    Next: 'Shared',
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Shared' }],
                },
                Shared: { Type: 'Pass', Next: 'Done' },
                Done: { Type: 'Succeed' },
            },
        };
        const { nodes, edges } = parseAsl({ definition: sharedTargetAsl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        const ids = result.nodes.map((node) => node.id);

        expect(ids).toContain('Shared');
        expect(ids).toContain('Done');
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

    it("'hide' removes a multi-hop acyclic handler chain", () => {
        const multiHopAsl: AslDefinition = {
            StartAt: 'TaskA',
            States: {
                TaskA: {
                    Type: 'Task',
                    Resource: 'arn:a',
                    Next: 'Done',
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'H1' }],
                },
                H1: { Type: 'Pass', Next: 'H2' },
                H2: { Type: 'Fail', Error: 'H2' },
                Done: { Type: 'Succeed' },
            },
        };
        const { nodes, edges } = parseAsl({ definition: multiHopAsl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        const ids = result.nodes.map((node) => node.id);
        expect(ids).toContain('TaskA');
        expect(ids).toContain('Done');
        expect(ids).not.toContain('H1');
        expect(ids).not.toContain('H2');
    });

    it("'hide' removes a cyclic handler chain unreachable from the start state", () => {
        // TaskA --Catch--> HandleA --Next--> HandleB --Next--> HandleA
        // HandleA/HandleB reference each other, so a naive "keep any node with a
        // surviving incoming edge" check wrongly keeps both. Only forward
        // reachability from the start state correctly removes them.
        const cyclicAsl: AslDefinition = {
            StartAt: 'TaskA',
            States: {
                TaskA: {
                    Type: 'Task',
                    Resource: 'arn:a',
                    Next: 'Done',
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'HandleA' }],
                },
                HandleA: { Type: 'Pass', Next: 'HandleB' },
                HandleB: { Type: 'Pass', Next: 'HandleA' },
                Done: { Type: 'Succeed' },
            },
        };
        const { nodes, edges } = parseAsl({ definition: cyclicAsl });
        const result = applyCatchHandling({ edges, mode: 'hide', nodes, startStateId: 'TaskA' });
        const ids = result.nodes.map((node) => node.id);
        expect(ids).toContain('TaskA');
        expect(ids).toContain('Done');
        expect(ids).not.toContain('HandleA');
        expect(ids).not.toContain('HandleB');
    });
});

describe("'hide' through the pipeline (#506)", () => {
    const stateIds = (svg: string): string[] =>
        [...svg.matchAll(/data-state-id="([^"]*)"/g)].map((match) => match[1]);

    // Neither definition has a Catch, so hiding catch branches must remove nothing. The
    // reachability walk has to start from the StartAt node's id, which differs from
    // the StartAt name in both: a character XML forbids, and a discriminator.
    const definitions: Record<string, AslDefinition> = {
        'a StartAt name holding a character XML forbids': JSON.parse(
            readFileSync(join(__dirname, '..', 'fixtures', 'xml-forbidden-names.asl.json'), 'utf-8'),
        ),
        'a StartAt id that takes a discriminator': {
            StartAt: 'Fan__branch0__end',
            States: {
                Fan__branch0__end: { Type: 'Pass', Next: 'Fan' },
                Fan: {
                    Type: 'Parallel',
                    Branches: [{ StartAt: 'Work', States: { Work: { Type: 'Pass', End: true } } }],
                    End: true,
                },
            },
        },
    };

    for (const [name, definition] of Object.entries(definitions)) {
        it(`keeps every state for ${name}`, () => {
            const shown = stateIds(generateSvg({ aslDefinition: definition, catchHandling: 'show' }).svg);
            const hidden = stateIds(generateSvg({ aslDefinition: definition, catchHandling: 'hide' }).svg);

            expect(shown.length).toBeGreaterThan(0);
            expect(hidden).toEqual(shown);
        });
    }

    it('parseAsl reports the StartAt node id, not the raw name', () => {
        const definition = definitions['a StartAt id that takes a discriminator'];
        const { nodes, startId } = parseAsl({ definition });

        expect(startId).toBe('Fan__branch0__end__2');
        expect(nodes.map((node) => node.id)).toContain(startId);
    });
});
