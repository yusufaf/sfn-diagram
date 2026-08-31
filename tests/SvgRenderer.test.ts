import { describe, it, expect } from 'vitest';
import { SvgRenderer } from '../src/renderers';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { applyCollapse } from '../src/graph';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

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
