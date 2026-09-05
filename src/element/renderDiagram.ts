import { generateSvg, generateMermaid } from '../index';
import { generateExecution, generateMermaidExecution } from '../execution';
import type { AslDefinition, ExecutionHistoryInput, LayoutDirection, ThemeOption } from '../types';

/** Parameters for {@link renderDiagramString}. */
export interface RenderDiagramParams {
    /** ASL definition as an object or JSON string. */
    asl: AslDefinition | string;
    /**
     * Emit an invisible widened hit area under every edge so edges are comfortably
     * clickable. Only meaningful for `format: 'svg'` output that will be wired to the
     * interactive viewer. Defaults to `false`.
     */
    edgeHitAreas?: boolean;
    /** Render an SVG diagram or emit Mermaid code. Defaults to `'svg'`. */
    format?: 'mermaid' | 'svg';
    /** Optional execution history; when set, renders an execution overlay. */
    history?: ExecutionHistoryInput;
    /** Graph layout direction. Defaults to `'TB'`. */
    layout?: LayoutDirection;
    /** Diagram theme. Defaults to `'light'`. */
    theme?: ThemeOption;
}

/** Result of {@link renderDiagramString}. */
export type RenderDiagramResult =
    | { type: 'mermaid'; code: string }
    | { nodeCount: number; svg: string; type: 'svg' };

/**
 * Render an ASL definition to a diagram string (SVG markup or Mermaid code), branching
 * on `format` and whether an execution `history` was supplied.
 *
 * Shared by the `sfn-diagram/element` custom element - the same branch the
 * `sfn-diagram-react` `<SfnDiagram>` component runs, kept independent rather than
 * imported across the package boundary since it is a handful of lines.
 *
 * @param params - Render parameters
 * @throws When `asl` fails to parse or validate, or `history` is malformed
 *
 * @example
 * ```typescript
 * const result = renderDiagramString({ asl, layout: 'LR', theme: 'dark' });
 * if (result.type === 'svg') element.innerHTML = result.svg;
 * ```
 */
export function renderDiagramString(params: RenderDiagramParams): RenderDiagramResult {
    const { asl, edgeHitAreas = false, format = 'svg', history, layout = 'TB', theme = 'light' } = params;

    if (format === 'mermaid') {
        const output = history
            ? generateMermaidExecution({ aslDefinition: asl, history })
            : generateMermaid({ aslDefinition: asl });
        return { type: 'mermaid', code: output.code };
    }

    const output = history
        ? generateExecution({ aslDefinition: asl, edgeHitAreas, history, layout, theme })
        : generateSvg({ aslDefinition: asl, edgeHitAreas, layout, theme });
    return { nodeCount: output.metadata.nodeCount, svg: output.svg, type: 'svg' };
}
