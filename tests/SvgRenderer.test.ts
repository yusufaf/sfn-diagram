import { describe, it, expect } from 'vitest';
import { SvgRenderer } from '../src/renderers';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { applyCollapse } from '../src/graph';
import { nearestPointOnPath, parsePath, pointAtHalfLength } from '../src/utils/pathSample';
import { estimateTextWidth } from '../src/utils/textMeasure';
import { generateSvg } from '../src';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
    AslDefinition,
    DiagramOptions,
    EdgeStyleOverride,
    GraphEdge,
    StateNode,
} from '../src/types';
import type { LayoutResult } from '../src/layout/DagreLayout';
import { AWS_LIGHT_THEME } from '../src/config';

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

    describe('Edge style "orthogonal"', () => {
        const loopDefinition: AslDefinition = {
            StartAt: 'Submit',
            States: {
                Submit: {
                    Type: 'Task',
                    Resource: 'arn:aws:lambda:::submit',
                    Next: 'Wait',
                },
                Wait: { Type: 'Wait', Seconds: 5, Next: 'Check' },
                Check: {
                    Type: 'Choice',
                    Choices: [
                        {
                            Variable: '$.status',
                            StringEquals: 'PENDING',
                            Next: 'Wait',
                        },
                        {
                            Variable: '$.status',
                            StringEquals: 'RETRY',
                            Next: 'Submit',
                        },
                    ],
                    Default: 'Done',
                },
                Done: { Type: 'Succeed' },
            },
        };
        const layouts = ['TB', 'LR', 'BT', 'RL'] as const;
        const fixtureNames = [
            'choice',
            'error-handling',
            'parallel',
            'nested-map',
            'map',
            'distributed-map',
            'jsonata-io',
        ];
        const definitions: Array<[string, AslDefinition]> = [
            ...fixtureNames.map((name): [string, AslDefinition] => [
                name,
                loadFixture(name),
            ]),
            ['loop', loopDefinition],
        ];

        interface DrawnEdge {
            d: string;
            id: string;
        }

        // Visible edge strokes only: hit areas are transparent.
        const drawnEdges = (svg: string): DrawnEdge[] =>
            [
                ...svg.matchAll(
                    /<path d="([^"]+)" data-edge-id="([^"]+)" fill="none" stroke="(?!transparent)/g,
                ),
            ].map((match) => ({
                d: match[1],
                id: match[2].replace(/&gt;/g, '>'),
            }));

        const isSelfLoopId = (id: string): boolean => {
            const [from, to] = id.split('#')[0].split('->');
            return from === to;
        };

        const render = (
            definition: AslDefinition,
            options: DiagramOptions,
        ): string => generateSvg({ aslDefinition: definition, ...options }).svg;

        it('renders orthogonal edges differently from straight ones', () => {
            const aslDefinition = loadFixture('choice');

            const straight = generateSvg({
                aslDefinition,
                edgeStyle: 'straight',
            });
            const orthogonal = generateSvg({
                aslDefinition,
                edgeStyle: 'orthogonal',
            });

            expect(orthogonal.svg).not.toBe(straight.svg);
        });

        it('draws a bent edge with rounded corners', () => {
            const edges = drawnEdges(
                render(loadFixture('choice'), { edgeStyle: 'orthogonal' }),
            );

            expect(
                edges.find((edge) => edge.id.startsWith('HighValue->Done'))?.d,
            ).toBe(
                'M420,210L420,230C420,235,420,235,415,235L285,235C280,235,280,235,280,240L280,260',
            );
        });

        it('draws every edge as axis-aligned segments', () => {
            let cornerCount = 0;
            for (const [name, definition] of definitions) {
                for (const layout of layouts) {
                    const edges = drawnEdges(
                        render(definition, { edgeStyle: 'orthogonal', layout }),
                    );
                    expect(edges.length, `${name} ${layout}`).toBeGreaterThan(
                        0,
                    );
                    for (const edge of edges.filter(
                        (candidate) => !isSelfLoopId(candidate.id),
                    )) {
                        for (const segment of parsePath(edge.d).segments) {
                            const label = `${name} ${layout} ${edge.id}`;
                            if (segment.type === 'L') {
                                const aligned =
                                    Math.abs(segment.from.x - segment.to.x) <
                                        1e-3 ||
                                    Math.abs(segment.from.y - segment.to.y) <
                                        1e-3;
                                expect(aligned, label).toBe(true);
                            } else {
                                cornerCount += 1;
                                const corner = segment.control1;
                                expect(corner, label).toEqual(segment.control2);
                                const sharesOneCoordinate = (point: {
                                    x: number;
                                    y: number;
                                }) =>
                                    Math.abs(point.x - corner!.x) < 1e-3 ||
                                    Math.abs(point.y - corner!.y) < 1e-3;
                                expect(
                                    sharesOneCoordinate(segment.from),
                                    label,
                                ).toBe(true);
                                expect(
                                    sharesOneCoordinate(segment.to),
                                    label,
                                ).toBe(true);
                            }
                        }
                    }
                }
            }
            // Without this the test would pass on plain straight lines.
            expect(cornerCount).toBeGreaterThan(0);
        });

        const layoutFor = (definition: AslDefinition, layout: 'LR' | 'TB') => {
            const { nodes, edges } = parseAsl({ definition });
            return new DagreLayout({ layout }).calculate(nodes, edges);
        };

        it.each([
            ['TB', 'vertical'],
            ['LR', 'horizontal'],
        ] as const)(
            'ends %s edges on the facing side, along the flow axis',
            (layout, direction) => {
                const positioned = layoutFor(loadFixture('choice'), layout);
                const done = positioned.nodes.find(
                    (node) => node.id === 'Done',
                )!;
                const svg = new SvgRenderer({
                    edgeStyle: 'orthogonal',
                    layout,
                }).render(positioned).svg;
                const edge = drawnEdges(svg).find((candidate) =>
                    candidate.id.startsWith('HighValue->Done'),
                )!;
                const segments = parsePath(edge.d).segments;
                const last = segments[segments.length - 1];

                if (direction === 'vertical') {
                    expect(last.to.y).toBeCloseTo(
                        done.y! - done.height! / 2,
                        3,
                    );
                    expect(Math.abs(last.to.x - done.x!)).toBeLessThanOrEqual(
                        done.width! / 4 + 1e-3,
                    );
                    expect(last.from.x).toBeCloseTo(last.to.x, 3);
                } else {
                    expect(last.to.x).toBeCloseTo(done.x! - done.width! / 2, 3);
                    expect(Math.abs(last.to.y - done.y!)).toBeLessThanOrEqual(
                        done.height! / 4 + 1e-3,
                    );
                    expect(last.from.y).toBeCloseTo(last.to.y, 3);
                }
            },
        );

        it('keeps a forward/back edge pair on separate lanes', () => {
            const edges = drawnEdges(
                render(loopDefinition, { edgeStyle: 'orthogonal' }),
            );
            const forward = parsePath(
                edges.find((edge) => edge.id.startsWith('Wait->Check'))!.d,
            );
            const back = parsePath(
                edges.find((edge) => edge.id.startsWith('Check->Wait'))!.d,
            );

            const lastOf = (path: ReturnType<typeof parsePath>) =>
                path.segments[path.segments.length - 1];
            expect(lastOf(forward).to).not.toEqual(back.start);
            // First and last legs run along the flow axis; unrouted dagre ends are diagonal.
            for (const path of [forward, back]) {
                expect(path.segments[0].from.x).toBeCloseTo(
                    path.segments[0].to.x,
                    3,
                );
                expect(lastOf(path).from.x).toBeCloseTo(lastOf(path).to.x, 3);
            }
            const verticalRuns = (path: ReturnType<typeof parsePath>) =>
                path.segments.filter(
                    (segment) => Math.abs(segment.from.x - segment.to.x) < 1e-3,
                );
            for (const first of verticalRuns(forward)) {
                for (const second of verticalRuns(back)) {
                    if (Math.abs(first.from.x - second.from.x) > 1e-3) continue;
                    const overlap =
                        Math.min(
                            Math.max(first.from.y, first.to.y),
                            Math.max(second.from.y, second.to.y),
                        ) -
                        Math.max(
                            Math.min(first.from.y, first.to.y),
                            Math.min(second.from.y, second.to.y),
                        );
                    expect(overlap).toBeLessThanOrEqual(1e-3);
                }
            }
        });

        it('leaves self-loops curved', () => {
            const aslDefinition = loadFixture('self-loop');

            const straight = drawnEdges(
                render(aslDefinition, { edgeStyle: 'straight' }),
            );
            const orthogonal = drawnEdges(
                render(aslDefinition, { edgeStyle: 'orthogonal' }),
            );

            const selfLoopPaths = (edges: DrawnEdge[]) =>
                edges
                    .filter((edge) => isSelfLoopId(edge.id))
                    .map((edge) => edge.d);
            expect(selfLoopPaths(orthogonal).length).toBeGreaterThan(0);
            expect(selfLoopPaths(orthogonal)).toEqual(selfLoopPaths(straight));
        });
    });

    describe('Edge label midpoint (curved and straight)', () => {
        // A bent multi-point edge - straight enough for curveBasis to draw a visible
        // curve, but also a case where a straight polyline's middle *vertex* isn't
        // the middle of the drawn line either.
        const bentEdge = (): GraphEdge & { points: Array<{ x: number; y: number }> } => ({
            from: 'A',
            id: 'A->B#normal#0',
            to: 'B',
            type: 'normal',
            label: 'go',
            points: [
                { x: 0, y: 100 },
                { x: 100, y: 0 },
                { x: 260, y: 100 },
            ],
        });

        const buildLayout = (): LayoutResult => ({
            nodes: [
                { id: 'A', label: 'A', type: 'Task', style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' }, x: 0, y: 100, width: 120, height: 60 },
                { id: 'B', label: 'B', type: 'Task', style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' }, x: 260, y: 100, width: 120, height: 60 },
            ],
            edges: [bentEdge()],
            graph: { height: 300, width: 400 },
        });

        const extractPathD = (svg: string): string =>
            svg.match(/<path d="([^"]+)"[^>]*data-edge-id="A-&gt;B[^"]*"/)![1];

        const extractLabelCenter = (svg: string): { x: number; y: number } => {
            const match = svg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>go<\/text>/)!;
            return { x: Number(match[1]), y: Number(match[2]) };
        };

        it('places the label on the drawn curve for edgeStyle "curved"', () => {
            const result = new SvgRenderer({ edgeStyle: 'curved' }).render(buildLayout());

            const pathD = extractPathD(result.svg);
            const labelCenter = extractLabelCenter(result.svg);
            const onCurve = pointAtHalfLength(parsePath(pathD));

            expect(labelCenter.x).toBeCloseTo(onCurve.x, 5);
            expect(labelCenter.y).toBeCloseTo(onCurve.y, 5);

            // Regression check: the naive "middle control point" (the old behaviour)
            // is nowhere near the curve here - confirms this fixture actually
            // exercises the bug, not just a case where the two approaches coincide.
            const naiveMidpoint = bentEdge().points[1];
            const distanceFromNaive = Math.hypot(
                labelCenter.x - naiveMidpoint.x,
                labelCenter.y - naiveMidpoint.y
            );
            expect(distanceFromNaive).toBeGreaterThan(5);
        });

        it('places the label on the drawn line for the default (straight) edge style', () => {
            const result = new SvgRenderer({}).render(buildLayout());

            const pathD = extractPathD(result.svg);
            const labelCenter = extractLabelCenter(result.svg);
            const onLine = pointAtHalfLength(parsePath(pathD));

            expect(labelCenter.x).toBeCloseTo(onLine.x, 5);
            expect(labelCenter.y).toBeCloseTo(onLine.y, 5);

            // The two legs (0,100)->(100,0) and (100,0)->(260,100) have unequal
            // lengths, so the arc-length midpoint isn't the vertex at (100, 0).
            expect(labelCenter).not.toEqual({ x: 100, y: 0 });
        });

        it('places the label on the drawn path for edgeStyle "orthogonal"', () => {
            const result = new SvgRenderer({ edgeStyle: 'orthogonal' }).render(
                buildLayout(),
            );

            const parsed = parsePath(extractPathD(result.svg));
            const labelCenter = extractLabelCenter(result.svg);
            const onPath = pointAtHalfLength(parsed);

            expect(labelCenter.x).toBeCloseTo(onPath.x, 5);
            expect(labelCenter.y).toBeCloseTo(onPath.y, 5);
            for (const segment of parsed.segments.filter(
                (candidate) => candidate.type === 'L',
            )) {
                const aligned =
                    Math.abs(segment.from.x - segment.to.x) < 1e-3 ||
                    Math.abs(segment.from.y - segment.to.y) < 1e-3;
                expect(aligned).toBe(true);
            }
        });
    });

    describe('Edge label placement from layout', () => {
        const reservedEdge = (): GraphEdge & {
            labelPosition: { x: number; y: number };
            points: Array<{ x: number; y: number }>;
        } => ({
            from: 'A',
            id: 'A->B#normal#0',
            to: 'B',
            type: 'normal',
            label: 'go',
            labelPosition: { x: 100, y: 0 },
            points: [
                { x: 0, y: 100 },
                { x: 100, y: 0 },
                { x: 260, y: 100 },
            ],
        });

        const buildLayout = (): LayoutResult => ({
            nodes: [
                { id: 'A', label: 'A', type: 'Task', style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' }, x: 0, y: 100, width: 120, height: 60 },
                { id: 'B', label: 'B', type: 'Task', style: { fill: '#fff', stroke: '#000', strokeWidth: 2, shape: 'rect' }, x: 260, y: 100, width: 120, height: 60 },
            ],
            edges: [reservedEdge()],
            graph: { height: 300, width: 400 },
        });

        const labelCenter = (svg: string): { x: number; y: number } => {
            const match = svg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>go<\/text>/)!;
            return { x: Number(match[1]), y: Number(match[2]) };
        };

        it('centres the label on the layout-reserved spot when it lies on the drawn path', () => {
            const { svg } = new SvgRenderer({}).render(buildLayout());

            expect(labelCenter(svg)).toEqual({ x: 100, y: 0 });
        });

        it('snaps the label to the curve nearest the reserved spot for edgeStyle "curved"', () => {
            const { svg } = new SvgRenderer({ edgeStyle: 'curved' }).render(buildLayout());

            const pathD = svg.match(/<path d="([^"]+)"[^>]*data-edge-id="A-&gt;B[^"]*"/)![1];
            const expected = nearestPointOnPath({
                path: parsePath(pathD),
                target: { x: 100, y: 0 },
            });
            const center = labelCenter(svg);

            expect(center.x).toBeCloseTo(expected.x, 5);
            expect(center.y).toBeCloseTo(expected.y, 5);
            // curveBasis never reaches the interior control point, so the label must
            // not sit on the reserved spot itself.
            expect(Math.hypot(center.x - 100, center.y - 0)).toBeGreaterThan(1);
        });

        it('cuts a long drawn label but keeps the full condition in the edge title', () => {
            const decodeEntities = (text: string): string =>
                text
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&nbsp;/g, '\u00a0')
                    .replace(/&amp;/g, '&');
            const definition = loadFixture('long-condition');
            const longLabel = parseAsl({ definition }).edges.find(
                (edge) => (edge.label?.length ?? 0) > 100,
            )?.label as string;
            const collapsed = longLabel.replace(/\s+/g, ' ').trim();

            const { svg } = generateSvg({ aslDefinition: definition });

            const drawn = [...svg.matchAll(/<text [^>]*font-size="12"[^>]*>([^<]*…)<\/text>/g)].map(
                (match) => decodeEntities(match[1]),
            );
            expect(drawn).toHaveLength(1);
            expect(drawn[0].length).toBeLessThan(collapsed.length);
            expect(collapsed.startsWith(drawn[0].slice(0, -1))).toBe(true);

            const titles = [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((match) =>
                decodeEntities(match[1]),
            );
            expect(titles.some((title) => title.includes(longLabel))).toBe(true);
        });
    });

    describe('Text font-family', () => {
        const expectAllTextHasFontFamily = (svg: string): void => {
            const textTags = svg.match(/<text\b[^>]*>/g) ?? [];
            expect(textTags.length).toBeGreaterThan(0);
            for (const tag of textTags) {
                expect(tag).toContain('font-family="Arial, sans-serif"');
            }
        };

        it('sets font-family on the container name, sub-label and node second line', () => {
            const asl = loadFixture('distributed-map');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ showStateTypes: true });
            const result = renderer.render(positioned);

            expectAllTextHasFontFamily(result.svg);
        });

        it('sets font-family on edge labels', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const result = renderer.render(positioned);

            expectAllTextHasFontFamily(result.svg);
        });

        it('sets font-family on the assigned-variables line and node annotations', () => {
            const asl = loadFixture('variables');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({
                nodeAnnotations: { LoadOrder: '1.2s' },
            });
            const result = renderer.render(positioned);

            expectAllTextHasFontFamily(result.svg);
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

    describe('Accessibility semantics', () => {
        it('marks the root svg as a graphics document with a title and desc', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const openTag = svg.match(/^<svg[^>]*>/)![0];
            expect(openTag).toContain('role="graphics-document"');
            expect(openTag).toContain('aria-label="AWS Step Functions state machine diagram"');

            expect(svg).toContain(
                '<title>AWS Step Functions state machine diagram</title><desc>3 states, 2 transitions.</desc>',
            );
        });

        it('uses a supplied diagramTitle/diagramDescription verbatim, with escaping', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({
                diagramDescription: 'Handles <urgent> & routine orders',
                diagramTitle: 'Order processing <v2>',
            });
            const { svg } = renderer.render(positioned);

            const openTag = svg.match(/^<svg[^>]*>/)![0];
            expect(openTag).toContain('aria-label="Order processing &lt;v2&gt;"');
            expect(svg).toContain(
                '<title>Order processing &lt;v2&gt;</title><desc>Handles &lt;urgent&gt; &amp; routine orders</desc>',
            );
        });

        it('defaults generateSvg\'s diagramTitle from the ASL Comment', () => {
            const asl = loadFixture('choice');
            const { svg } = generateSvg({ aslDefinition: asl });

            expect(svg).toContain('aria-label="State machine with Choice state"');
        });

        it('lets an explicit diagramTitle beat the ASL Comment', () => {
            const asl = loadFixture('choice');
            const { svg } = generateSvg({ aslDefinition: asl, diagramTitle: 'Custom title' });

            expect(svg).toContain('aria-label="Custom title"');
        });

        it('gives every node group a title of its label and type, as the first child', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(
                /<g class="node node-Choice" data-state-id="CheckValue"[^>]*>(.*?)<\/g>/,
            );
            expect(match).not.toBeNull();
            expect(match![1].startsWith('<title>CheckValue (Choice)</title>')).toBe(true);
        });

        it('gives a container group a title of its label and type, as the first child', () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(
                /<g class="container container-Parallel" data-state-id="ParallelExecution"[^>]*>(.*?)<\/g>/,
            );
            expect(match).not.toBeNull();
            expect(
                match![1].startsWith('<title>ParallelExecution (Parallel)</title>'),
            ).toBe(true);
        });

        it('hides branch/iterator end marker nodes from assistive tech, with no title', () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(/<g class="node node-BranchEnd"[^>]*>(.*?)<\/g>/);
            expect(match).not.toBeNull();
            expect(match![0]).toContain('aria-hidden="true"');
            expect(match![1]).not.toContain('<title>');
        });

        it("titles an edge into a branch end marker with the container's label, not the marker's internal id", () => {
            const asl = loadFixture('parallel');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(
                /<path d="[^"]*" data-edge-id="Branch1-&gt;ParallelExecution__branch0__end[^"]*"[^>]*>(.*?)<\/path>/,
            );
            expect(match).not.toBeNull();
            expect(match![1]).toBe('<title>Branch1 to ParallelExecution</title>');
        });

        it('titles a labelled edge with its endpoints and condition, escaped', () => {
            const asl = loadFixture('choice');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(
                /<path d="[^"]*" data-edge-id="CheckValue-&gt;HighValue#choice#0"[^>]*>(.*?)<\/path>/,
            );
            expect(match).not.toBeNull();
            expect(match![1]).toBe(
                '<title>CheckValue to HighValue: $.value &gt; 10</title>',
            );
        });

        it('titles an unlabelled edge with just its endpoints', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({});
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({});
            const { svg } = renderer.render(positioned);

            const match = svg.match(
                /<path d="[^"]*" data-edge-id="Start-&gt;Process#normal#0"[^>]*>(.*?)<\/path>/,
            );
            expect(match).not.toBeNull();
            expect(match![1]).toBe('<title>Start to Process</title>');
        });

        it('titles both the drawn path and its hit area when edgeHitAreas is on', () => {
            const asl = loadFixture('simple');
            const { nodes, edges } = parseAsl({ definition: asl });
            const layout = new DagreLayout({ edgeHitAreas: true });
            const positioned = layout.calculate(nodes, edges);

            const renderer = new SvgRenderer({ edgeHitAreas: true });
            const { svg } = renderer.render(positioned);

            const hitMatch = svg.match(
                /<path d="[^"]*" data-edge-id="Start-&gt;Process#normal#0" data-edge-hit-area=""[^>]*>(.*?)<\/path>/,
            );
            expect(hitMatch).not.toBeNull();
            expect(hitMatch![1]).toBe('<title>Start to Process</title>');
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

            expect(svg.match(/<path [^>]*stroke="#ff0000"/g) ?? []).toHaveLength(1);
        });

        it('applies a bare legacy key to every edge of the pair', () => {
            const svg = renderFixture({
                'Route->Work': { stroke: '#00ff00' },
            });

            expect(svg.match(/<path [^>]*stroke="#00ff00"/g) ?? []).toHaveLength(2);
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
            expect(svg.match(/<path [^>]*stroke="#00ff00"/g) ?? []).toHaveLength(1);
        });
    });

    describe('edgeOverrides on arrowheads and labels', () => {
        const HIGH = 'CheckValue->HighValue#choice#0';
        const LOW = 'CheckValue->LowValue#choice#0';
        const DEFAULT = 'CheckValue->DefaultPath#default#0';

        const renderChoice = (edgeOverrides: Record<string, EdgeStyleOverride>): string => {
            const { edges, nodes } = parseAsl({ definition: loadFixture('choice') });
            const positioned = new DagreLayout({}).calculate(nodes, edges);
            return new SvgRenderer({ edgeOverrides }).render(positioned).svg;
        };

        const escapeXml = (text: string): string => text.replace(/>/g, '&gt;').replace(/</g, '&lt;');
        const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const pathTag = (svg: string, edgeId: string): string => {
            const match = svg.match(
                new RegExp(`<path [^>]*data-edge-id="${escapeRegex(escapeXml(edgeId))}"[^>]*>`),
            );
            expect(match, `path for ${edgeId}`).not.toBeNull();
            return match![0];
        };
        const markerEndId = (tag: string): string => tag.match(/marker-end="url\(#([^)]+)\)"/)![1];
        const markerFill = (svg: string, id: string): string | undefined =>
            svg.match(new RegExp(`<marker id="${id}"[^>]*><polygon [^>]*fill="([^"]+)"`))?.[1];
        const labelTags = (svg: string, escapedText: string): { rect: string; text: string } => {
            const match = svg.match(
                new RegExp(`(<rect [^>]*>)</rect>(<text [^>]*>)${escapeRegex(escapedText)}</text>`),
            );
            expect(match, `label ${escapedText}`).not.toBeNull();
            return { rect: match![1], text: match![2] };
        };
        const markerCount = (svg: string): number => (svg.match(/<marker /g) ?? []).length;

        it("draws an overridden stroke's arrowhead in the same colour", () => {
            const svg = renderChoice({ [HIGH]: { stroke: '#ff0000' } });

            const highId = markerEndId(pathTag(svg, HIGH));
            expect(highId).not.toBe('arrowhead-choice');
            expect(highId).toMatch(/^arrowhead-/);
            expect(markerFill(svg, highId)).toBe('#ff0000');
            expect(markerEndId(pathTag(svg, LOW))).toBe('arrowhead-choice');
        });

        it('shares one arrowhead marker between edges overridden to the same colour', () => {
            const svg = renderChoice({
                [HIGH]: { stroke: '#ff0000' },
                [DEFAULT]: { stroke: '#ff0000' },
            });

            expect(markerEndId(pathTag(svg, HIGH))).toBe(markerEndId(pathTag(svg, DEFAULT)));
            expect(markerCount(svg)).toBe(6);
        });

        it("keeps the type's own arrowhead when the override repeats the type colour", () => {
            const svg = renderChoice({
                [HIGH]: { stroke: AWS_LIGHT_THEME.edgeColors.choice },
            });

            expect(markerEndId(pathTag(svg, HIGH))).toBe('arrowhead-choice');
            expect(markerCount(svg)).toBe(5);
        });

        it('dims the whole edge, arrowhead included, not just its stroke', () => {
            const svg = renderChoice({ [LOW]: { strokeOpacity: 0.2 } });

            const tag = pathTag(svg, LOW);
            expect(tag).toContain(' opacity="0.2"');
            expect(tag).not.toContain('stroke-opacity');
        });

        it("carries the override's colour and opacity onto the edge label", () => {
            const svg = renderChoice({
                [HIGH]: { stroke: '#ff0000' },
                [LOW]: { strokeOpacity: 0.2 },
            });

            const high = labelTags(svg, escapeXml('$.value > 10'));
            expect(high.rect).toContain('stroke="#ff0000"');
            expect(high.text).toContain('fill="#ff0000"');

            const low = labelTags(svg, escapeXml('$.value <= 10'));
            expect(low.rect).toContain('stroke-opacity="0.2"');
            expect(low.text).toContain('fill-opacity="0.2"');
            // The label box must keep masking the line beneath it, so only its
            // stroke dims, never the whole element.
            expect(low.rect).not.toContain('fill-opacity');
            expect(low.rect).not.toMatch(/ opacity=/);
        });
    });

    describe('data-edge-id', () => {
        it('stamps each edge path with the id that addresses it in edgeOverrides', () => {
            const { edges, nodes } = parseAsl({ definition: loadFixture('parallel-edges') });
            const positioned = new DagreLayout({}).calculate(nodes, edges);

            const svg = new SvgRenderer({}).render(positioned).svg;
            // The `->` in an edge id is escaped in the serialized attribute; an XML/DOM
            // parser hands the original id back, which is what this asserts on.
            const renderedIds = [...svg.matchAll(/<path [^>]*data-edge-id="([^"]+)"/g)].map(
                (match) => match[1].replace(/&gt;/g, '>'),
            );

            expect(renderedIds).toContain('Route->Work#choice#0');
            expect(renderedIds).toContain('Route->Work#choice#1');
            expect(new Set(renderedIds).size).toBe(renderedIds.length);
        });
    });

    describe('edgeHitAreas', () => {
        const positionedChoice = () => {
            const { edges, nodes } = parseAsl({ definition: loadFixture('choice') });
            return new DagreLayout({}).calculate(nodes, edges);
        };

        it('emits no hit-area paths by default, so static export is unchanged', () => {
            const svg = new SvgRenderer({}).render(positionedChoice()).svg;

            expect(svg).not.toContain('data-edge-hit-area');
        });

        it('emits one transparent hit area per edge when enabled', () => {
            const positioned = positionedChoice();
            const edgePaths = (svg: string) =>
                (svg.match(/<path [^>]*data-edge-id=/g) ?? []).length;

            const withoutHitAreas = new SvgRenderer({}).render(positioned).svg;
            const withHitAreas = new SvgRenderer({ edgeHitAreas: true }).render(positioned).svg;

            const drawnEdges = edgePaths(withoutHitAreas);
            expect(drawnEdges).toBeGreaterThan(0);
            expect((withHitAreas.match(/data-edge-hit-area/g) ?? []).length).toBe(drawnEdges);
            expect(edgePaths(withHitAreas)).toBe(drawnEdges * 2);
        });

        it('tags an edge label with its edge id so the label does not swallow clicks', () => {
            const positioned = positionedChoice();

            const withoutHitAreas = new SvgRenderer({}).render(positioned).svg;
            const withHitAreas = new SvgRenderer({ edgeHitAreas: true }).render(positioned).svg;

            // The Choice fixture draws a label on each choice/default edge.
            expect(withHitAreas).toMatch(/<text [^>]*data-edge-id="CheckValue-&gt;HighValue/);
            expect(withHitAreas).toMatch(/<rect [^>]*data-edge-id="CheckValue-&gt;HighValue/);
            expect(withoutHitAreas).not.toMatch(/<text [^>]*data-edge-id=/);
            expect(withoutHitAreas).not.toMatch(/<rect [^>]*data-edge-id=/);
        });

        it('gives the hit area the same id as the edge it covers', () => {
            const svg = new SvgRenderer({ edgeHitAreas: true }).render(positionedChoice()).svg;

            const hitAreaIds = [
                ...svg.matchAll(/<path [^>]*data-edge-id="([^"]+)"[^>]*data-edge-hit-area/g),
            ].map((match) => match[1].replace(/&gt;/g, '>'));

            expect(hitAreaIds).toContain('CheckValue->HighValue#choice#0');
        });

        it('draws the hit area unpainted and wider than the stroke', () => {
            const svg = new SvgRenderer({ edgeHitAreas: true }).render(positionedChoice()).svg;

            const hitArea = svg.match(/<path [^>]*data-edge-hit-area[^>]*>/)![0];
            expect(hitArea).toContain('stroke="transparent"');
            expect(hitArea).toContain('stroke-width="12"');
            expect(hitArea).toContain('pointer-events="stroke"');
        });

        it('puts the hit areas after the containers so nested edges stay clickable', () => {
            const parsed = parseAsl({ definition: loadFixture('parallel') });
            const positioned = new DagreLayout({}).calculate(parsed.nodes, parsed.edges);

            const svg = new SvgRenderer({ edgeHitAreas: true }).render(positioned).svg;

            // A container's background rect is filled, so anything drawn before it
            // hit-tests underneath it. Nodes still come last and keep winning.
            expect(svg.indexOf('class="containers"')).toBeLessThan(
                svg.indexOf('class="edge-hit-areas"'),
            );
            expect(svg.indexOf('class="edge-hit-areas"')).toBeLessThan(
                svg.indexOf('class="nodes"'),
            );
        });

        it('adds no hit-area group at all when disabled', () => {
            const svg = new SvgRenderer({}).render(positionedChoice()).svg;

            expect(svg).not.toContain('edge-hit-areas');
        });
    });
});

