import type { AslDefinition, AslState, StateNode } from '../types';

/**
 * True for a container node that is still drawn as a group with its own child
 * nodes — a collapsed container is a plain placeholder node instead, and every
 * layout/render call site that branches on "is this an open container" needs
 * both halves of that check.
 */
export function isOpenContainer(node: StateNode): boolean {
    return node.isContainer === true && !node.collapsed;
}

/**
 * Synthetic node types the parser injects to anchor a Parallel branch's or
 * Map iterator's terminal edge for layout - not real ASL states, and never
 * meant to be shown to a reader.
 */
export const MARKER_NODE_TYPES: ReadonlySet<string> = new Set(['BranchEnd', 'IteratorEnd']);

/** True for a synthetic branch/iterator end marker node (see {@link MARKER_NODE_TYPES}). */
export function isMarkerNode(node: StateNode): boolean {
    return MARKER_NODE_TYPES.has(node.type);
}

/**
 * Resolve a Map state's inline processor definition.
 * Prefers the modern `ItemProcessor` field (used by inline and Distributed Map)
 * and falls back to the legacy `Iterator` field for pre-2022 definitions.
 *
 * Exported for internal reuse (the HTML viewer's state-data collector walks the
 * same nested definitions); not part of the package's public API.
 */
export function getMapProcessor(state: AslState): AslDefinition | undefined {
    return state.ItemProcessor ?? state.Iterator;
}
