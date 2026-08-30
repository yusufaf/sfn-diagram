import type { StateNode } from '../types';

/**
 * True for a container node that is still drawn as a group with its own child
 * nodes — a collapsed container is a plain placeholder node instead, and every
 * layout/render call site that branches on "is this an open container" needs
 * both halves of that check.
 */
export function isOpenContainer(node: StateNode): boolean {
    return node.isContainer === true && !node.collapsed;
}
