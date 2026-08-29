import { describe, it, expect } from 'vitest';
import { DagreLayout } from '../src/layout';
import type { StateNode, GraphEdge, AslDefinition } from '../src/types';
import { parseAsl } from '../src/AslParser';
import { applyCollapse } from '../src/graph';

describe('DagreLayout', () => {
    const createTestNodes = (): StateNode[] => [
        {
            id: 'Start',
            label: 'Start',
            type: 'Pass',
            style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' },
        },
        {
            id: 'Process',
            label: 'Process',
            type: 'Task',
            style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' },
        },
        {
            id: 'End',
            label: 'End',
            type: 'Succeed',
            style: { fill: '#fff', stroke: '#000', strokeWidth: 3, shape: 'circle' },
        },
    ];

    const createTestEdges = (): GraphEdge[] => [
        { from: 'Start', to: 'Process', type: 'normal' },
        { from: 'Process', to: 'End', type: 'normal' },
    ];

    describe('Layout calculation', () => {
        it('should calculate positions for nodes', () => {
            const layout = new DagreLayout({});
            const result = layout.calculate(createTestNodes(), createTestEdges());

            expect(result.nodes).toHaveLength(3);
            result.nodes.forEach((node) => {
                expect(node.x).toBeDefined();
                expect(node.y).toBeDefined();
                expect(typeof node.x).toBe('number');
                expect(typeof node.y).toBe('number');
            });
        });

        it('should maintain node properties after layout', () => {
            const layout = new DagreLayout({});
            const nodes = createTestNodes();
            const result = layout.calculate(nodes, createTestEdges());

            result.nodes.forEach((layoutNode) => {
                const originalNode = nodes.find((n) => n.id === layoutNode.id);
                expect(layoutNode.id).toBe(originalNode?.id);
                expect(layoutNode.type).toBe(originalNode?.type);
                expect(layoutNode.label).toBe(originalNode?.label);
            });
        });
    });

    describe('Layout direction', () => {
        it('should support top-to-bottom layout', () => {
            const layout = new DagreLayout({ layout: 'TB' });
            const result = layout.calculate(createTestNodes(), createTestEdges());

            const start = result.nodes.find((n) => n.id === 'Start')!;
            const end = result.nodes.find((n) => n.id === 'End')!;

            // In TB layout, start should be above end
            expect(start.y).toBeLessThan(end.y);
        });

        it('should support left-to-right layout', () => {
            const layout = new DagreLayout({ layout: 'LR' });
            const result = layout.calculate(createTestNodes(), createTestEdges());

            const start = result.nodes.find((n) => n.id === 'Start')!;
            const end = result.nodes.find((n) => n.id === 'End')!;

            // In LR layout, start should be to the left of end
            expect(start.x).toBeLessThan(end.x);
        });
    });

    describe('Node sizing', () => {
        it('should use custom node dimensions', () => {
            const layout = new DagreLayout({
                nodeWidth: 200,
                nodeHeight: 80,
            });

            const result = layout.calculate(createTestNodes(), createTestEdges());

            result.nodes.forEach((node) => {
                expect(node.width).toBeDefined();
                expect(node.height).toBeDefined();
            });
        });

        it('should handle circle shapes with square dimensions', () => {
            const nodes: StateNode[] = [
                {
                    id: 'Success',
                    label: 'Success',
                    type: 'Succeed',
                    style: { fill: '#fff', stroke: '#000', strokeWidth: 3, shape: 'circle' },
                },
            ];

            const layout = new DagreLayout({ nodeWidth: 100, nodeHeight: 60 });
            const result = layout.calculate(nodes, []);

            const successNode = result.nodes[0];
            // Circle nodes should have square dimensions (max of width/height)
            expect(successNode.width).toBe(successNode.height);
        });

        it('should handle diamond shapes with larger dimensions', () => {
            const nodes: StateNode[] = [
                {
                    id: 'Choice',
                    label: 'Choice',
                    type: 'Choice',
                    style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'diamond' },
                },
            ];

            const layout = new DagreLayout({ nodeWidth: 100, nodeHeight: 60 });
            const result = layout.calculate(nodes, []);

            const choiceNode = result.nodes[0];
            // Diamond nodes need ~20% more space for rotation
            expect(choiceNode.width).toBeGreaterThan(100);
            expect(choiceNode.height).toBeGreaterThan(60);
        });
    });

    describe('Edge routing', () => {
        it('should include points for edge routing', () => {
            const layout = new DagreLayout({});
            const result = layout.calculate(createTestNodes(), createTestEdges());

            expect(result.edges).toHaveLength(2);
            result.edges.forEach((edge) => {
                expect(edge.points).toBeDefined();
                expect(Array.isArray(edge.points)).toBe(true);
                if (edge.points && edge.points.length > 0) {
                    edge.points.forEach((point) => {
                        expect(point.x).toBeDefined();
                        expect(point.y).toBeDefined();
                    });
                }
            });
        });
    });

    describe('Spacing configuration', () => {
        it('should respect rankSeparation configuration', () => {
            const layout = new DagreLayout({ rankSeparation: 100 });
            const result = layout.calculate(createTestNodes(), createTestEdges());

            expect(result.nodes.length).toBeGreaterThan(0);
            // Nodes should be spaced according to rankSeparation
        });

        it('should respect nodeSeparation configuration', () => {
            const layout = new DagreLayout({ nodeSeparation: 80 });
            const result = layout.calculate(createTestNodes(), createTestEdges());

            expect(result.nodes.length).toBeGreaterThan(0);
            // Nodes should be spaced according to nodeSeparation
        });
    });
});

describe('DagreLayout with collapsed containers', () => {
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

    it('gives a collapsed container real dagre-computed dimensions, not a bounding box', () => {
        const parsed = parseAsl({ definition: parallelAsl });
        const collapsed = applyCollapse({ collapse: true, edges: parsed.edges, nodes: parsed.nodes });
        const layout = new DagreLayout({});
        const result = layout.calculate(collapsed.nodes, collapsed.edges);

        const fanOut = result.nodes.find((node) => node.id === 'FanOut');
        expect(fanOut?.width).toBe(120); // default nodeWidth, not a children-derived bounding box
        expect(fanOut?.height).toBe(60); // default nodeHeight
    });

    it('produces a smaller overall graph than the uncollapsed layout', () => {
        const parsed = parseAsl({ definition: parallelAsl });
        const expandedLayout = new DagreLayout({}).calculate(parsed.nodes, parsed.edges);

        const collapsed = applyCollapse({ collapse: true, edges: parsed.edges, nodes: parsed.nodes });
        const collapsedLayout = new DagreLayout({}).calculate(collapsed.nodes, collapsed.edges);

        expect(collapsedLayout.graph.height).toBeLessThan(expandedLayout.graph.height);
    });
});
