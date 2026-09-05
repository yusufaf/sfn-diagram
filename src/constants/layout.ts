/**
 * Geometry shared between the layout, which decides where a container's box goes, and
 * the renderer, which draws its header inside that box. Both had their own copy of
 * these numbers, which is how they came to disagree: the header was drawn 50px tall
 * into a 40px gap, so the first child row covered the container's own sub-label.
 */

/**
 * Space between a container's box and its outermost children, on every side.
 *
 * The top gap is what the header band has to fit inside — the container's box is
 * positioned from its children's bounds, and moving it further up would collide with
 * whatever sits above it in the same column.
 */
export const CONTAINER_PADDING = 40;

/**
 * Height of the header band drawn across the top of a container, carrying its name
 * and sub-label.
 *
 * Must not exceed {@link CONTAINER_PADDING}: anything past that is drawn over the
 * container's own children.
 */
export const CONTAINER_HEADER_HEIGHT: number = CONTAINER_PADDING;

/** Baseline of a container's name within its header band, measured from the band's top. */
export const CONTAINER_NAME_BASELINE = 15;

/**
 * Baseline of a container's sub-label, measured from the band's top. Only used when
 * there is a sub-label; a container without one centres its name instead.
 */
export const CONTAINER_SUB_LABEL_BASELINE = 30;
