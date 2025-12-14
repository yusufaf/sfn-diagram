import { select } from 'd3-selection';
import { line, curveBasis } from 'd3-shape';
import type {
    StateNode,
    GraphEdge,
    DiagramOptions,
    SvgOutput,
    CustomTheme,
} from '../types';
import type { LayoutResult } from '../layout/DagreLayout';
import { getTheme } from '../config/themes';
import { JSDOM } from 'jsdom';

interface RenderShapeParams {
    group: any;
    node: StateNode;
    style: any;
}

interface RenderNodeParams {
    group: any;
    node: StateNode;
}

interface RenderEdgeParams {
    edge: GraphEdge & { points?: Array<{ x: number; y: number }> };
    group: any;
}

interface CalculateLabelPositionParams {
    hasIcon: boolean;
    iconPosition: 'left' | 'top' | 'right';
    iconSize: number;
    node: StateNode;
}

interface RenderIconParams {
    group: any;
    iconPosition: 'left' | 'top' | 'right';
    iconSize: number;
    iconUrl: string;
    node: StateNode;
}

/**
 * SvgRenderer - Generates SVG diagrams from positioned nodes and edges
 */
export class SvgRenderer {
    private options: DiagramOptions;
    private theme: CustomTheme;

    constructor(options: DiagramOptions) {
        this.options = options;
        this.theme = getTheme(options.theme, options.customColors);
    }

    /**
     * Render the diagram to SVG string
     */
    render(layout: LayoutResult): SvgOutput {
        // Create a virtual DOM for Node.js environment
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        const document = dom.window.document;

        // Calculate actual bounds including edge curves
        const bounds = this.calculateBounds(layout);

        // Create SVG element
        const svgNode = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg',
        );
        const svg = select(svgNode)
            .attr('width', bounds.width)
            .attr('height', bounds.height)
            .attr('xmlns', 'http://www.w3.org/2000/svg')
            .attr(
                'viewBox',
                `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`,
            );

        // Add background
        if (this.theme.background && this.theme.background !== 'transparent') {
            svg.append('rect')
                .attr('x', bounds.minX)
                .attr('y', bounds.minY)
                .attr('width', bounds.width)
                .attr('height', bounds.height)
                .attr('fill', this.theme.background);
        }

        // Define arrow markers for edges
        const defs = svg.append('defs');

