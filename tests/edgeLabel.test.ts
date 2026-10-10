import { describe, expect, it } from 'vitest';
import { EDGE_LABEL_MAX_TEXT_WIDTH, measureEdgeLabel } from '../src/layout/edgeLabel';
import { estimateTextWidth } from '../src/utils/textMeasure';

const LABEL_FONT_SIZE = 12;

describe('measureEdgeLabel', () => {
    it('leaves a short label unchanged and pads its box', () => {
        const box = measureEdgeLabel({ label: 'Default', themeFontSize: 14 });

        expect(box.text).toBe('Default');
        expect(box.fontSize).toBe(LABEL_FONT_SIZE);
        expect(box.width).toBeCloseTo(estimateTextWidth('Default', LABEL_FONT_SIZE) + 16);
        expect(box.height).toBe(20);
    });

    it('cuts a label wider than the budget with an ellipsis', () => {
        const label = `{% ${'$states.input.order.total > 1000 and '.repeat(8)}true %}`;
        expect(estimateTextWidth(label, LABEL_FONT_SIZE)).toBeGreaterThan(EDGE_LABEL_MAX_TEXT_WIDTH * 2);

        const box = measureEdgeLabel({ label, themeFontSize: 14 });

        expect(box.text.endsWith('…')).toBe(true);
        expect(label.startsWith(box.text.slice(0, -1))).toBe(true);
        expect(estimateTextWidth(box.text, LABEL_FONT_SIZE)).toBeLessThanOrEqual(
            EDGE_LABEL_MAX_TEXT_WIDTH,
        );
    });

    it('collapses newlines and indentation, which SVG draws as a single space', () => {
        const box = measureEdgeLabel({ label: 'a\n    and b', themeFontSize: 14 });

        expect(box.text).toBe('a and b');
    });

    it('falls back to the bare ellipsis when not even a few glyphs fit', () => {
        const box = measureEdgeLabel({ label: 'Default', themeFontSize: 200 });

        expect(box.text).toBe('…');
    });
});
