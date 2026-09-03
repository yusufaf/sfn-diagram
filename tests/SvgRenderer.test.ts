import { describe, it, expect } from 'vitest';
import { SvgRenderer } from '../src/renderers';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { applyCollapse } from '../src/graph';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition, EdgeStyleOverride, GraphEdge, StateNode } from '../src/types';
import type { LayoutResult } from '../src/layout/DagreLayout';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

describe('SvgRenderer', () => {
    describe('Basic rendering', () => {
        it('should render valid SVG output', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.svg).toBeDefined();
            expect(typeof result.svg).toBe('string');
            expect(result.svg).toContain('<svg');
            expect(result.svg).toContain('</svg>');
        });

        it('should include all nodes in SVG', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            // Check that all node labels appear in SVG
            expect(result.svg).toContain('Start');
            expect(result.svg).toContain('Process');
            expect(result.svg).toContain('End');
        });

        it('should return dimensions', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.width).toBeDefined();
            expect(result.height).toBeDefined();
            expect(typeof result.width).toBe('number');
            expect(typeof result.height).toBe('number');
            expect(result.width).toBeGreaterThan(0);
            expect(result.height).toBeGreaterThan(0);
        });
    });

    describe('Node shapes', () => {
        it('should render rectangles for Task states', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.svg).toContain('<rect');
        });

        it('should render circles for terminal states with enhanced preset', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl, options: { stylePreset: 'enhanced' } });
            const layout = new DagreLayout({ stylePreset: 'enhanced' });
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ stylePreset: 'enhanced' });
            const result = renderer.render(positioned);

            expect(result.svg).toContain('<circle');
        });

        it('should render diamonds for Choice states', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            // Diamond is rendered as a path with 4 points (M L L L Z)
            expect(result.svg).toContain('<path');
        });
    });

    describe('Edges', () => {
        it('should render edges between nodes', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.svg).toContain('<path');
        });

        it('should include edge labels for Choice states', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            // Should contain choice condition labels
            expect(result.svg).toContain('Default');
        });

        it('should render dashed lines for error edges', () => {
            const asl = loadFixture('error-handling');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.svg).toContain('stroke-dasharray');
        });

        it('should render a retry self-loop with marker and label', () => {
            const asl = loadFixture('retry');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.svg).toContain('arrowhead-retry');
            expect(result.svg).toContain('↻ States.Timeout (4x); States.ALL (2x)');
            // Dimensions must stay finite even though the loop extends past the node
            expect(Number.isFinite(result.width)).toBe(true);
            expect(Number.isFinite(result.height)).toBe(true);
            expect(result.svg).not.toContain('NaN');
        });

        it('renders a Choice self-loop instead of dropping it', () => {
            const asl = loadFixture('self-loop');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            // buildSelfLoopPath emits "M x,y C ax,ay ax,ay ex,ey" — the apex control
            // point repeated is the self-loop's signature (a normal d3 curve never
            // repeats a control point). Confirms the edge actually reached the renderer
            // instead of being silently dropped for having zero points.
            expect(result.svg).toMatch(/C ([\d.-]+),([\d.-]+) \1,\2 /);
        });

        it('renders the parallel-edges fixture', () => {
            const { edges, nodes } = parseAsl({ definition: loadFixture('parallel-edges') });
            const positioned = new DagreLayout({}).calculate(nodes, edges);

            expect(new SvgRenderer({}).render(positioned).svg).toMatchSnapshot();
        });
    });

    describe('Self-loop label placement', () => {
        // Hand-built layout matching the geometry reported in the issue: a self-looping
        // node with a same-rank neighbour close enough that the default label position
        // (loop apex + gap + half label width) lands on top of it.
        const pollNode = (): StateNode => ({
            id: 'Poll',
            label: 'Poll',
            type: 'Choice',
            style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' },
            x: 80,
            y: 160,
            width: 120,
            height: 60,
        });

        const selfLoopEdge = (): GraphEdge & { points: Array<{ x: number; y: number }> } => ({
            from: 'Poll',
            id: 'Poll->Poll#choice#0',
            to: 'Poll',
            type: 'choice',
            label: "$.status == 'PENDING'",
            // Matches DagreLayout.calculateVisualEdgePoints' TB self-loop formula for
            // a node at x=80,y=160,width=120 (rightX=140, loopReach=40, loopSpread=12).
            points: [
                { x: 140, y: 148 },
                { x: 180, y: 160 },
                { x: 140, y: 172 },
            ],
        });

        const extractLabelRects = (
            svg: string,
        ): Array<{ x: number; y: number; width: number; height: number }> =>
            [...svg.matchAll(/<rect ([^>]*stroke-width="0\.5"[^>]*)>/g)].map((rectMatch) => {
                const attrs = rectMatch[1];
                const attr = (name: string): number =>
                    Number(attrs.match(new RegExp(`${name}="([\\d.-]+)"`))![1]);
                return { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') };
            });

        const extractLabelRect = (svg: string): { x: number; y: number; width: number; height: number } => {
            const rects = extractLabelRects(svg);
            expect(rects.length).toBeGreaterThan(0);
            return rects[0];
        };

        // Nested self-loops on the same node, matching DagreLayout's loop geometry
        // formula (calculateVisualEdgePoints) for loopIndex 0, 1, 2 on a node at
        // x=80,y=160,width=120 (rightX=140).
        const nestedSelfLoopEdge = (params: {
            label: string;
            loopIndex: number;
        }): GraphEdge & { loopIndex: number; points: Array<{ x: number; y: number }> } => {
            const { label, loopIndex } = params;
            const loopReach = 40 + loopIndex * 22;
            const loopSpread = 12 + loopIndex * 5;
            return {
                from: 'Poll',
                id: `Poll->Poll#choice#${loopIndex}`,
                to: 'Poll',
                type: 'choice',
                label,
                loopIndex,
                points: [
                    { x: 140, y: 160 - loopSpread },
                    { x: 140 + loopReach, y: 160 },
                    { x: 140, y: 160 + loopSpread },
                ],
            };
        };

        const rectsOverlap = (
            a: { x: number; y: number; width: number; height: number },
            b: { x: number; y: number; width: number; height: number },
        ): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

        it('places the label beside the loop when nothing is in the way', () => {
            const layout: LayoutResult = {
                nodes: [pollNode()],
                edges: [selfLoopEdge()],
                graph: { height: 400, width: 800 },
            };

            const result = new SvgRenderer({}).render(layout);
            const labelRect = extractLabelRect(result.svg);

            // Default placement: to the right of the loop, past the apex.
            expect(labelRect.x).toBeGreaterThan(140);
        });

        it('does not draw the label on top of a same-rank neighbour', () => {
            const neighbor: StateNode = {
                id: 'Cee',
                label: 'Cee',
                type: 'Pass',
                style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' },
                x: 250,
                y: 160,
                width: 120,
                height: 60,
            };
            const layout: LayoutResult = {
                nodes: [pollNode(), neighbor],
                edges: [selfLoopEdge()],
                graph: { height: 400, width: 800 },
            };

            const result = new SvgRenderer({}).render(layout);
            const labelRect = extractLabelRect(result.svg);
            const neighborBox = { x: 190, y: 130, width: 120, height: 60 };

            expect(rectsOverlap(labelRect, neighborBox)).toBe(false);
        });

        it('staggers nested self-loop labels so they do not overlap one another', () => {
            const layout: LayoutResult = {
                nodes: [pollNode()],
                edges: [
                    nestedSelfLoopEdge({ label: 'loop zero', loopIndex: 0 }),
                    nestedSelfLoopEdge({ label: 'a somewhat longer loop one label', loopIndex: 1 }),
                    nestedSelfLoopEdge({ label: 'loop two', loopIndex: 2 }),
                ],
                graph: { height: 400, width: 800 },
            };

            const result = new SvgRenderer({}).render(layout);
            const labelRects = extractLabelRects(result.svg);

            expect(labelRects).toHaveLength(3);
            for (let first = 0; first < labelRects.length; first++) {
                for (let second = first + 1; second < labelRects.length; second++) {
                    expect(rectsOverlap(labelRects[first], labelRects[second])).toBe(false);
                }
            }
        });

        // The LR/RL counterpart: the loop bulges off the node's *top* edge instead of
        // its right edge, so the labels stagger along x, where label width varies per
        // edge. Matches calculateVisualEdgePoints' LR branch for the same node
        // (topY = 130, centerX = 80).
        const nestedLrSelfLoopEdge = (params: {
            label: string;
            loopIndex: number;
        }): GraphEdge & { loopIndex: number; points: Array<{ x: number; y: number }> } => {
            const { label, loopIndex } = params;
            const loopReach = 40 + loopIndex * 22;
            const loopSpread = 12 + loopIndex * 5;
            return {
                from: 'Poll',
                id: `Poll->Poll#choice#${loopIndex}`,
                to: 'Poll',
                type: 'choice',
                label,
                loopIndex,
                points: [
                    { x: 80 - loopSpread, y: 130 },
                    { x: 80, y: 130 - loopReach },
                    { x: 80 + loopSpread, y: 130 },
                ],
            };
        };

        it('staggers nested LR self-loop labels when an inner label is wider than the outer one', () => {
            // Stepping by each edge's own label width lets a short inner label land
            // entirely inside a long outer one's rect.
            const layout: LayoutResult = {
                nodes: [pollNode()],
                edges: [
                    nestedLrSelfLoopEdge({
                        label: 'a very considerably longer loop zero label indeed',
                        loopIndex: 0,
                    }),
                    nestedLrSelfLoopEdge({ label: 'x', loopIndex: 1 }),
                ],
                graph: { height: 400, width: 800 },
            };

            const result = new SvgRenderer({ layout: 'LR' }).render(layout);
            const labelRects = extractLabelRects(result.svg);

            expect(labelRects).toHaveLength(2);
            expect(rectsOverlap(labelRects[0], labelRects[1])).toBe(false);
        });
    });

    describe('Theming', () => {
        it('should apply light theme colors', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ theme: 'light' });
            const result = renderer.render(positioned);

            expect(result.svg).toBeDefined();
            // Light theme should have light background colors
        });

        it('should apply dark theme colors', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ theme: 'dark' });
            const result = renderer.render(positioned);

            expect(result.svg).toBeDefined();
            // Dark theme should have dark background colors
        });

        it('should support custom theme', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const customTheme = {
                background: '#ffffff',
                stateColors: {
                    Pass: '#ff0000',
                    Task: '#00ff00',
                    Choice: '#0000ff',
                    Wait: '#ffff00',
                    Succeed: '#00ffff',
                    Fail: '#ff00ff',
                    Parallel: '#ffa500',
                    Map: '#800080',
                },
                edgeColors: {
                    normal: '#000000',
                    error: '#ff0000',
                    choice: '#0000ff',
                },
                textColor: '#000000',
                fontSize: 12,
            };

            const renderer = new SvgRenderer({ theme: customTheme });
            const result = renderer.render(positioned);

            expect(result.svg).toBeDefined();
        });
    });

    describe('Edge styles', () => {
        it('should render curved edges by default', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ edgeStyle: 'curved' });
            const result = renderer.render(positioned);

            // Curved paths use C (cubic bezier) commands
            expect(result.svg).toContain('<path');
        });

        it('should render straight edges when specified', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ edgeStyle: 'straight' });
            const result = renderer.render(positioned);

            expect(result.svg).toContain('<path');
        });
    });

    describe('Metadata', () => {
        it('should include node count in metadata', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.metadata).toBeDefined();
            expect(result.metadata.nodeCount).toBe(3);
        });

        it('should include edge count in metadata', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expect(result.metadata.edgeCount).toBe(2);
        });
    });

    describe('edgeOverrides key resolution', () => {
        const renderFixture = (edgeOverrides: Record<string, EdgeStyleOverride>): string => {
            const { edges, nodes } = parseAsl({ definition: loadFixture('parallel-edges') });
            const positioned = new DagreLayout({}).calculate(nodes, edges);
            return new SvgRenderer({ edgeOverrides }).render(positioned).svg;
        };

        it('applies a qualified key to one edge only', () => {
            const svg = renderFixture({
                'Route->Work#choice#0': { stroke: '#ff0000' },
            });

            expect(svg.match(/stroke="#ff0000"/g) ?? []).toHaveLength(1);
        });

        it('applies a bare legacy key to every edge of the pair', () => {
            const svg = renderFixture({
                'Route->Work': { stroke: '#00ff00' },
            });

            expect(svg.match(/stroke="#00ff00"/g) ?? []).toHaveLength(2);
        });

        it('lets a qualified key win over a bare key, merging field-wise', () => {
            const svg = renderFixture({
                'Route->Work': { stroke: '#00ff00', strokeWidth: 7 },
                'Route->Work#choice#1': { stroke: '#0000ff' },
            });

            // The qualified key overrides only `stroke`; `strokeWidth` still comes
            // from the bare key.
            expect(svg).toContain('stroke="#0000ff"');
            expect(svg.match(/stroke-width="7"/g) ?? []).toHaveLength(2);
            expect(svg.match(/stroke="#00ff00"/g) ?? []).toHaveLength(1);
        });
    });
});

describe('collapsed containers', () => {
    it('renders a collapsed container via the regular-node path, not the bounding-box path', () => {
        const asl = loadFixture('parallel');
        const parsed = parseAsl({ definition: asl });
        const collapsed = applyCollapse({ collapse: true, edges: parsed.edges, nodes: parsed.nodes });
        const layout = new DagreLayout({}).calculate(collapsed.nodes, collapsed.edges);
        const result = new SvgRenderer({}).render(layout);

        expect(result.svg).toContain('class="node node-Parallel"');
        expect(result.svg).not.toContain('class="container container-Parallel"');
    });

    it('shows the collapsed count and a dashed border', () => {
        const asl = loadFixture('parallel');
        const parsed = parseAsl({ definition: asl });
        const collapsed = applyCollapse({ collapse: true, edges: parsed.edges, nodes: parsed.nodes });
        const layout = new DagreLayout({}).calculate(collapsed.nodes, collapsed.edges);
        const result = new SvgRenderer({}).render(layout);

        expect(result.svg).toContain('2 states');
        expect(result.svg).toContain('stroke-dasharray');
    });
});
