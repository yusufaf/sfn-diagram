import { describe, expect, it } from 'vitest';
import { fitText, getWaitDurationLabel } from '../src/constants/labels';
import { estimateTextWidth } from '../src/utils/textMeasure';

const isWellFormed = (text: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe('elide (via getWaitDurationLabel)', () => {
    it('leaves a short expression untouched', () => {
        expect(getWaitDurationLabel({ Type: 'Wait', SecondsPath: '$.delay' })).toBe('$.delay');
    });

    it('does not split a surrogate pair at the cut point', () => {
        // 30 ASCII characters put the cut point inside the emoji that follows.
        const seconds = `${'a'.repeat(30)}🚀${'b'.repeat(10)}`;

        const label = getWaitDurationLabel({ Type: 'Wait', SecondsPath: seconds });

        expect(label.endsWith('…')).toBe(true);
        expect(isWellFormed(label)).toBe(true);
        expect(label).toBe(`${'a'.repeat(30)}🚀…`);
    });

    it('counts length in code points, not UTF-16 units', () => {
        // 20 emoji are 40 code units but only 20 glyphs, well under the limit.
        const seconds = '🚀'.repeat(20);

        expect(getWaitDurationLabel({ Type: 'Wait', SecondsPath: seconds })).toBe(seconds);
    });

    it('never cuts between a Devanagari consonant and its vowel sign', () => {
        // Each syllable is a consonant plus a vowel sign; the cut lands on one of them.
        const syllable = '\u0915\u0940';
        const seconds = syllable.repeat(40);

        const label = getWaitDurationLabel({ Type: 'Wait', SecondsPath: seconds });

        expect(label).toBe(`${syllable.repeat(31)}…`);
    });

    it('keeps a combining mark with its base when cutting', () => {
        const seconds = `${'a'.repeat(30)}e\u0301${'b'.repeat(10)}`;

        const label = getWaitDurationLabel({ Type: 'Wait', SecondsPath: seconds });

        expect(label.endsWith('e\u0301…')).toBe(true);
    });
});

describe('fitText', () => {
    const FONT_SIZE = 14;
    const measure = (text: string): number => estimateTextWidth(text, FONT_SIZE);

    it('returns the text untouched when it fits', () => {
        expect(fitText({ availableWidth: 1000, measure, text: 'Order処理' })).toBe('Order処理');
    });

    it('never emits a lone surrogate half', () => {
        const text = 'Wait🚀🚀🚀🚀🚀🚀🚀🚀';
        const fullWidth = measure(text);

        for (let availableWidth = fullWidth; availableWidth >= 0; availableWidth -= 1) {
            const fitted = fitText({ availableWidth, measure, text });
            expect(isWellFormed(fitted)).toBe(true);
            expect(measure(fitted) <= availableWidth || fitted === '').toBe(true);
        }
    });

    it('cuts CJK text by glyph and marks the cut', () => {
        const text = '注文処理を開始します';
        const fitted = fitText({ availableWidth: 5 * FONT_SIZE, measure, text });

        expect(fitted).toBe('注文処理…');
    });

    it('keeps a ZWJ emoji sequence whole rather than cutting inside it', () => {
        const family = '👨\u200D👩\u200D👧';
        const text = `abcd${family}efgh`;
        const cutInsideFamily = measure(`abcd👨\u200D👩…`);

        const fitted = fitText({ availableWidth: cutInsideFamily, measure, text });

        expect(fitted).toBe(`abcd${family}…`);
    });
});
