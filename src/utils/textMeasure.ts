/**
 * Per-character text width estimation for proportional fonts.
 *
 * Tuned for Arial / Helvetica / system sans-serif — the default font
 * family used by both built-in themes. Characters are bucketed into
 * width classes based on measured glyph advance widths in Arial.
 * Unknown characters fall through to the NORMAL class (0.55).
 *
 * Text is walked by grapheme cluster rather than UTF-16 code unit, so an
 * astral emoji counts once, combining marks and joiners add nothing, and
 * CJK / Hangul / Kana ideographs get their full em width. ASCII widths are
 * unaffected: every ASCII character is its own cluster and looks up the
 * same table it always has.
 */

/** Narrow glyphs: i, l, 1, punctuation */
const NARROW = 0.3;
/** Medium-narrow glyphs: f, j, t, r, brackets */
const MEDIUM_NARROW = 0.4;
/** Most lowercase letters and digits */
const NORMAL = 0.55;
/** Most uppercase letters */
const WIDE = 0.65;
/** Extra-wide glyphs: M, W, m, w, @ */
const EXTRA_WIDE = 0.78;
/** Space character */
const SPACE = 0.28;
/** Full-width glyphs: CJK ideographs, Hangul, Kana, fullwidth forms, emoji */
const FULL = 1;

/** Lookup table: character → width multiplier relative to fontSize. */
const CHAR_WIDTHS: Record<string, number> = {};

for (const ch of 'iIl1|!.:;,\'"') CHAR_WIDTHS[ch] = NARROW;
for (const ch of 'fjtr()[]{}/-') CHAR_WIDTHS[ch] = MEDIUM_NARROW;
for (const ch of 'mwMW@%') CHAR_WIDTHS[ch] = EXTRA_WIDE;
for (let code = 65; code <= 90; code++) {
    const ch = String.fromCharCode(code);
    if (!(ch in CHAR_WIDTHS)) CHAR_WIDTHS[ch] = WIDE;
}
CHAR_WIDTHS[' '] = SPACE;

const ZERO_WIDTH_JOINER = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;
const REGIONAL_INDICATOR_FIRST = 0x1f1e6;
const REGIONAL_INDICATOR_LAST = 0x1f1ff;

