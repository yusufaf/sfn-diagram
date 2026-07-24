import { describe, it, expect } from 'vitest';
import { estimateTextWidth } from '../src/utils/textMeasure';

describe('estimateTextWidth', () => {
    const FONT_SIZE = 14;

    it('should return 0 for empty string', () => {
        expect(estimateTextWidth('', FONT_SIZE)).toBe(0);
    });

    it('should measure narrow chars narrower than wide chars', () => {
        const narrow = estimateTextWidth('iii', FONT_SIZE);
        const wide = estimateTextWidth('WWW', FONT_SIZE);
        expect(wide).toBeGreaterThan(narrow * 2);
    });

    it('should measure spaces narrower than letters', () => {
        const spaces = estimateTextWidth('   ', FONT_SIZE);
        const letters = estimateTextWidth('aaa', FONT_SIZE);
        expect(spaces).toBeLessThan(letters);
    });

    it('should handle typical PascalCase state names', () => {
        const width = estimateTextWidth('ValidateOrder', FONT_SIZE);
        const allNarrow = estimateTextWidth('iiiiiiiiiiiii', FONT_SIZE);
        const allWide = estimateTextWidth('MMMMMMMMMMMMM', FONT_SIZE);
        expect(width).toBeGreaterThan(allNarrow);
        expect(width).toBeLessThan(allWide);
    });

    it('should scale linearly with font size', () => {
        const w12 = estimateTextWidth('Hello', 12);
        const w24 = estimateTextWidth('Hello', 24);
        expect(w24).toBeCloseTo(w12 * 2, 5);
    });

    it('should handle edge label text with operators', () => {
        const width = estimateTextWidth('$.inStock == true', FONT_SIZE);
        expect(width).toBeGreaterThan(0);
        // Should be less than if all characters were extra-wide
        expect(width).toBeLessThan(17 * FONT_SIZE);
    });

    it('should treat digits as normal width', () => {
        const digitWidth = estimateTextWidth('0', FONT_SIZE);
        const letterWidth = estimateTextWidth('a', FONT_SIZE);
        // Both should be NORMAL class (0.55)
        expect(digitWidth).toBe(letterWidth);
    });

    it('should differentiate uppercase from lowercase', () => {
        const upper = estimateTextWidth('ABC', FONT_SIZE);
        const lower = estimateTextWidth('abc', FONT_SIZE);
        // Uppercase (WIDE=0.65) should be wider than lowercase (NORMAL=0.55)
        expect(upper).toBeGreaterThan(lower);
    });
});
