import { describe, it, expect } from 'vitest';
import { parseAsl } from '../../src/AslParser';
import { applyCollapse } from '../../src/graph';
import type { AslDefinition } from '../../src/types';

const parallelAsl: AslDefinition = {
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

// Parallel containing a nested Map, so nesting/closure recursion has something to walk.
const nestedAsl: AslDefinition = {
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                {
                    StartAt: 'ProcessBatch',
                    States: {
                        ProcessBatch: {
                            Type: 'Map',
                            ItemsPath: '$.batch',
                            Iterator: {
                                StartAt: 'HandleRecord',
                                States: {
                                    HandleRecord: { Type: 'Task', Resource: 'arn:hr', End: true },
                                },
                            },
                            End: true,
                        },
                    },
                },
                { StartAt: 'Notify', States: { Notify: { Type: 'Task', Resource: 'arn:notify', End: true } } },
            ],
            Next: 'Complete',
        },
        Complete: { Type: 'Succeed' },
    },
};

// Parallel containing a nested Distributed Map with ItemReader/ResultWriter
// satellites, so collapsing the outer container has to sweep satellites that
// aren't reachable via any `children` array.
const nestedDistributedAsl: AslDefinition = {
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                {
                    StartAt: 'ProcessBatch',
                    States: {
                        ProcessBatch: {
                            Type: 'Map',
                            ItemsPath: '$.batch',
                            ItemReader: {
                                Resource: 'arn:aws:states:::s3:getObject',
                                Parameters: { Bucket: 'in', Key: 'batch.csv' },
                            },
                            ResultWriter: {
                                Resource: 'arn:aws:states:::s3:putObject',
                                Parameters: { Bucket: 'out' },
                            },
                            ItemProcessor: {
                                ProcessorConfig: { Mode: 'DISTRIBUTED' },
                                StartAt: 'HandleRecord',
                                States: {
                                    HandleRecord: { Type: 'Task', Resource: 'arn:hr', End: true },
                                },
                            },
                            End: true,
                        },
                    },
                },
                { StartAt: 'Notify', States: { Notify: { Type: 'Task', Resource: 'arn:notify', End: true } } },
            ],
            Next: 'Complete',
        },
        Complete: { Type: 'Succeed' },
    },
};

describe('applyCollapse', () => {
    it('returns the graph unchanged when collapse is undefined', () => {
        const { nodes, edges } = parseAsl({ definition: parallelAsl });
        const result = applyCollapse({ collapse: undefined, edges, nodes });
        expect(result.nodes.length).toBe(nodes.length);
        expect(result.edges.length).toBe(edges.length);
    });

    it('collapse: true replaces the container with a placeholder and drops its descendants', () => {
        const { nodes, edges } = parseAsl({ definition: parallelAsl });
        const result = applyCollapse({ collapse: true, edges, nodes });
        const ids = result.nodes.map((node) => node.id);

        expect(ids).toContain('FanOut');
        expect(ids).toContain('Done');
        expect(ids).not.toContain('Branch1');
        expect(ids).not.toContain('Branch2');

        const placeholder = result.nodes.find((node) => node.id === 'FanOut');
        expect(placeholder?.collapsed).toBe(true);
        expect(placeholder?.collapsedCount).toBe(2);
        expect(placeholder?.children).toEqual([]);
    });

    it('drops every edge touching a removed descendant, keeps container-anchored edges', () => {
        const { nodes, edges } = parseAsl({ definition: parallelAsl });
        const result = applyCollapse({ collapse: true, edges, nodes });

        for (const edge of result.edges) {
            expect(edge.from).not.toMatch(/^Branch/);
            expect(edge.to).not.toMatch(/^Branch/);
        }
        // The container -> Next visual edge (already anchored at the container id
        // pre-collapse) must survive so the diagram still shows FanOut -> Done.
        expect(
            result.edges.some((edge) => edge.from === 'FanOut' && edge.to === 'Done'),
        ).toBe(true);
    });

    it('collapse: [names] collapses only the named containers, ignoring unknown names', () => {
        const { nodes, edges } = parseAsl({ definition: nestedAsl });
        const result = applyCollapse({ collapse: ['ProcessBatch', 'NotAContainer'], edges, nodes });
        const ids = result.nodes.map((node) => node.id);

        // FanOut stays an open container: Notify (sibling branch) survives untouched.
        expect(ids).toContain('FanOut');
        expect(ids).toContain('Notify');
        // ProcessBatch collapses; its own descendant is gone.
        expect(ids).toContain('ProcessBatch');
        expect(ids).not.toContain('HandleRecord');

        const fanOut = result.nodes.find((node) => node.id === 'FanOut');
        expect(fanOut?.collapsed).toBeUndefined();
        const processBatch = result.nodes.find((node) => node.id === 'ProcessBatch');
        expect(processBatch?.collapsed).toBe(true);
        expect(processBatch?.collapsedCount).toBe(1);
    });

    it('an outer collapse target swallows a nested target instead of double-placeholding it', () => {
        const { nodes, edges } = parseAsl({ definition: nestedAsl });
        const result = applyCollapse({ collapse: ['FanOut', 'ProcessBatch'], edges, nodes });
        const ids = result.nodes.map((node) => node.id);

        expect(ids).toContain('FanOut');
        expect(ids).not.toContain('ProcessBatch');
        expect(ids).not.toContain('HandleRecord');
        expect(ids).not.toContain('Notify');

        const fanOut = result.nodes.find((node) => node.id === 'FanOut');
        expect(fanOut?.collapsed).toBe(true);
        // Real states hidden: ProcessBatch, HandleRecord, Notify.
        expect(fanOut?.collapsedCount).toBe(3);
    });

    it('sweeps a Distributed Map\'s ItemReader/ResultWriter satellites when an ancestor swallows the Map', () => {
        const { nodes, edges } = parseAsl({ definition: nestedDistributedAsl });
        const result = applyCollapse({ collapse: ['FanOut'], edges, nodes });
        const ids = result.nodes.map((node) => node.id);

        expect(ids).toContain('FanOut');
        expect(ids).not.toContain('ProcessBatch');
        // The satellites aren't in ProcessBatch's `children`, so without the sweep
        // they'd survive as disconnected floating nodes with no edges.
        expect(ids).not.toContain('ProcessBatch__itemreader');
        expect(ids).not.toContain('ProcessBatch__resultwriter');
    });

    it('collapse: true on a graph with no containers is a no-op', () => {
        const flatAsl: AslDefinition = {
            StartAt: 'A',
            States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
        };
        const { nodes, edges } = parseAsl({ definition: flatAsl });
        const result = applyCollapse({ collapse: true, edges, nodes });
        expect(result.nodes.length).toBe(nodes.length);
        expect(result.edges.length).toBe(edges.length);
    });
});
