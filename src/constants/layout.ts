/**
 * Geometry shared between the layout, which decides where a container's box goes, and
 * the renderer, which draws its header inside that box. Both kept their own copy of
 * these numbers, which is how they came to disagree — the renderer placed the header's
 * sub-label below the point where the first child row begins, so every container's
 * sub-label was drawn over.
 */

/**
 * Space between a container's box and its outermost children, above and to the sides.
 *
 * Not symmetric vertically: the box's height adds this twice plus the header band,
 * while its centre shifts down by only half the band, so the gap below the last child
 * ends up `CONTAINER_PADDING + CONTAINER_HEADER_HEIGHT`. That predates this constant
 * being named and other geometry now depends on it — the end markers a container's
 * branches finish at sit in that lower gap.
 *
 * The *top* gap is the one the header text has to live within, and the box cannot move
 * up to make more room: it is positioned from its children's bounds, and on the
 * `distributed-map` fixture there are only ten pixels between the row above and the
 * container's top edge.
 */
export const CONTAINER_PADDING = 40;

/**
 * Height of the header band drawn across the top of a container.
 *
 * Larger than {@link CONTAINER_HEADER_TEXT_HEIGHT} on purpose: the band's lower strip
 * sits behind the first child row, which is harmless because containers are painted
 * before their children and the strip is simply covered. Changing it would move the
 * box's bottom edge and the connectors that start at the band's foot, so it stays as
 * it has always been.
 */
export const CONTAINER_HEADER_HEIGHT = 50;

/**
 * Vertical space at the top of a container that is genuinely clear of its children,
 * and therefore all the room the header *text* has.
 *
 * This is the number the renderer was missing. It used the band's full height, put the
 * sub-label at a baseline below the first child's top edge, and the child covered it.
 */
export const CONTAINER_HEADER_TEXT_HEIGHT: number = CONTAINER_PADDING;

/**
 * Gap between the two header lines, as a multiple of the name's font size.
 *
 * Relative to the font rather than a fixed offset: `theme.fontSize` is a public,
 * required field of `CustomTheme`, and fixed baselines that suit the built-in 14px
 * themes put the two lines on top of each other at larger sizes.
 */
export const CONTAINER_LINE_GAP_RATIO = 0.95;

/**
 * Horizontal breathing room kept on each side of a container's header text, so its
 * name or sub-label stops short of the box's border rather than touching it. Shared
 * between the layout, which sizes the box to fit the header, and the renderer, which
 * draws the text into it.
 */
export const CONTAINER_HEADER_PADDING_X = 8;

/** Floor for the shrunk container sub-label, below which it stops being legible. */
export const MIN_SUB_LABEL_FONT_SIZE = 8;

/**
 * Widest a container may grow to fit its header. A container's box is otherwise sized
 * from its children alone, so a very long name or a Distributed Map's full sub-label
 * (mode, concurrency, tolerance, batching) can need more width than they leave -
 * without a cap, a single long JSONata expression in a name could stretch a container
 * across the whole diagram instead of eliding.
 */
export const CONTAINER_MAX_HEADER_WIDTH = 480;

/** Font sizes a container's header text renders at, derived from its name's font size. */
export interface ContainerHeaderFontSizes {
    /**
     * Whether the sub-label fits at all: once `nameFontSize` alone leaves less than
     * {@link MIN_SUB_LABEL_FONT_SIZE} of room in {@link CONTAINER_HEADER_TEXT_HEIGHT},
     * honouring that floor would push the sub-label into the name instead.
     */
    canFitSubLabel: boolean;
    /** Font size the container's name renders at - `theme.fontSize`, unchanged. */
    nameFontSize: number;
    /** Font size the sub-label renders at, shrunk to share the header with the name. */
    subFontSize: number;
}

/**
 * Derive the container header's two font sizes from the theme's font size.
 *
 * The sub-label shrinks into whatever room is left rather than being dropped: a large
 * custom `theme.fontSize` would otherwise silently lose a Distributed Map's marker,
 * concurrency, tolerance, and batching altogether. The two lines never overlap as long
 * as `subFontSize` stays at or under `CONTAINER_HEADER_TEXT_HEIGHT - nameFontSize` -
 * each line's independent clamp then lands them exactly touching at worst.
 *
 * @param nameFontSize - The container name's font size, i.e. `theme.fontSize`
 * @returns The sub-label's font size and whether it fits at all
 */
export function getContainerHeaderFontSizes(nameFontSize: number): ContainerHeaderFontSizes {
    return {
        canFitSubLabel: CONTAINER_HEADER_TEXT_HEIGHT - nameFontSize >= MIN_SUB_LABEL_FONT_SIZE,
        nameFontSize,
        subFontSize: Math.max(
            MIN_SUB_LABEL_FONT_SIZE,
            Math.min(nameFontSize - 2, CONTAINER_HEADER_TEXT_HEIGHT - nameFontSize)
        ),
    };
}
