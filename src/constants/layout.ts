/**
 * Geometry shared between the layout, which decides where a container's box goes, and
 * the renderer, which draws its header inside that box. Both had their own copy of
 * these numbers, which is how they came to disagree: the header was drawn 50px tall
 * into a 40px gap, so the first child row covered the container's own sub-label.
 */

/**
 * Space between a container's box and its outermost children *above and to the sides*.
 *
 * Not symmetric vertically: the box's height adds this padding twice plus the header,
 * while its centre shifts down by only half the header, so the gap below the last child
 * ends up `CONTAINER_PADDING + CONTAINER_HEADER_HEIGHT`. That predates the constant
 * being named, and the top gap is the one that matters here — it is what the header
 * band has to fit inside, and the box cannot simply move up to make more room, because
 * it is positioned from its children's bounds and would collide with whatever sits
 * above it in the same column.
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

/**
 * Gap between the two header lines, as a multiple of the name's font size.
 *
 * Expressed relative to the font rather than as a fixed pixel offset: `theme.fontSize`
 * is a public, required field of `CustomTheme`, and fixed baselines that happen to suit
 * the built-in 14px themes put the two lines on top of each other at 18px and push the
 * sub-label back out of the band at 22px — reintroducing the very overlap this geometry
 * exists to prevent.
 */
export const CONTAINER_LINE_GAP_RATIO = 0.95;
