import { describe, it, expect } from 'vitest';
import {
    estimateTextWidth,
    getTextWidthCacheSize,
    TEXT_WIDTH_CACHE_LIMIT,
} from '../src/utils/textMeasure';

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

    describe('memoization', () => {
        it('returns the identical width on repeated calls', () => {
            const first = estimateTextWidth('ValidateOrder', FONT_SIZE);
            for (let call = 0; call < 5; call++) {
                expect(estimateTextWidth('ValidateOrder', FONT_SIZE)).toBe(first);
            }
        });

        it('keeps widths for the same text at different font sizes apart', () => {
            expect(estimateTextWidth('Hello', 12)).not.toBe(estimateTextWidth('Hello', 14));
            expect(estimateTextWidth('Hello', 12)).toBe(estimateTextWidth('Hello', 12));
        });

        it('caches a measured width and serves it on the next call', () => {
            const text = `unique-${Date.now()}`;
            const before = getTextWidthCacheSize();

            estimateTextWidth(text, FONT_SIZE);
            estimateTextWidth(text, FONT_SIZE);

            expect(getTextWidthCacheSize()).toBe(before + 1);
        });

        it('never grows past its limit', () => {
            for (let index = 0; index <= TEXT_WIDTH_CACHE_LIMIT * 2; index++) {
                estimateTextWidth(`label-${index}`, FONT_SIZE);
            }

            expect(getTextWidthCacheSize()).toBeLessThanOrEqual(TEXT_WIDTH_CACHE_LIMIT);
            expect(getTextWidthCacheSize()).toBeGreaterThan(0);
        });

        it('still measures correctly after the cache has been cleared', () => {
            const expected = estimateTextWidth('AfterReset', FONT_SIZE);
            for (let index = 0; index <= TEXT_WIDTH_CACHE_LIMIT; index++) {
                estimateTextWidth(`flush-${index}`, FONT_SIZE);
            }

            expect(estimateTextWidth('AfterReset', FONT_SIZE)).toBe(expected);
        });
    });
});