        // Normal arrow
        defs.append('marker')
            .attr('id', 'arrowhead-normal')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 9)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', this.theme.edgeColors.normal);

        // Error arrow
        defs.append('marker')
            .attr('id', 'arrowhead-error')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 9)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', this.theme.edgeColors.error);

        // Choice arrow
        defs.append('marker')
            .attr('id', 'arrowhead-choice')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 9)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', this.theme.edgeColors.choice);

        // Default arrow
        defs.append('marker')
            .attr('id', 'arrowhead-default')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 9)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', this.theme.edgeColors.default);

        // Create groups for edges, container nodes, and regular nodes
        const edgesGroup = svg.append('g').attr('class', 'edges');
        const containersGroup = svg.append('g').attr('class', 'containers');
        const nodesGroup = svg.append('g').attr('class', 'nodes');

        // Separate container nodes from regular nodes
        const containerNodes = layout.nodes.filter((node) => node.isContainer);
        const regularNodes = layout.nodes.filter((node) => !node.isContainer);

        // Render edges first (so they appear behind everything)
        layout.edges.forEach((edge) => {
            // Skip edges from branch/iterator end markers - we show container edges instead
            const fromNode = layout.nodes.find((node) => node.id === edge.from);
            if (
                fromNode &&
                (fromNode.type === 'BranchEnd' || fromNode.type === 'IteratorEnd')
            ) {
                return;
            }

            this.renderEdge({ edge, group: edgesGroup });
        });

        // Render container nodes (bounding boxes)
        containerNodes.forEach((node) => {
            this.renderContainer({ group: containersGroup, node });
        });

        // Render regular nodes on top
        regularNodes.forEach((node) => {
            this.renderNode({ group: nodesGroup, node });
        });

        return {
            height: bounds.height,
            metadata: {
                edgeCount: layout.edges.length,
                nodeCount: layout.nodes.length,
            },
            svg: svgNode.outerHTML,
            width: bounds.width,
        };
    }

    /**
     * Calculate bounding box including all nodes and edge points
     */
    private calculateBounds(layout: LayoutResult): {
        height: number;
        minX: number;
        minY: number;
        width: number;
    } {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        // Include node bounds
        layout.nodes.forEach((node) => {
            const halfWidth = (node.width || 0) / 2;
            const halfHeight = (node.height || 0) / 2;
            minX = Math.min(minX, (node.x || 0) - halfWidth);
            minY = Math.min(minY, (node.y || 0) - halfHeight);
            maxX = Math.max(maxX, (node.x || 0) + halfWidth);
            maxY = Math.max(maxY, (node.y || 0) + halfHeight);
        });

        // Include edge points
        layout.edges.forEach((edge) => {
            if (edge.points) {
                edge.points.forEach((point) => {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                });
            }

            // Include edge label bounds
            if (edge.label && edge.points && edge.points.length > 0) {
                const midpoint = this.getPathMidpoint(edge.points);
                const labelDimensions = this.calculateLabelDimensions(edge.label);
                const labelMinX = midpoint.x - labelDimensions.width / 2;
                const labelMaxX = midpoint.x + labelDimensions.width / 2;
                const labelMinY = midpoint.y - labelDimensions.height / 2;
                const labelMaxY = midpoint.y + labelDimensions.height / 2;

                minX = Math.min(minX, labelMinX);
                minY = Math.min(minY, labelMinY);
                maxX = Math.max(maxX, labelMaxX);
                maxY = Math.max(maxY, labelMaxY);
            }
        });

        // Add padding
        const padding = this.options.padding || 20;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        return {
            height: maxY - minY,
            minX,
            minY,
            width: maxX - minX,
        };
    }

    /**
     * Render a container node (Parallel/Map) with bounding box
     */
    private renderContainer(params: RenderNodeParams): void {
        const { group, node } = params;
        const containerGroup = group
            .append('g')
            .attr('class', `container container-${node.type}`)
            .attr('transform', `translate(${node.x}, ${node.y})`);

        const width = node.width || 480;
        const height = node.height || 180;
        const headerHeight = 50;

        // Draw translucent bounding box
        containerGroup
            .append('rect')
            .attr('x', -width / 2)
            .attr('y', -height / 2)
            .attr('width', width)
            .attr('height', height)
            .attr('rx', 7)
            .attr('fill', node.style?.fill || '#fce4ec')
            .attr('stroke', node.style?.stroke || '#c2185b')
            .attr('stroke-width', 2)
            .attr('opacity', 0.5);

        // Draw header area at top
        containerGroup
            .append('rect')
            .attr('x', -width / 2)
            .attr('y', -height / 2)
            .attr('width', width)
            .attr('height', headerHeight)
            .attr('rx', 7)
            .attr('fill', node.style?.fill || '#fce4ec')
            .attr('stroke', node.style?.stroke || '#c2185b')
            .attr('stroke-width', 2);

        // Add container label in header
        containerGroup
            .append('text')
            .attr('x', 0)
            .attr('y', -height / 2 + headerHeight / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', this.theme.textColor)
            .attr('font-size', this.theme.fontSize)
            .attr('font-family', this.theme.fontFamily)
            .text(node.label);

        // Optionally add state type label
        if (this.options.showStateTypes) {
            containerGroup
                .append('text')
                .attr('x', 0)
                .attr('y', -height / 2 + headerHeight / 2 + 18)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', this.theme.fontSize - 2)
                .attr('opacity', 0.7)
                .text(`${node.type} state`);
        }
    }

    /**
     * Render a single node
     */
    private renderNode(params: RenderNodeParams): void {
        const { group, node } = params;
        const nodeGroup = group
            .append('g')
            .attr('class', `node node-${node.type}`)
            .attr('transform', `translate(${node.x}, ${node.y})`);

        const style = node.style;
        if (!style) {
            return;
        }

        // Render shape based on type
        switch (style.shape) {
            case 'circle':
                this.renderCircle({ group: nodeGroup, node, style });
                break;
            case 'diamond':
                this.renderDiamond({ group: nodeGroup, node, style });
                break;
            default:
                this.renderRect({ group: nodeGroup, node, style });
        }

        // Render icon if present
        if (node.iconUrl && this.options.showIcons) {
            this.renderIcon({
                group: nodeGroup,
                iconPosition: this.options.iconPosition || 'left',
                iconSize: this.options.iconSize || 24,
                iconUrl: node.iconUrl,
                node,
            });
        }

        // Calculate label position based on icon
        const labelX = this.calculateLabelX({
            hasIcon: !!node.iconUrl && !!this.options.showIcons,
            iconPosition: this.options.iconPosition || 'left',
            iconSize: this.options.iconSize || 24,
            node,
        });
        const labelY = this.calculateLabelY({
            hasIcon: !!node.iconUrl && !!this.options.showIcons,
            iconPosition: this.options.iconPosition || 'left',
            iconSize: this.options.iconSize || 24,
            node,
        });

        // Add label
        nodeGroup
            .append('text')
            .attr('x', labelX)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', this.theme.textColor)
            .attr('font-size', this.theme.fontSize)
            .attr('font-family', this.theme.fontFamily)
            .text(node.label);

        // Optionally add state type
        if (this.options.showStateTypes) {
            nodeGroup
                .append('text')
                .attr('x', labelX)
                .attr('y', labelY + 20)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', this.theme.fontSize - 2)
                .attr('opacity', 0.7)
                .text(node.type);
        }
    }

    /**
     * Render rectangle node
     */
    private renderRect(params: RenderShapeParams): void {
        const { group, node, style } = params;
        const width = node.width || 120;
        const height = node.height || 60;

        group
            .append('rect')
            .attr('x', -width / 2)
            .attr('y', -height / 2)
            .attr('width', width)
            .attr('height', height)
            .attr('rx', 5) // Rounded corners
            .attr('fill', style.fill)
            .attr('stroke', style.stroke)
            .attr('stroke-width', style.strokeWidth);
    }

    /**
     * Render circle node
     */
    private renderCircle(params: RenderShapeParams): void {
        const { group, node, style } = params;
        const radius = (node.width || 60) / 2;

        group
            .append('circle')
            .attr('r', radius)
            .attr('fill', style.fill)
            .attr('stroke', style.stroke)
            .attr('stroke-width', style.strokeWidth);
    }

    /**
     * Render diamond node
     */
    private renderDiamond(params: RenderShapeParams): void {
        const { group, node, style } = params;
        const halfWidth = (node.width || 120) / 2;
        const halfHeight = (node.height || 60) / 2;
        const path = `M 0,-${halfHeight} L ${halfWidth},0 L 0,${halfHeight} L -${halfWidth},0 Z`;

        group
            .append('path')
            .attr('d', path)
            .attr('fill', style.fill)
            .attr('stroke', style.stroke)
            .attr('stroke-width', style.strokeWidth);
    }

    /**
     * Render AWS service icon within node
     */
    private renderIcon(params: RenderIconParams): void {
        const { group, iconPosition, iconSize, iconUrl, node } = params;

        const width = node.width || 120;
        const height = node.height || 60;
        const padding = 8;

        let iconX = 0;
        let iconY = 0;

        switch (iconPosition) {
            case 'left':
                // Position inside left edge with padding, vertically centered
                iconX = -width / 2 + padding;
                iconY = -iconSize / 2;
                break;
            case 'top':
                // Position horizontally centered, inside top edge with padding
                iconX = -iconSize / 2;
                iconY = -height / 2 + padding;
                break;
            case 'right':
                // Position inside right edge with padding, vertically centered
                iconX = width / 2 - iconSize - padding;
                iconY = -iconSize / 2;
                break;
        }

        group
            .append('image')
            .attr('x', iconX)
            .attr('y', iconY)
            .attr('width', iconSize)
            .attr('height', iconSize)
            .attr('href', iconUrl)
            .attr('preserveAspectRatio', 'xMidYMid meet');
    }

    /**
     * Calculate label X position based on icon presence and position
     */
    private calculateLabelX(params: CalculateLabelPositionParams): number {
        const { hasIcon, iconPosition, iconSize, node } = params;
        if (!hasIcon) return 0;

        const width = node.width || 120;
        const padding = 8;
        const gap = 4; // Gap between icon and label

        switch (iconPosition) {
            case 'left':
                // Center label in remaining space to the right of icon
                // Icon ends at: -width/2 + padding + iconSize
                // Available space: from that point to width/2
                return (padding + iconSize + gap) / 2;
            case 'right':
                // Center label in remaining space to the left of icon
                // Icon starts at: width/2 - iconSize - padding
                // Available space: from -width/2 to that point
                return -(padding + iconSize + gap) / 2;
            default:
                return 0;
        }
    }

    /**
     * Calculate label Y position based on icon presence and position
     */
    private calculateLabelY(params: CalculateLabelPositionParams): number {
        const { hasIcon, iconPosition, iconSize, node } = params;
        if (!hasIcon || iconPosition !== 'top') return 0;

        const padding = 8;
        const gap = 4; // Gap between icon and label

        // Center label in remaining space below icon
        // Icon ends at: -height/2 + padding + iconSize
        return (padding + iconSize + gap) / 2;
    }

    /**
     * Render an edge
     */
    private renderEdge(params: RenderEdgeParams): void {
        const { edge, group } = params;
        if (!edge.points || edge.points.length < 2) {
            return;
        }

        const edgeColor = this.theme.edgeColors[edge.type || 'normal'];
        const markerType = edge.type || 'normal';

        // Create path from points
        const pathGenerator = line<{ x: number; y: number }>()
            .x((d) => d.x)
            .y((d) => d.y);

        if (this.options.edgeStyle === 'curved') {
            pathGenerator.curve(curveBasis);
        }

        // Render path
        const pathElement = group
            .append('path')
            .attr('d', pathGenerator(edge.points))
            .attr('fill', 'none')
            .attr('stroke', edgeColor)
            .attr('stroke-width', edge.type === 'error' ? 2 : 1.5)
            .attr('marker-end', `url(#arrowhead-${markerType})`);

        // Add dashed style for error and default edges
        if (edge.type === 'error') {
            pathElement.attr('stroke-dasharray', '5,5');
        } else if (edge.type === 'default') {
            pathElement.attr('stroke-dasharray', '8,4');
        }

        // Add edge label if present
        if (edge.label) {
            const midpoint = this.getPathMidpoint(edge.points);
            const labelDimensions = this.calculateLabelDimensions(edge.label);

            group
                .append('rect')
                .attr('x', midpoint.x - labelDimensions.width / 2)
                .attr('y', midpoint.y - labelDimensions.height / 2)
                .attr('width', labelDimensions.width)
                .attr('height', labelDimensions.height)
                .attr('fill', this.theme.background || '#ffffff')
                .attr('stroke', edgeColor)
                .attr('stroke-width', 0.5)
                .attr('rx', 3);

            group
                .append('text')
                .attr('x', midpoint.x)
                .attr('y', midpoint.y)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', edgeColor)
                .attr('font-size', this.theme.fontSize - 2)
                .text(edge.label);
        }
    }

    /**
     * Get the midpoint of a path for label placement
     */
    private getPathMidpoint(points: Array<{ x: number; y: number }>): {
        x: number;
        y: number;
    } {
        const midIndex = Math.floor(points.length / 2);
        return points[midIndex];
    }

    /**
     * Calculate dimensions for edge label
     */
    private calculateLabelDimensions(label: string): {
        height: number;
        width: number;
    } {
        // Approximate character width based on font size
        const fontSize = this.theme.fontSize - 2;
        const avgCharWidth = fontSize * 0.6; // Approximate ratio for proportional fonts
        const padding = 8; // Horizontal padding
        const verticalPadding = 4; // Vertical padding

        const width = label.length * avgCharWidth + padding * 2;
        const height = fontSize + verticalPadding * 2;

        return { height, width };
    }
}