/**
 * Inclusive code point ranges that render with no advance of their own:
 * combining marks (including the Indic vowel signs and viramas that attach to
 * a consonant), joiners, variation selectors, emoji modifiers and tags.
 * Sorted ascending — {@link inRanges} relies on it.
 */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x0300, 0x036f],
    [0x0483, 0x0489],
    [0x0591, 0x05bd],
    [0x05bf, 0x05bf],
    [0x05c1, 0x05c2],
    [0x05c4, 0x05c5],
    [0x05c7, 0x05c7],
    [0x0610, 0x061a],
    [0x064b, 0x065f],
    [0x0670, 0x0670],
    [0x06d6, 0x06dc],
    [0x06df, 0x06e4],
    [0x06e7, 0x06e8],
    [0x06ea, 0x06ed],
    [0x0900, 0x0903],
    [0x093a, 0x093c],
    [0x093e, 0x094f],
    [0x0951, 0x0957],
    [0x0962, 0x0963],
    [0x0981, 0x0983],
    [0x09bc, 0x09bc],
    [0x09be, 0x09c4],
    [0x09c7, 0x09c8],
    [0x09cb, 0x09cd],
    [0x09d7, 0x09d7],
    [0x09e2, 0x09e3],
    [0x09fe, 0x09fe],
    [0x0a01, 0x0a03],
    [0x0a3c, 0x0a3c],
    [0x0a3e, 0x0a42],
    [0x0a47, 0x0a48],
    [0x0a4b, 0x0a4d],
    [0x0a51, 0x0a51],
    [0x0a70, 0x0a71],
    [0x0a75, 0x0a75],
    [0x0a81, 0x0a83],
    [0x0abc, 0x0abc],
    [0x0abe, 0x0ac5],
    [0x0ac7, 0x0ac9],
    [0x0acb, 0x0acd],
    [0x0ae2, 0x0ae3],
    [0x0afa, 0x0aff],
    [0x0b01, 0x0b03],
    [0x0b3c, 0x0b3c],
    [0x0b3e, 0x0b44],
    [0x0b47, 0x0b48],
    [0x0b4b, 0x0b4d],
    [0x0b55, 0x0b57],
    [0x0b62, 0x0b63],
    [0x0b82, 0x0b82],
    [0x0bbe, 0x0bc2],
    [0x0bc6, 0x0bc8],
    [0x0bca, 0x0bcd],
    [0x0bd7, 0x0bd7],
    [0x0c00, 0x0c04],
    [0x0c3c, 0x0c3c],
    [0x0c3e, 0x0c44],
    [0x0c46, 0x0c48],
    [0x0c4a, 0x0c4d],
    [0x0c55, 0x0c56],
    [0x0c62, 0x0c63],
    [0x0c81, 0x0c83],
    [0x0cbc, 0x0cbc],
    [0x0cbe, 0x0cc4],
    [0x0cc6, 0x0cc8],
    [0x0cca, 0x0ccd],
    [0x0cd5, 0x0cd6],
    [0x0ce2, 0x0ce3],
    [0x0cf3, 0x0cf3],
    [0x0d00, 0x0d03],
    [0x0d3b, 0x0d3c],
    [0x0d3e, 0x0d44],
    [0x0d46, 0x0d48],
    [0x0d4a, 0x0d4d],
    [0x0d57, 0x0d57],
    [0x0d62, 0x0d63],
    [0x0d81, 0x0d83],
    [0x0dca, 0x0dca],
    [0x0dcf, 0x0dd4],
    [0x0dd6, 0x0dd6],
    [0x0dd8, 0x0ddf],
    [0x0df2, 0x0df3],
    [0x0e31, 0x0e31],
    [0x0e34, 0x0e3a],
    [0x0e47, 0x0e4e],
    [0x0eb1, 0x0eb1],
    [0x0eb4, 0x0ebc],
    [0x0ec8, 0x0ece],
    [0x0f18, 0x0f19],
    [0x0f35, 0x0f35],
    [0x0f37, 0x0f37],
    [0x0f39, 0x0f39],
    [0x0f3e, 0x0f3f],
    [0x0f71, 0x0f84],
    [0x0f86, 0x0f87],
    [0x0f8d, 0x0f97],
    [0x0f99, 0x0fbc],
    [0x0fc6, 0x0fc6],
    [0x1ab0, 0x1aff],
    [0x1dc0, 0x1dff],
    [0x200b, 0x200f],
    [0x20d0, 0x20ff],
    [0x302a, 0x302f],
    [0x3099, 0x309a],
    [0xfe00, 0xfe0f],
    [0xfe20, 0xfe2f],
    [0x1f3fb, 0x1f3ff],
    [0xe0020, 0xe007f],
    [0xe0100, 0xe01ef],
];

/**
 * Inclusive code point ranges of emoji-presentation symbols. Sorted ascending.
 * These draw a full em and are the only bases a ZWJ can join a sequence onto.
 */
const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x231a, 0x231b],
    [0x2329, 0x232a],
    [0x23e9, 0x23ec],
    [0x23f0, 0x23f0],
    [0x23f3, 0x23f3],
    [0x25fd, 0x25fe],
    [0x2614, 0x2615],
    [0x2648, 0x2653],
    [0x267f, 0x267f],
    [0x2693, 0x2693],
    [0x26a1, 0x26a1],
    [0x26aa, 0x26ab],
    [0x26bd, 0x26be],
    [0x26c4, 0x26c5],
    [0x26ce, 0x26ce],
    [0x26d4, 0x26d4],
    [0x26ea, 0x26ea],
    [0x26f2, 0x26f3],
    [0x26f5, 0x26f5],
    [0x26fa, 0x26fa],
    [0x26fd, 0x26fd],
    [0x2705, 0x2705],
    [0x270a, 0x270b],
    [0x2728, 0x2728],
    [0x274c, 0x274c],
    [0x274e, 0x274e],
    [0x2753, 0x2755],
    [0x2757, 0x2757],
    [0x2795, 0x2797],
    [0x27b0, 0x27b0],
    [0x27bf, 0x27bf],
    [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50],
    [0x2b55, 0x2b55],
    [0x1f004, 0x1f004],
    [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [REGIONAL_INDICATOR_FIRST, REGIONAL_INDICATOR_LAST],
    [0x1f200, 0x1f251],
    [0x1f300, 0x1f64f],
    [0x1f680, 0x1f6ff],
    [0x1f7e0, 0x1f7eb],
    [0x1f90c, 0x1f9ff],
    [0x1fa70, 0x1faff],
];

/**
 * Inclusive code point ranges of East Asian Wide and Fullwidth characters —
 * CJK ideographs, Hangul, Kana, fullwidth forms. Sorted ascending.
 */
const EAST_ASIAN_WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x115f],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xa960, 0xa97f],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe30, 0xfe4f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x20000, 0x3fffd],
];

