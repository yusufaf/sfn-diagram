/**
 * Per-character text width estimation for proportional fonts.
 *
 * Tuned for Arial / Helvetica / system sans-serif — the default font
 * family used by both built-in themes. Characters are bucketed into
 * width classes based on measured glyph advance widths in Arial.
 * Unknown characters fall through to the NORMAL class (0.55).
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

/**
 * Estimate the rendered width of a string using per-character width classes.
 * More accurate than a flat per-character average because it accounts for the
 * significant width variance between narrow (i, l) and wide (M, W) glyphs
 * in proportional fonts.
 *
 * @param text - The string to measure
 * @param fontSize - Font size in pixels
 * @returns Estimated width in pixels
 */
export function estimateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        width += (CHAR_WIDTHS[text[i]] ?? NORMAL) * fontSize;
    }
    return width;
}
