import type { EdgeType, StateType } from '../types';
import { AWS_DARK_THEME } from './themes';

/** The paint channel a themed colour class repaints. */
export type ThemeColorChannel = 'fill' | 'stroke';

/** Class on elements painted with the theme background, e.g. the canvas rect. */
export const BACKGROUND_FILL_CLASS: string = 'sfn-t-bg-fill';

/** Class on text painted with the theme text colour. */
export const TEXT_FILL_CLASS: string = 'sfn-t-text-fill';

/** Class on glyph strokes painted with the theme text colour, e.g. a collapse control's chevron. */
export const TEXT_STROKE_CLASS: string = 'sfn-t-text-stroke';

/** Parameters for {@link nodeColorClass}. */
export interface NodeColorClassParams {
    /** Which paint the class repaints. */
    channel: ThemeColorChannel;
    /** State type whose theme colour the element carries. */
    stateType: StateType;
}

/**
 * Class naming a state type's theme colour on one paint channel, which
 * {@link AUTO_THEME_DARK_CSS} repaints under `prefers-color-scheme: dark`.
 *
 * @param params - Class parameters
 * @param params.channel - `'fill'` or `'stroke'`
 * @param params.stateType - State type whose theme colour the element carries
 * @returns The class name, e.g. `sfn-t-node-Task-fill`
 *
 * @example
 * ```typescript
 * nodeColorClass({ channel: 'stroke', stateType: 'Choice' }); // 'sfn-t-node-Choice-stroke'
 * ```
 */
export function nodeColorClass(params: NodeColorClassParams): string {
    return `sfn-t-node-${params.stateType}-${params.channel}`;
}

/** Parameters for {@link edgeColorClass}. */
export interface EdgeColorClassParams {
    /** Which paint the class repaints. */
    channel: ThemeColorChannel;
    /** Edge kind whose theme colour the element carries. */
    edgeType: EdgeType;
}

/**
 * Class naming an edge kind's theme colour on one paint channel, which
 * {@link AUTO_THEME_DARK_CSS} repaints under `prefers-color-scheme: dark`.
 *
 * @param params - Class parameters
 * @param params.channel - `'fill'` (arrowheads, label text) or `'stroke'` (paths, label borders)
 * @param params.edgeType - Edge kind whose theme colour the element carries
 * @returns The class name, e.g. `sfn-t-edge-error-stroke`
 *
 * @example
 * ```typescript
 * edgeColorClass({ channel: 'fill', edgeType: 'retry' }); // 'sfn-t-edge-retry-fill'
 * ```
 */
export function edgeColorClass(params: EdgeColorClassParams): string {
    return `sfn-t-edge-${params.edgeType}-${params.channel}`;
}

// Exhaustive by construction: a new EdgeType fails to compile here until it gets a rule.
const EDGE_TYPE_KEYS: Record<EdgeType, true> = { choice: true, default: true, error: true, normal: true, retry: true };
const EDGE_TYPES = Object.keys(EDGE_TYPE_KEYS) as EdgeType[];

function buildAutoThemeDarkCss(): string {
    const { background, edgeColors, nodeColors, textColor } = AWS_DARK_THEME;
    const rules = [
        `.${BACKGROUND_FILL_CLASS} { fill: ${background}; }`,
        `.${TEXT_FILL_CLASS} { fill: ${textColor}; }`,
        `.${TEXT_STROKE_CLASS} { stroke: ${textColor}; }`,
    ];
    // nodeColors is a Record<StateType, ...>, so its keys are every state type.
    for (const [key, colors] of Object.entries(nodeColors)) {
        const stateType = key as StateType;
        rules.push(`.${nodeColorClass({ channel: 'fill', stateType })} { fill: ${colors.fill}; }`);
        rules.push(`.${nodeColorClass({ channel: 'stroke', stateType })} { stroke: ${colors.stroke}; }`);
    }
    for (const edgeType of EDGE_TYPES) {
        // Same fallback as SvgRenderer.resolveEdgeColor.
        const color = edgeColors[edgeType] ?? edgeColors.error ?? edgeColors.normal;
        rules.push(`.${edgeColorClass({ channel: 'stroke', edgeType })} { stroke: ${color}; }`);
        rules.push(`.${edgeColorClass({ channel: 'fill', edgeType })} { fill: ${color}; }`);
    }
    return `@media (prefers-color-scheme: dark) { ${rules.join(' ')} }`;
}

/**
 * Stylesheet an `'auto'`-themed SVG embeds: under `prefers-color-scheme: dark` it
 * repaints every themed class in the {@link AWS_DARK_THEME} palette, so the light
 * presentation attributes the SVG carries become exactly what `'dark'` would draw.
 *
 * A constant, never per diagram: `customColors` and override colours are left
 * untagged, so two diagrams on one page can share these document-global rules.
 * Contains no `<`, `>` or `&`, so it survives text escaping unchanged.
 */
export const AUTO_THEME_DARK_CSS: string = buildAutoThemeDarkCss();
