/**
 * Node count at or below which the minimap starts collapsed. Shared by the shell
 * (initial visibility) and the collapse controller (re-applied after every relayout),
 * in a module small enough for the inlined controller bundle to import.
 */
export const MINIMAP_AUTO_VISIBLE_THRESHOLD = 25;

/** Parameters for {@link minimapStartsCollapsed}. */
export interface MinimapStartsCollapsedParams {
    /**
     * Node count from the rendered diagram's metadata. Omit (or pass `undefined`) when
     * unknown - the minimap starts collapsed in that case too.
     */
    nodeCount?: number;
}

/**
 * Decide whether the minimap should start collapsed for a diagram with `nodeCount`
 * nodes: collapsed at or below {@link MINIMAP_AUTO_VISIBLE_THRESHOLD}, or when the
 * count is unknown; open above it. Shared by `wrapSvgInInteractiveHtml`,
 * `generateViewerUpdate` and the viewer's collapse controller, so the threshold can't
 * drift between them.
 *
 * @param params - Threshold parameters
 * @returns Whether the minimap should start collapsed
 *
 * @example
 * ```typescript
 * minimapStartsCollapsed({ nodeCount: 10 }); // => true
 * minimapStartsCollapsed({ nodeCount: 30 }); // => false
 * ```
 */
export function minimapStartsCollapsed(params: MinimapStartsCollapsedParams): boolean {
    const { nodeCount } = params;
    return nodeCount === undefined || nodeCount <= MINIMAP_AUTO_VISIBLE_THRESHOLD;
}
