import { line, curveBasis } from 'd3-shape';
import {
    fitSubLabel,
    fitText,
    getAssignedVariablesLabel,
    getNodeSubLabelParts,
} from '../constants/labels';
import { isOpenContainer } from '../graph';
import { estimateTextWidth } from '../utils/textMeasure';
import type {
    StateNode,
    GraphEdge,
    DiagramOptions,
    SvgOutput,
    CustomTheme,
    NodeStyle,
} from '../types';
import type { LayoutResult } from '../layout/DagreLayout';
import {
    CONTAINER_HEADER_HEIGHT,
    CONTAINER_HEADER_PADDING_X,
    CONTAINER_HEADER_TEXT_HEIGHT,
    CONTAINER_LINE_GAP_RATIO,
    getContainerHeaderFontSizes,
} from '../constants';
import { getTheme } from '../config/themes';
import { SvgElement } from './svgBuilder';

/**
 * Stroke width of the invisible per-edge hit area emitted under `edgeHitAreas`. Wide
 * enough to click without aiming, narrow enough that neighbouring edges in a dense
 * layout don't overlap each other's targets.
 */
const EDGE_HIT_AREA_WIDTH = 12;

/**
 * Horizontal breathing room kept on each side of a node's sub-label, so a trimmed
 * label stops short of the border rather than touching it. A container's header text
 * uses the shared CONTAINER_HEADER_PADDING_X instead, so the layout can size the box
 * to agree with it.
 */
const SUB_LABEL_PADDING = 8;

/** Node width assumed when neither the layout nor the options supply one. */
const DEFAULT_NODE_WIDTH = 120;

interface RenderShapeParams {
    group: SvgElement;
    node: StateNode;
    style: NodeStyle;
}

interface RenderNodeParams {
    group: SvgElement;
    node: StateNode;
}

interface RenderEdgeParams {
    edge: GraphEdge & { loopIndex?: number; points?: Array<{ x: number; y: number }> };
    group: SvgElement;
    /**
     * Group to put this edge's invisible hit area in, when `edgeHitAreas` is on. Kept
     * separate from `group` so it can sit above the container rects in hit-test order
     * - see the group ordering in {@link SvgRenderer.render}.
     */
    hitAreaGroup?: SvgElement;
    nodes: StateNode[];
    /** Widest self-loop label per node id — see {@link SvgRenderer.selfLoopLabelCenter}. */
    selfLoopLabelWidths: Map<string, number>;
}

interface CalculateBoundsParams {
    layout: LayoutResult;
    /** Widest self-loop label per node id — see {@link SvgRenderer.selfLoopLabelCenter}. */
    selfLoopLabelWidths: Map<string, number>;
}

interface EdgeLabelCenterParams {
    edge: GraphEdge & { loopIndex?: number; points?: Array<{ x: number; y: number }> };
    nodes: StateNode[];
    /** Widest self-loop label per node id — see {@link SvgRenderer.selfLoopLabelCenter}. */
    selfLoopLabelWidths: Map<string, number>;
}

interface CalculateLabelPositionParams {
    hasIcon: boolean;
    iconPosition: 'left' | 'top' | 'right';
    iconSize: number;
    node: StateNode;
}

interface RenderIconParams {
    group: SvgElement;
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
    private pathGenerator: (points: Array<{ x: number; y: number }>) => string | null;

    constructor(options: DiagramOptions) {
        this.options = options;
        this.theme = getTheme(options.theme, options.customColors);

        // Build the edge path generator once - it's stateless and reused for every
        // edge, so there's no need to recreate it inside the per-edge render loop.
        const generator = line<{ x: number; y: number }>()
            .x((point) => point.x)
            .y((point) => point.y);
        if (options.edgeStyle === 'curved') {
            generator.curve(curveBasis);
        }
        this.pathGenerator = generator;
    }

    /**
     * Render the diagram to SVG string
     */
    render(layout: LayoutResult): SvgOutput {
        // Nested self-loop labels stagger along a shared axis, so every loop on a node
        // has to step by the same amount - see selfLoopLabelCenter. Measured once here
        // so bounds and rendering agree on where each label lands.
        const selfLoopLabelWidths = this.calculateSelfLoopLabelWidths(layout.edges);

        // Calculate actual bounds including edge curves
        const bounds = this.calculateBounds({ layout, selfLoopLabelWidths });

        // Build the SVG tree with a DOM-free string builder so this runs in Node,
        // browsers, and edge runtimes without a DOM implementation.
        const svg = new SvgElement('svg')
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

        // Retry arrow (self-loops)
        defs.append('marker')
            .attr('id', 'arrowhead-retry')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 9)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', this.resolveEdgeColor('retry'));

