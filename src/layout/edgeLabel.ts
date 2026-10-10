import { fitText } from '../constants/labels';
import { estimateTextWidth } from '../utils/textMeasure';

/** Widest text, in px at the label font size, an edge label is drawn at before it is cut. */
export const EDGE_LABEL_MAX_TEXT_WIDTH = 240;

/** Edge labels are drawn this much smaller than the theme's base font. */
const EDGE_LABEL_FONT_SIZE_OFFSET = 2;
const EDGE_LABEL_PADDING_X = 8;
const EDGE_LABEL_PADDING_Y = 4;
const EDGE_LABEL_TRUNCATED_MARKER = '…';

/** What the renderer draws for an edge label, and the box layout must reserve for it. */
export interface EdgeLabelBox {
    /** Font size the label text is drawn at */
    fontSize: number;
    /** Height of the label's background box, padding included */
    height: number;
    /** The text to draw: whitespace collapsed and cut with `…` if over budget */
    text: string;
    /** Width of the label's background box, padding included */
    width: number;
}

/** Parameters for {@link measureEdgeLabel}. */
export interface MeasureEdgeLabelParams {
    /** The full edge label, e.g. a Choice rule's condition */
    label: string;
    /** The theme's base font size (`theme.fontSize`) */
    themeFontSize: number;
}

/**
 * Work out the text and box size an edge label is drawn with.
 *
 * Choice conditions can be arbitrarily long and span several lines, so the label is
 * collapsed onto one line (SVG draws a newline as a space) and cut at
 * {@link EDGE_LABEL_MAX_TEXT_WIDTH}. Layout and the renderer both call this, so the
 * space dagre reserves for a label is the space the renderer draws it in.
 *
 * @param params.label - The full edge label
 * @param params.themeFontSize - The theme's base font size
 * @returns The text to draw and the size of its background box
 *
 * @example
 * ```typescript
 * const box = measureEdgeLabel({ label: '$x > 1\n  and $y', themeFontSize: 14 });
 * // box.text === '$x > 1 and $y'
 * ```
 */
export function measureEdgeLabel(params: MeasureEdgeLabelParams): EdgeLabelBox {
    const { label, themeFontSize } = params;
    const fontSize = themeFontSize - EDGE_LABEL_FONT_SIZE_OFFSET;
    const collapsed = label.replace(/\s+/g, ' ').trim();
    const fitted = fitText({
        availableWidth: EDGE_LABEL_MAX_TEXT_WIDTH,
        measure: (candidate) => estimateTextWidth(candidate, fontSize),
        text: collapsed,
    });
    const text = fitted === '' && collapsed !== '' ? EDGE_LABEL_TRUNCATED_MARKER : fitted;

    return {
        fontSize,
        height: fontSize + EDGE_LABEL_PADDING_Y * 2,
        text,
        width: estimateTextWidth(text, fontSize) + EDGE_LABEL_PADDING_X * 2,
    };
}