describe('sub-label geometry with icons', () => {
    // Before Task timeouts got a sub-label, a second line with an icon was only
    // reachable through showStateTypes. Now any Task with a timeout renders one, so
    // it must stay inside the rect whichever side the icon takes.
    const timeoutTask: AslDefinition = {
        StartAt: 'Work',
        States: {
            Work: {
                End: true,
                Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Work',
                TimeoutSecondsPath: '$.config.timeoutLimit',
                Type: 'Task',
            },
        },
    };

    interface Box {
        bottom: number;
        left: number;
        right: number;
        top: number;
    }

    /** The node rect and the sub-label's estimated bounding box, in node-local coordinates. */
    const measureSubLabel = (svg: string): { rect: Box; subLabel: Box; text: string } => {
        const nodeMarkup = svg.match(/<g class="node node-Task"[\s\S]*?<\/g>/)?.[0] ?? '';
        const rect = nodeMarkup.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
        const subLabel = nodeMarkup.match(
            /<text x="([^"]+)" y="([^"]+)"[^>]*font-size="(\d+)"[^>]*opacity="0.7">([^<]*)<\/text>/,
        );
        expect(rect).not.toBeNull();
        expect(subLabel).not.toBeNull();

        const [, rectX, rectY, rectWidth, rectHeight] = rect!.map(Number) as unknown as number[];
        const textX = Number(subLabel![1]);
        const textY = Number(subLabel![2]);
        const fontSize = Number(subLabel![3]);
        const text = subLabel![4];
        const halfWidth = estimateTextWidth(text, fontSize) / 2;

        return {
            rect: { bottom: rectY + rectHeight, left: rectX, right: rectX + rectWidth, top: rectY },
            subLabel: {
                bottom: textY + fontSize / 2,
                left: textX - halfWidth,
                right: textX + halfWidth,
                top: textY - fontSize / 2,
            },
            text,
        };
    };

    const expectInside = (inner: Box, outer: Box): void => {
        expect(inner.left).toBeGreaterThanOrEqual(outer.left);
        expect(inner.right).toBeLessThanOrEqual(outer.right);
        expect(inner.top).toBeGreaterThanOrEqual(outer.top);
        expect(inner.bottom).toBeLessThanOrEqual(outer.bottom);
    };

    it.each(['left', 'right'] as const)(
        'fits the sub-label beside a %s icon by shrinking its width budget',
        (iconPosition) => {
            const { svg } = generateSvg({ aslDefinition: timeoutTask, iconPosition, showIcons: true });
            const { rect, subLabel, text } = measureSubLabel(svg);

            expect(text.startsWith('timeout')).toBe(true);
            expectInside(subLabel, rect);
        },
    );

    it('fits the sub-label below a top icon by growing the node', () => {
        const { svg } = generateSvg({ aslDefinition: timeoutTask, iconPosition: 'top', showIcons: true });
        const { rect, subLabel, text } = measureSubLabel(svg);

        expect(text.startsWith('timeout')).toBe(true);
        expectInside(subLabel, rect);
        // The icon is anchored to the top edge and the name sits beneath it; the extra
        // room must go to the lines, not open a gap between the icon and the name.
        const nodeMarkup = svg.match(/<g class="node node-Task"[\s\S]*?<\/g>/)![0];
        const iconBottom =
            Number(nodeMarkup.match(/<image x="[^"]+" y="([^"]+)"/)![1]) +
            Number(nodeMarkup.match(/<image[^>]*height="(\d+)"/)![1]);
        const nameY = Number(nodeMarkup.match(/<text x="[^"]+" y="([^"]+)"[^>]*>Work<\/text>/)![1]);
        expect(nameY - 7).toBeGreaterThanOrEqual(iconBottom);
        expect(nameY - 7 - iconBottom).toBeLessThanOrEqual(12);
    });

    it('keeps a node with a top icon and no sub-label at its base size and label offset', () => {
        const plain: AslDefinition = {
            StartAt: 'Work',
            States: { Work: { ...timeoutTask.States.Work, TimeoutSecondsPath: undefined } },
        };
        const { svg } = generateSvg({ aslDefinition: plain, iconPosition: 'top', showIcons: true });
        const nodeMarkup = svg.match(/<g class="node node-Task"[\s\S]*?<\/g>/)![0];

        expect(nodeMarkup).toContain('height="60"');
        expect(nodeMarkup).toMatch(/<text x="0" y="18"[^>]*>Work<\/text>/);
    });
});

describe('node name fitting (#368)', () => {
    // Node width is fixed for AWS parity, so a name or Comment wider than its node is
    // cut to the box with a trailing ellipsis. The full text stays in the <title>.
    const LAMBDA = 'arn:aws:lambda:us-east-1:123456789012:function:Work';
    const LONG_COMMENT = 'Validate the incoming order payload against the schema and reject bad ones';
    const LONG_NAME = 'ProcessIncomingCustomerOrderAndNotifyDownstreamSystems';

    const single = (name: string, state: Record<string, unknown>): AslDefinition =>
        ({ StartAt: name, States: { [name]: state } }) as unknown as AslDefinition;

    const longCommentTask = single('ValidateOrder', {
        Comment: LONG_COMMENT,
        End: true,
        Resource: LAMBDA,
        Type: 'Task',
    });

    interface NameLine {
        imageLeft?: number;
        imageRight?: number;
        left: number;
        markup: string;
        right: number;
        shapeLeft: number;
        shapeRight: number;
        text: string;
    }

    /** The name's estimated horizontal extent and its node's shape, in node-local coordinates. */
    const measureNameLine = (svg: string, stateId: string): NameLine => {
        const start = svg.indexOf(`data-state-id="${stateId}"`);
        expect(start).toBeGreaterThan(-1);
        const markup = svg.slice(start, svg.indexOf('</g>', start));

        const name = markup.match(/<text x="([^"]+)" y="[^"]+"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/);
        expect(name).not.toBeNull();
        const text = name![3];
        const halfWidth = estimateTextWidth(text, Number(name![2])) / 2;

        const rect = markup.match(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)"/);
        const circle = markup.match(/<circle[^>]*\sr="([^"]+)"/);
        const diamond = markup.match(/<path d="M 0,-[\d.]+ L ([\d.]+),0/);
        let shapeLeft: number;
        let shapeRight: number;
        if (rect) {
            shapeLeft = Number(rect[1]);
            shapeRight = shapeLeft + Number(rect[2]);
        } else {
            const halfShape = Number((circle ?? diamond)![1]);
            shapeLeft = -halfShape;
            shapeRight = halfShape;
        }

        const image = markup.match(/<image x="([^"]+)"[^>]*width="([^"]+)"/);

        return {
            imageLeft: image ? Number(image[1]) : undefined,
            imageRight: image ? Number(image[1]) + Number(image[2]) : undefined,
            left: Number(name![1]) - halfWidth,
            markup,
            right: Number(name![1]) + halfWidth,
            shapeLeft,
            shapeRight,
            text,
        };
    };

    const expectInsideShape = (line: NameLine): void => {
        expect(line.left).toBeGreaterThanOrEqual(line.shapeLeft);
        expect(line.right).toBeLessThanOrEqual(line.shapeRight);
    };

    it('truncates an over-long Comment to the node width and ends it with an ellipsis', () => {
        const { svg } = generateSvg({ aslDefinition: longCommentTask, nodeWidth: 160 });
        const line = measureNameLine(svg, 'ValidateOrder');

        expect(line.text.endsWith('…')).toBe(true);
        expect(estimateTextWidth(line.text, 14)).toBeLessThanOrEqual(160 - 4);
        expectInsideShape(line);
        expect(line.markup).toContain(`<title>${LONG_COMMENT} (Task)</title>`);
    });

    it('truncates an over-long state name when the state has no Comment', () => {
        const { svg } = generateSvg({
            aslDefinition: single(LONG_NAME, { End: true, Resource: LAMBDA, Type: 'Task' }),
        });
        const line = measureNameLine(svg, LONG_NAME);

        expect(line.text.endsWith('…')).toBe(true);
        expect(estimateTextWidth(line.text, 14)).toBeLessThanOrEqual(116);
    });

    it.each([
        ['ChargeCustomer', { End: true, Resource: LAMBDA, Type: 'Task' }, {}],
        ['ResultWriter (s3)', { End: true, Resource: LAMBDA, Type: 'Task' }, {}],
        ['CancelOrder', { Type: 'Fail' }, { stylePreset: 'enhanced' }],
    ] as const)('leaves %s untouched because it already fits inside its node', (name, state, options) => {
        const { svg } = generateSvg({ aslDefinition: single(name, { ...state }), ...options });

        expect(measureNameLine(svg, name).text).toBe(name);
    });

    it.each(['left', 'right'] as const)(
        'keeps a truncated name inside the node and clear of a %s icon',
        (iconPosition) => {
            const { svg } = generateSvg({ aslDefinition: longCommentTask, iconPosition, showIcons: true });
            const line = measureNameLine(svg, 'ValidateOrder');

            expect(line.text.endsWith('…')).toBe(true);
            expectInsideShape(line);
            if (iconPosition === 'left') {
                expect(line.left).toBeGreaterThanOrEqual(line.imageRight!);
            } else {
                expect(line.right).toBeLessThanOrEqual(line.imageLeft!);
            }
        },
    );

    it.each([
        [
            'Choice',
            'IsOrderAcceptableForImmediateFulfillment',
            {
                StartAt: 'IsOrderAcceptableForImmediateFulfillment',
                States: {
                    Done: { Type: 'Succeed' },
                    IsOrderAcceptableForImmediateFulfillment: {
                        Choices: [{ BooleanEquals: true, Next: 'Done', Variable: '$.ok' }],
                        Default: 'Done',
                        Type: 'Choice',
                    },
                },
            },
        ],
        ['Succeed', 'Done', { StartAt: 'Done', States: { Done: { Comment: LONG_COMMENT, Type: 'Succeed' } } }],
    ] as const)("fits a long %s name inside its enhanced shape's bounding box", (_type, stateId, definition) => {
        const { svg } = generateSvg({
            aslDefinition: definition as unknown as AslDefinition,
            stylePreset: 'enhanced',
        });
        const line = measureNameLine(svg, stateId);

        expect(line.text.endsWith('…')).toBe(true);
        expectInsideShape(line);
    });

    it('shows an ellipsis rather than dropping the name when even four glyphs do not fit', () => {
        const { svg } = generateSvg({ aslDefinition: longCommentTask, nodeWidth: 24 });
        const line = measureNameLine(svg, 'ValidateOrder');

        expect(line.text).toBe('…');
        expectInsideShape(line);
    });

    it('leaves the name line empty when not even an ellipsis fits', () => {
        const { svg } = generateSvg({
            aslDefinition: longCommentTask,
            iconPosition: 'left',
            nodeWidth: 40,
            showIcons: true,
        });
        const line = measureNameLine(svg, 'ValidateOrder');

        expect(line.text).toBe('');
        expect(line.markup).toContain(`<title>${LONG_COMMENT} (Task)</title>`);
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

describe('Theme-driven node colors', () => {
    const renderFixture = (params: { fixture?: string; options: DiagramOptions }): string => {
        const { fixture = 'simple', options } = params;
        const asl = loadFixture(fixture);
        const { nodes, edges } = parseAsl({ definition: asl });
        const layout = new DagreLayout(options).calculate(nodes, edges);
        return new SvgRenderer(options).render(layout).svg;
    };

    const taskRect = (svg: string): string =>
        svg.match(/<g class="node node-Task"[^>]*>[\s\S]*?<rect[^>]*>/)![0];

    const containerRect = (svg: string): string =>
        svg.match(/<g class="container[^>]*>[\s\S]*?<rect[^>]*>/)![0];

    it('paints Task nodes with the dark theme fill and stroke', () => {
        const svg = renderFixture({ options: { theme: 'dark' } });

        expect(taskRect(svg)).toContain('fill="#9c3400"');
        expect(taskRect(svg)).toContain('stroke="#ffb74d"');
    });

    it('paints Task nodes with the light theme fill and stroke', () => {
        const svg = renderFixture({ options: { theme: 'light' } });

        expect(taskRect(svg)).toContain('fill="#fff3e0"');
        expect(taskRect(svg)).toContain('stroke="#d84315"');
    });

    it('honours customColors over the theme', () => {
        const svg = renderFixture({
            options: { customColors: { Task: { fill: '#ff0000', stroke: '#00ff00' } } },
        });

        expect(taskRect(svg)).toContain('fill="#ff0000"');
        expect(taskRect(svg)).toContain('stroke="#00ff00"');
    });

    it('lets nodeOverrides win over the resolved theme', () => {
        const svg = renderFixture({
            options: {
                nodeOverrides: { Process: { fill: '#c8e6c9', stroke: '#2e7d32' } },
                theme: 'dark',
            },
        });

        expect(taskRect(svg)).toContain('fill="#c8e6c9"');
        expect(taskRect(svg)).toContain('stroke="#2e7d32"');
    });

    it('keeps the theme stroke when customColors names only a fill', () => {
        const svg = renderFixture({
            options: { customColors: { Task: { fill: '#ff0000' } }, theme: 'dark' },
        } as { options: DiagramOptions });

        expect(taskRect(svg)).toContain('fill="#ff0000"');
        expect(taskRect(svg)).toContain('stroke="#ffb74d"');
    });

    it('leaves container colors to the theme rather than to nodeOverrides', () => {
        // An overlay's status colour stretched across a translucent bounding box
        // washes the box out - a container an execution never entered would be
        // drawn near-invisible grey.
        const svg = renderFixture({
            fixture: 'parallel',
            options: { nodeOverrides: { ParallelExecution: { fill: '#f5f5f5', stroke: '#bdbdbd' } } },
        });

        expect(containerRect(svg)).toContain('fill="#fce4ec"');
        expect(containerRect(svg)).toContain('stroke="#c2185b"');
    });

    it('paints a Map container with the Map theme colors, not Parallel pink', () => {
        const svg = renderFixture({ fixture: 'map', options: {} });

        expect(containerRect(svg)).toContain('fill="#f1f8e9"');
        expect(containerRect(svg)).toContain('stroke="#558b2f"');
    });

    it('paints a container with the dark theme colors under theme: dark', () => {
        const svg = renderFixture({ fixture: 'parallel', options: { theme: 'dark' } });

        expect(containerRect(svg)).toContain('fill="#880e4f"');
        expect(containerRect(svg)).toContain('stroke="#f48fb1"');
    });

});
