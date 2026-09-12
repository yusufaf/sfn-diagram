import { describe, it, expect } from 'vitest';
import { estimateTextWidth, splitGraphemes } from '../src/utils/textMeasure';

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

    describe('non-ASCII text', () => {
        const NORMAL = 0.55 * FONT_SIZE;
        const FULL = 1 * FONT_SIZE;

        it('measures CJK ideographs, Hangul and Kana as full-width glyphs', () => {
            expect(estimateTextWidth('注文処理', FONT_SIZE)).toBeCloseTo(4 * FULL, 5);
            expect(estimateTextWidth('주문처리', FONT_SIZE)).toBeCloseTo(4 * FULL, 5);
            expect(estimateTextWidth('カタカナ', FONT_SIZE)).toBeCloseTo(4 * FULL, 5);
            expect(estimateTextWidth('ひらがな', FONT_SIZE)).toBeCloseTo(4 * FULL, 5);
        });

        it('measures fullwidth forms as full-width glyphs', () => {
            expect(estimateTextWidth('ＡＢＣ', FONT_SIZE)).toBeCloseTo(3 * FULL, 5);
        });

        it('leaves Latin-range symbols used by built-in labels at normal width', () => {
            for (const symbol of ['↻', '…', '·', '≤', '→']) {
                expect(estimateTextWidth(symbol, FONT_SIZE)).toBe(NORMAL);
            }
        });

        it('counts an astral emoji as one full-width glyph, not two code units', () => {
            expect('🚀'.length).toBe(2);
            expect(estimateTextWidth('🚀', FONT_SIZE)).toBeCloseTo(FULL, 5);
            expect(estimateTextWidth('a🚀b', FONT_SIZE)).toBeCloseTo(2 * NORMAL + FULL, 5);
        });

        it('gives combining marks no width of their own', () => {
            const composed = estimateTextWidth('é', FONT_SIZE);
            const decomposed = estimateTextWidth('e\u0301', FONT_SIZE);
            expect(decomposed).toBe(composed);
            expect(decomposed).toBe(NORMAL);
        });

        it('measures a ZWJ emoji sequence as a single glyph', () => {
            const family = '👨\u200D👩\u200D👧';
            expect(estimateTextWidth(family, FONT_SIZE)).toBeCloseTo(FULL, 5);
        });

        it('gives emoji skin-tone modifiers no width of their own', () => {
            expect(estimateTextWidth('👍🏽', FONT_SIZE)).toBeCloseTo(FULL, 5);
        });

        it('widens a text-presentation symbol to full width under VS16', () => {
            expect(estimateTextWidth('⚠', FONT_SIZE)).toBe(NORMAL);
            expect(estimateTextWidth('⚠\uFE0F', FONT_SIZE)).toBeCloseTo(FULL, 5);
            expect(estimateTextWidth('1\uFE0F\u20E3', FONT_SIZE)).toBeCloseTo(FULL, 5);
        });

        it('measures a regional-indicator flag pair as one full-width glyph', () => {
            expect(estimateTextWidth('🇯🇵', FONT_SIZE)).toBeCloseTo(FULL, 5);
        });

        it('still measures a lone surrogate half without throwing', () => {
            expect(estimateTextWidth('\uD83D', FONT_SIZE)).toBe(NORMAL);
        });

        it('measures mixed ASCII and CJK as the sum of both', () => {
            const ascii = estimateTextWidth('Order', FONT_SIZE);
            const cjk = estimateTextWidth('処理', FONT_SIZE);
            expect(estimateTextWidth('Order処理', FONT_SIZE)).toBeCloseTo(ascii + cjk, 5);
        });
    });
});

describe('splitGraphemes', () => {
    it('splits ASCII into single characters', () => {
        expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
    });

    it('keeps surrogate pairs together', () => {
        expect(splitGraphemes('a🚀b')).toEqual(['a', '🚀', 'b']);
    });

    it('attaches combining marks and variation selectors to their base', () => {
        expect(splitGraphemes('e\u0301x')).toEqual(['e\u0301', 'x']);
        expect(splitGraphemes('⚠\uFE0F!')).toEqual(['⚠\uFE0F', '!']);
    });

    it('keeps a ZWJ sequence, a skin-tone modifier and a flag pair as one cluster each', () => {
        expect(splitGraphemes('👨\u200D👩\u200D👧')).toEqual(['👨\u200D👩\u200D👧']);
        expect(splitGraphemes('👍🏽')).toEqual(['👍🏽']);
        expect(splitGraphemes('🇯🇵🇺🇸')).toEqual(['🇯🇵', '🇺🇸']);
    });

    it('returns an empty list for an empty string', () => {
        expect(splitGraphemes('')).toEqual([]);
    });
});