        // Create groups for edges, container nodes, and regular nodes.
        //
        // Under `edgeHitAreas` the invisible per-edge targets go in their own group
        // placed *after* the containers: a container's background rect is filled, so it
        // hit-tests above anything drawn before it and would otherwise swallow every
        // click on an edge routed inside it. Nodes still come last, so a node keeps
        // winning over an edge that passes beneath it.
        const edgesGroup = svg.append('g').attr('class', 'edges');
        const containersGroup = svg.append('g').attr('class', 'containers');
        const edgeHitAreasGroup = this.options.edgeHitAreas
            ? svg.append('g').attr('class', 'edge-hit-areas')
            : undefined;
        const nodesGroup = svg.append('g').attr('class', 'nodes');

        // Separate container nodes from regular nodes
        const containerNodes = layout.nodes.filter((node) => isOpenContainer(node));
        const regularNodes = layout.nodes.filter((node) => !isOpenContainer(node));

        // Index nodes by id once so the edge loop below is O(E) instead of O(E*V)
        const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));

        // Render edges first (so they appear behind everything)
        layout.edges.forEach((edge) => {
            // Skip edges from branch/iterator end markers - we show container edges instead
            const fromNode = nodesById.get(edge.from);
            if (
                fromNode &&
                (fromNode.type === 'BranchEnd' || fromNode.type === 'IteratorEnd')
            ) {
                return;
            }

            this.renderEdge({
                edge,
                group: edgesGroup,
                hitAreaGroup: edgeHitAreasGroup,
                nodes: layout.nodes,
                selfLoopLabelWidths,
            });
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
            svg: svg.serialize(),
            width: bounds.width,
        };
    }

    /**
     * Calculate bounding box including all nodes and edge points
     */
    private calculateBounds(params: CalculateBoundsParams): {
        height: number;
        minX: number;
        minY: number;
        width: number;
    } {
        const { layout, selfLoopLabelWidths } = params;
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

        // Include edge points (guard against non-finite coordinates so a single bad
        // routing point can never poison the overall bounds with NaN/Infinity)
        layout.edges.forEach((edge) => {
            if (edge.points) {
                edge.points.forEach((point) => {
                    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                        return;
                    }
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                });
            }

            // Include edge label bounds
            if (edge.label && edge.points && edge.points.length > 0) {
                const midpoint = this.edgeLabelCenter({
                    edge,
                    nodes: layout.nodes,
                    selfLoopLabelWidths,
                });
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
            .attr('data-state-id', node.id)
            .attr('data-state-type', node.type)
            .attr('transform', `translate(${node.x}, ${node.y})`);

        const width = node.width || 480;
        const height = node.height || 180;
        const headerHeight = CONTAINER_HEADER_HEIGHT;

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

        const headerTop = -height / 2;
        const textMiddle = headerTop + CONTAINER_HEADER_TEXT_HEIGHT / 2;
        // getContainerHeaderFontSizes shrinks subFontSize into whatever room is left
        // rather than dropping it: a large custom theme.fontSize would otherwise
        // silently lose the Distributed marker, concurrency, tolerance and batching
        // altogether. The two clamped lines (below) never overlap as long as it stays
        // at or under `CONTAINER_HEADER_TEXT_HEIGHT - nameFontSize` — each line's
        // independent clamp then lands them exactly touching at worst. Once
        // nameFontSize leaves less room than MIN_SUB_LABEL_FONT_SIZE, honouring that
        // floor would push the sub-label past that touching point and into the name —
        // so canFitSubLabel drops the sub-label there instead.
        const { canFitSubLabel, nameFontSize, subFontSize } = getContainerHeaderFontSizes(
            this.theme.fontSize
        );
        const headerAvailableWidth = width - CONTAINER_HEADER_PADDING_X * 2;

        // The layout already grew the box to fit the header's widest line up to
        // CONTAINER_MAX_HEADER_WIDTH (see DagreLayout.calculateContainerBounds), so
        // eliding here only fires past that cap, or when children forced the box
        // narrower than the header needs in the first place.
        const name = fitText({
            availableWidth: headerAvailableWidth,
            measure: (text) => estimateTextWidth(text, nameFontSize),
            text: node.label,
        });

        // Sub-label under the container name. The Distributed marker and
        // MaxConcurrency are always shown when present — a Distributed Map runs a
        // child execution per batch rather than iterating inline, so it must not
        // read as a plain Map. The state type itself stays opt-in.
        const subLabel = canFitSubLabel
            ? fitSubLabel({
                  availableWidth: headerAvailableWidth,
                  measure: (text) => estimateTextWidth(text, subFontSize),
                  parts: getNodeSubLabelParts({
                      node,
                      showStateType: this.options.showStateTypes === true,
                  }),
              })
            : null;

        // Both lines live inside the header band. When there is no sub-label the name is
        // centred in it; when there is, the two straddle the centre, separated by a gap
        // proportional to the font so a large custom fontSize cannot push the sub-label
        // back out of the band. Both baselines are clamped to the band for the same
        // reason — the band is only as tall as the gap the layout leaves above the
        // children, so anything drawn past it lands under the first child row.
        // The band's lower strip is covered by the first child row - containers are
        // painted before their children - so the text gets CONTAINER_HEADER_TEXT_HEIGHT,
        // the part genuinely clear of children, rather than the band's full height.
        // Using the latter is what put the sub-label under the first child.
        const lineGap = (nameFontSize + subFontSize) * CONTAINER_LINE_GAP_RATIO;
        const clampToText = (y: number, fontSize: number): number =>
            Math.min(
                Math.max(y, headerTop + fontSize / 2),
                headerTop + CONTAINER_HEADER_TEXT_HEIGHT - fontSize / 2
            );

        containerGroup
            .append('text')
            .attr('x', 0)
            .attr('y', subLabel ? clampToText(textMiddle - lineGap / 2, nameFontSize) : textMiddle)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', this.theme.textColor)
            .attr('font-size', nameFontSize)
            .attr('font-family', this.theme.fontFamily)
            .text(name);

        if (subLabel) {
            containerGroup
                .append('text')
                .attr('x', 0)
                .attr('y', clampToText(textMiddle + lineGap / 2, subFontSize))
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', subFontSize)
                .attr('font-family', this.theme.fontFamily)
                .attr('opacity', 0.7)
                .text(subLabel);
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
            .attr('data-state-id', node.id)
            .attr('data-state-type', node.type)
            .attr('transform', `translate(${node.x}, ${node.y})`);

        const baseStyle = node.style;
        if (!baseStyle) {
            return;
        }
        const override = this.options.nodeOverrides?.[node.id];
        const style: NodeStyle = override ? { ...baseStyle, ...override } : baseStyle;

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

        // Optionally add state type — skipped for a collapsed container, which uses
        // the richer sub-label below (reusing the same slot/offset) instead.
        // Composed rather than a bare state type: a Wait state's duration shares this
        // slot, and `showStateTypes` must not cost the reader the duration.
        // Same fallback the shape code uses (`node.width || DEFAULT_NODE_WIDTH`): this
        // renderer does not merge option defaults, so a hand-built layout whose nodes
        // carry no width would otherwise compute a negative budget and silently drop
        // every sub-label while the rect is still drawn at its default size.
        const secondLineText = fitSubLabel({
            availableWidth:
                (node.width || this.options.nodeWidth || DEFAULT_NODE_WIDTH) -
                SUB_LABEL_PADDING * 2,
            measure: (text) => estimateTextWidth(text, this.theme.fontSize - 2),
            parts: getNodeSubLabelParts({
                node,
                showStateType: this.options.showStateTypes === true,
            }),
        });
        const secondLineShown = secondLineText !== '';

        if (secondLineText) {
            nodeGroup
                .append('text')
                .attr('x', labelX)
                .attr('y', labelY + 20)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', this.theme.fontSize - 2)
                .attr('font-family', this.theme.fontFamily)
                .attr('opacity', 0.7)
                .text(secondLineText);
        }

        // Optional annotation (execution overlay: duration / retry count), placed
        // below the label and the state type / collapsed sub-label when shown.
        const annotation = this.options.nodeAnnotations?.[node.id];
        if (annotation) {
            nodeGroup
                .append('text')
                .attr('x', labelX)
                .attr('y', labelY + (secondLineShown ? 36 : 18))
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', this.theme.fontSize - 3)
                .attr('font-family', this.theme.fontFamily)
                .attr('opacity', 0.75)
                .text(annotation);
        }

        // ASL Variables assigned by this state, stacked beneath whichever of the
        // second line and annotation are present.
        if (this.options.showVariables !== false && node.assignedVariables?.length) {
            const stackedOffset = (secondLineShown ? 36 : 18) + (annotation ? 16 : 0);
            nodeGroup
                .append('text')
                .attr('class', 'node-variables')
                .attr('x', labelX)
                .attr('y', labelY + stackedOffset)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', this.theme.textColor)
                .attr('font-size', this.theme.fontSize - 3)
                .attr('font-family', this.theme.fontFamily)
                .attr('opacity', 0.7)
                .text(getAssignedVariablesLabel(node.assignedVariables));
        }
    }

    /**
     * Render rectangle node
     */
    private renderRect(params: RenderShapeParams): void {
        const { group, node, style } = params;
        const width = node.width || 120;
        const height = node.height || 60;

        const rect = group
            .append('rect')
            .attr('x', -width / 2)
            .attr('y', -height / 2)
            .attr('width', width)
            .attr('height', height)
            .attr('rx', 5) // Rounded corners
            .attr('fill', style.fill)
            .attr('stroke', style.stroke)
            .attr('stroke-width', style.strokeWidth);

        // A collapsed container placeholder gets a dashed border so it reads as a
        // stand-in for hidden content rather than an ordinary state.
        if (node.collapsed) {
            rect.attr('stroke-dasharray', '6 3');
        }
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
        const { hasIcon, iconPosition, iconSize } = params;
        if (!hasIcon) return 0;

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
        const { hasIcon, iconPosition, iconSize } = params;
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
        const { edge, group, hitAreaGroup, nodes, selfLoopLabelWidths } = params;
        if (!edge.points || edge.points.length < 2) {
            return;
        }

        const edgeColor = this.resolveEdgeColor(edge.type);
        const markerType = edge.type || 'normal';
        const isSelfLoop = edge.from === edge.to;

        // Self-loops (Retry) use an explicit loop path; all other edges use the
        // shared d3 path generator built once in the constructor.
        const pathData = isSelfLoop
            ? this.buildSelfLoopPath(edge.points)
            : this.pathGenerator(edge.points) ?? '';

        // Per-edge override (used by the execution overlay to emphasize the taken path
        // and dim untaken transitions). Two key shapes are accepted: the qualified
        // `edge.id`, and the legacy bare `${from}->${to}`, which broad-matches every
        // edge of that pair. The qualified key is merged on top, field by field, so a
        // caller can set a pair-wide width and still restyle one branch's stroke.
        const broadOverride = this.options.edgeOverrides?.[`${edge.from}->${edge.to}`];
        const exactOverride = this.options.edgeOverrides?.[edge.id];
        const override =
            broadOverride || exactOverride
                ? { ...broadOverride, ...exactOverride }
                : undefined;
        const strokeColor = override?.stroke ?? edgeColor;
        const strokeWidth = override?.strokeWidth ?? (edge.type === 'error' ? 2 : 1.5);

        // Invisible widened copy of the same path. A 1.5px stroke is a punishing click
        // target; this gives the viewer a comfortable one without changing what the
        // diagram looks like. It carries the same `data-edge-id`, so a
        // `closest('[data-edge-id]')` lookup resolves either way. It goes in its own
        // group rather than beside the visible path - see the group ordering in render().
        if (hitAreaGroup) {
            hitAreaGroup
                .append('path')
                .attr('d', pathData)
                .attr('data-edge-id', edge.id)
                .attr('data-edge-hit-area', '')
                .attr('fill', 'none')
                .attr('stroke', 'transparent')
                .attr('stroke-width', EDGE_HIT_AREA_WIDTH)
                .attr('pointer-events', 'stroke');
        }

        // Render path. The edge id is emitted alongside it so callers can read the key
        // that addresses this edge in `edgeOverrides` straight off a rendered diagram,
        // rather than deriving `${from}->${to}#${type}#${ordinal}` by hand.
        const pathElement = group
            .append('path')
            .attr('d', pathData)
            .attr('data-edge-id', edge.id)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('marker-end', `url(#arrowhead-${markerType})`);

        if (override?.strokeOpacity !== undefined) {
            pathElement.attr('stroke-opacity', override.strokeOpacity);
        }

        // Add dashed style for error, default, and retry edges
        if (edge.type === 'error') {
            pathElement.attr('stroke-dasharray', '5,5');
        } else if (edge.type === 'default') {
            pathElement.attr('stroke-dasharray', '8,4');
        } else if (edge.type === 'retry') {
            pathElement.attr('stroke-dasharray', '4,3');
        }

        // Add edge label if present
        if (edge.label) {
            const midpoint = this.edgeLabelCenter({ edge, nodes, selfLoopLabelWidths });
            const labelDimensions = this.calculateLabelDimensions(edge.label);

            const labelRect = group
                .append('rect')
                .attr('x', midpoint.x - labelDimensions.width / 2)
                .attr('y', midpoint.y - labelDimensions.height / 2)
                .attr('width', labelDimensions.width)
                .attr('height', labelDimensions.height)
                .attr('fill', this.theme.background || '#ffffff')
                .attr('stroke', edgeColor)
                .attr('stroke-width', 0.5)
                .attr('rx', 3);

            const labelText = group
                .append('text')
                .attr('x', midpoint.x)
                .attr('y', midpoint.y)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', edgeColor)
                .attr('font-size', this.theme.fontSize - 2)
                .attr('font-family', this.theme.fontFamily)
                .text(edge.label);

            // The label is drawn over the midpoint of its own edge, exactly where a
            // reader aims. Without the id it would swallow the click; with it, clicking
            // the label selects the edge it labels. Attached only alongside the hit
            // areas, so static export markup is untouched.
            if (hitAreaGroup) {
                labelRect.attr('data-edge-id', edge.id);
                labelText.attr('data-edge-id', edge.id);
            }
        }
    }

    /**
     * Resolve the stroke colour for an edge type, falling back to the error colour
     * (then normal) so themes that predate a given edge type still render.
     */
    private resolveEdgeColor(type?: GraphEdge['type']): string {
        const colors = this.theme.edgeColors;
        return colors[type || 'normal'] ?? colors.error ?? colors.normal;
    }

    /**
     * Build an SVG path for a self-loop edge from its [entry, apex, exit] points,
     * curving out to the apex and back so the arrow re-enters the node.
     */
    private buildSelfLoopPath(points: Array<{ x: number; y: number }>): string {
        const [entry, apex, exit] = points;
        return `M ${entry.x},${entry.y} C ${apex.x},${apex.y} ${apex.x},${apex.y} ${exit.x},${exit.y}`;
    }

    /**
     * Compute where an edge's label should be centered. Normal edges center on the
     * path midpoint; self-loops anchor off the loop's apex instead, falling back to a
     * spot clear of neighbouring nodes if the default placement would land on one.
     */
    private edgeLabelCenter(params: EdgeLabelCenterParams): { x: number; y: number } {
        const { edge, nodes, selfLoopLabelWidths } = params;
        const points = edge.points ?? [];
        if (edge.from === edge.to && edge.label && points.length >= 3) {
            return this.selfLoopLabelCenter({ edge, nodes, points, selfLoopLabelWidths });
        }
        return this.getPathMidpoint(points);
    }

    /**
     * Measure the widest self-loop label on each node, keyed by the looping node's id.
     *
     * `selfLoopLabelCenter` staggers nested self-loop labels by one step per loop index,
     * and a step only guarantees separation if it is at least as large as the labels it
     * is separating. Label *height* is fixed by the font size, so the horizontal-bulge
     * arm can step by its own label's height safely; label *width* is per-edge, so the
     * vertical-bulge arm has to step by the widest label on the node instead of its own.
     *
     * @param edges - Every routed edge in the layout
     * @returns Widest measured label width per looping node id; nodes with no labelled
     *   self-loop are absent
     */
    private calculateSelfLoopLabelWidths(edges: LayoutResult['edges']): Map<string, number> {
        const widths = new Map<string, number>();
        for (const edge of edges) {
            if (edge.from !== edge.to || !edge.label) {
                continue;
            }
            const { width } = this.calculateLabelDimensions(edge.label);
            widths.set(edge.from, Math.max(widths.get(edge.from) ?? 0, width));
        }
        return widths;
    }

    /**
     * Self-loop labels can't use the path midpoint the way normal edges do: for a
     * 3-point self-loop path the midpoint *is* the apex, but the apex is a Bezier
     * *control* point that `buildSelfLoopPath` never actually draws through. The
     * default placement is offset from the real curve peak instead, perpendicular to
     * whichever axis the loop bulges along (see DagreLayout.calculateVisualEdgePoints).
     * If that would overlap another node - a tight nodesep can leave less room than
     * the loop needs - the label is stacked on the loop's other axis instead, staying
     * over the looping node's own footprint rather than reaching toward a neighbour.
     *
     * Nested loops on the same node all bulge along the same axis and land on the same
     * peak coordinate along that axis, so without further adjustment their labels would
     * sit exactly on top of one another. `edge.loopIndex` (stamped by DagreLayout for
     * self-loops) staggers each loop's label one step further along the axis
     * *perpendicular* to the bulge, so nested loops fan their labels apart the same way
     * they fan their arcs. Index 0 gets a zero offset, so a node with exactly one loop
     * renders in exactly the same place as before loopIndex existed.
     *
     * The step has to be a quantity shared by every loop on the node, not each edge's
     * own label size, or a short inner label can land inside a long outer one's rect and
     * occlude it. Height is shared already (fixed font size); width is not, so the
     * vertical-bulge arm steps by the node's widest self-loop label
     * (`selfLoopLabelWidths`) rather than by this edge's width.
     */
    private selfLoopLabelCenter(params: {
        edge: GraphEdge & { loopIndex?: number };
        nodes: StateNode[];
        points: Array<{ x: number; y: number }>;
        selfLoopLabelWidths: Map<string, number>;
    }): { x: number; y: number } {
        const { edge, nodes, points, selfLoopLabelWidths } = params;
        const [entry, apex, exit] = points;
        const gap = 8;
        const { width: labelWidth, height: labelHeight } = this.calculateLabelDimensions(
            edge.label ?? '',
        );
        const loopIndex = edge.loopIndex ?? 0;
        // Falls back to this edge's own width for callers that render an edge without a
        // measured sibling set - a single loop staggers by zero either way.
        const widthStep = (selfLoopLabelWidths.get(edge.from) ?? labelWidth) + gap;

        // Point actually on the drawn curve at t=0.5. Both Bezier control points are
        // `apex` (see buildSelfLoopPath), so B(0.5) = 0.125*entry + 0.75*apex + 0.125*exit.
        const peak = {
            x: entry.x * 0.125 + apex.x * 0.75 + exit.x * 0.125,
            y: entry.y * 0.125 + apex.y * 0.75 + exit.y * 0.125,
        };

        // The loop bulges along whichever axis has the larger apex offset - horizontal
        // for the default right-hand loop (TB/BT), vertical for the top loop (LR/RL).
        const bulgesHorizontally = Math.abs(apex.x - entry.x) >= Math.abs(apex.y - entry.y);

        const primary = bulgesHorizontally
            ? { x: peak.x + gap + labelWidth / 2, y: peak.y + loopIndex * (labelHeight + gap) }
            : { x: peak.x + loopIndex * widthStep, y: peak.y - gap - labelHeight / 2 };

        const otherNodes = nodes.filter((node) => node.id !== edge.from);
        if (!this.rectOverlapsAnyNode({ height: labelHeight, width: labelWidth, ...primary }, otherNodes)) {
            return primary;
        }

        const loopingNode = nodes.find((node) => node.id === edge.from);
        if (bulgesHorizontally) {
            // Stack below the node itself instead of reaching to the right, staggering
            // outward per loopIndex the same way the primary placement does.
            const centerX = loopingNode?.x ?? peak.x;
            const bottomY = (loopingNode?.y ?? peak.y) + (loopingNode?.height || 0) / 2;
            return {
                x: centerX,
                y: bottomY + gap + labelHeight / 2 + loopIndex * (labelHeight + gap),
            };
        }
        // Vertical loop: fall back to the side instead of reaching further upward.
        return {
            x: peak.x + gap + labelWidth / 2 + loopIndex * widthStep,
            y: peak.y,
        };
    }

    /** Axis-aligned rect-vs-node-box overlap test used for self-loop label placement. */
    private rectOverlapsAnyNode(
        rect: { height: number; width: number; x: number; y: number },
        nodes: StateNode[],
    ): boolean {
        const left = rect.x - rect.width / 2;
        const right = rect.x + rect.width / 2;
        const top = rect.y - rect.height / 2;
        const bottom = rect.y + rect.height / 2;
        return nodes.some((node) => {
            const nodeLeft = (node.x || 0) - (node.width || 0) / 2;
            const nodeRight = (node.x || 0) + (node.width || 0) / 2;
            const nodeTop = (node.y || 0) - (node.height || 0) / 2;
            const nodeBottom = (node.y || 0) + (node.height || 0) / 2;
            return left < nodeRight && right > nodeLeft && top < nodeBottom && bottom > nodeTop;
        });
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
        const fontSize = this.theme.fontSize - 2;
        const padding = 8; // Horizontal padding
        const verticalPadding = 4; // Vertical padding

        const width = estimateTextWidth(label, fontSize) + padding * 2;
        const height = fontSize + verticalPadding * 2;

        return { height, width };
    }
}