function inRanges(codePoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
    for (const [first, last] of ranges) {
        if (codePoint < first) return false;
        if (codePoint <= last) return true;
    }
    return false;
}

function isZeroWidth(codePoint: number): boolean {
    return inRanges(codePoint, ZERO_WIDTH_RANGES);
}

function isRegionalIndicator(codePoint: number): boolean {
    return codePoint >= REGIONAL_INDICATOR_FIRST && codePoint <= REGIONAL_INDICATOR_LAST;
}

function isEmojiPresentation(codePoint: number): boolean {
    return inRanges(codePoint, EMOJI_RANGES);
}

/** Width multiplier for a single code point, given as the string it came from. */
function codePointWidth(char: string, codePoint: number): number {
    const tabulated = CHAR_WIDTHS[char];
    if (tabulated !== undefined) return tabulated;
    if (codePoint < 0x80) return NORMAL;
    if (isZeroWidth(codePoint)) return 0;
    if (isEmojiPresentation(codePoint) || inRanges(codePoint, EAST_ASIAN_WIDE_RANGES)) {
        return FULL;
    }
    return NORMAL;
}

/**
 * Split a string into the clusters that render as one glyph.
 *
 * This is a deliberately small approximation of Unicode grapheme segmentation
 * that needs no `Intl.Segmenter` and so runs in every runtime the core targets.
 * A code point joins the cluster before it when it is a combining mark,
 * variation selector, joiner or emoji modifier; when it follows a ZWJ inside
 * an emoji cluster; or when it completes a regional-indicator flag pair.
 * Everything else — including every ASCII character — starts its own cluster.
 * A ZWJ after a non-emoji base (Indic and Arabic use it as a shaping hint)
 * attaches to that base but does not pull the next letter in, so the letter
 * keeps its own width.
 *
 * @param text - The string to split
 * @returns The clusters in order; concatenating them reproduces `text`
 *
 * @example
 * ```typescript
 * splitGraphemes('a🚀b');            // ['a', '🚀', 'b']
 * splitGraphemes('👨‍👩‍👧'); // ['👨‍👩‍👧']
 * splitGraphemes('🇯🇵🇺🇸');            // ['🇯🇵', '🇺🇸']
 * ```
 */
export function splitGraphemes(text: string): string[] {
    const clusters: string[] = [];
    let current = '';
    let previousCodePoint = -1;
    let openRegionalIndicator = false;
    let emojiCluster = false;

    for (const char of text) {
        const codePoint = char.codePointAt(0) ?? 0;
        const regionalIndicator = isRegionalIndicator(codePoint);
        const joinsPrevious =
            current !== '' &&
            (isZeroWidth(codePoint) ||
                (previousCodePoint === ZERO_WIDTH_JOINER && emojiCluster) ||
                (regionalIndicator && openRegionalIndicator));

        if (joinsPrevious) {
            current += char;
            openRegionalIndicator = false;
            if (codePoint === VARIATION_SELECTOR_16) emojiCluster = true;
        } else {
            if (current !== '') clusters.push(current);
            current = char;
            openRegionalIndicator = regionalIndicator;
            emojiCluster = isEmojiPresentation(codePoint);
        }
        previousCodePoint = codePoint;
    }

    if (current !== '') clusters.push(current);
    return clusters;
}

/**
 * Width multiplier for one grapheme cluster. The base code point sets the
 * width; a VS16 anywhere in the cluster promotes a text-presentation symbol
 * to a full-width emoji glyph, and a flag pair counts once rather than twice.
 */
function graphemeWidth(cluster: string): number {
    const baseCodePoint = cluster.codePointAt(0) ?? 0;
    const base = String.fromCodePoint(baseCodePoint);
    let width = codePointWidth(base, baseCodePoint);

    if (cluster.length === base.length) return width;

    for (const char of cluster.slice(base.length)) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (codePoint === VARIATION_SELECTOR_16 && width < FULL) {
            width = FULL;
        }
    }
    return width;
}

/**
 * Estimate the rendered width of a string using per-character width classes.
 * More accurate than a flat per-character average because it accounts for the
 * significant width variance between narrow (i, l) and wide (M, W) glyphs
 * in proportional fonts.
 *
 * Measurement is per grapheme cluster (see {@link splitGraphemes}), so emoji,
 * combining sequences and CJK text are sized by the glyphs they draw rather
 * than by UTF-16 code units.
 *
 * @param text - The string to measure
 * @param fontSize - Font size in pixels
 * @returns Estimated width in pixels
 */
export function estimateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (const cluster of splitGraphemes(text)) {
        width += graphemeWidth(cluster) * fontSize;
    }
    return width;
}
