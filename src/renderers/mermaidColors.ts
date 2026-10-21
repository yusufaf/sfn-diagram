import type { NodeColorOverrides } from '../config/themes';
import type { StateType } from '../types';

/**
 * Characters no CSS colour uses that would break a `classDef` line: `;`, `{` and `}`
 * (statement and directive syntax), C0/C1 controls (which include `\n` and `\r`, the
 * only things that end a Mermaid statement), and the Unicode line/paragraph
 * separators. The same set the CLI rejects at its config boundary.
 */
const MERMAID_COLOR_FORBIDDEN = /[;{}\p{Cc}\p{Zl}\p{Zp}]/u;

/** A legacy comma-separated `rgb()`/`rgba()`/`hsl()`/`hsla()` call. */
const LEGACY_COLOR_FUNCTION = /\b(rgba?|hsla?)\(([^()]*)\)/giu;

// Exhaustive by construction, like autoTheme.ts's copy. Not shared with it: that module
// is in the viewer's relayout bundle, and moving the list re-minifies the whole bundle.
const STATE_TYPE_KEYS: Record<StateType, true> = {
    Choice: true,
    Fail: true,
    Map: true,
    Parallel: true,
    Pass: true,
    Succeed: true,
    Task: true,
    Wait: true,
};
const STATE_TYPES = Object.keys(STATE_TYPE_KEYS) as StateType[];
const COLOR_CHANNELS = ['fill', 'stroke'] as const;

interface RewriteLegacyColorCommasParams {
    value: string;
}

export interface ToMermaidColorParams {
    value: unknown;
}

export interface SanitizeMermaidNodeColorsParams {
    colors: NodeColorOverrides | undefined;
    /** Field path the notice names, e.g. `'customColors'` or `'theme.nodeColors'`. */
    source: string;
}

export interface SanitizedMermaidNodeColors {
    /** The overrides Mermaid can draw; a dropped channel is left out so the layer beneath shows. */
    colors: NodeColorOverrides | undefined;
    /** Field paths of the dropped values, e.g. `customColors.Task.fill`. */
    dropped: string[];
}

/**
 * Rewrite legacy comma syntax (`rgb(255, 153, 0)`, `rgba(255, 153, 0, 0.5)`) as the
 * equivalent space-separated form (`rgb(255 153 0)`, `rgba(255 153 0 / 0.5)`). A call
 * that isn't three or four plain arguments is left as it is.
 */
function rewriteLegacyColorCommas(params: RewriteLegacyColorCommasParams): string {
    return params.value.replace(LEGACY_COLOR_FUNCTION, (match, name: string, args: string) => {
        const parts = args.split(',').map((part) => part.trim());
        const isPlain = parts.every((part) => part !== '' && !/[\s/]/u.test(part));
        if (!isPlain || parts.length < 3 || parts.length > 4) return match;
        const [first, second, third, alpha] = parts;
        return `${name}(${first} ${second} ${third}${alpha === undefined ? '' : ` / ${alpha}`})`;
    });
}

/**
 * Make a colour safe to write as one property of a Mermaid `classDef` line.
 *
 * Mermaid's lexer ends a statement at a line break, and it splits a style list on
 * every comma with no escape and no regard for parentheses, so `rgb(255, 153, 0)`
 * becomes three properties. Legacy `rgb`/`rgba`/`hsl`/`hsla` commas are rewritten to
 * the space-separated form; any other comma, and any character from
 * {@link MERMAID_COLOR_FORBIDDEN}, makes the value undrawable.
 *
 * @param params.value - The colour as given; non-strings are undrawable
 * @returns The value to write, or `undefined` when Mermaid can't draw it
 *
 * @example
 * ```typescript
 * toMermaidColor({ value: 'rgb(255, 153, 0)' }); // 'rgb(255 153 0)'
 * toMermaidColor({ value: 'red\nA --> B' }); // undefined
 * ```
 */
export function toMermaidColor(params: ToMermaidColorParams): string | undefined {
    const { value } = params;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    if (MERMAID_COLOR_FORBIDDEN.test(value)) return undefined;
    const rewritten = rewriteLegacyColorCommas({ value });
    return rewritten.includes(',') ? undefined : rewritten;
}

/**
 * Keep only the node colours Mermaid can draw from one layer of overrides
 * (`customColors` or a custom theme's `nodeColors`), so the theme beneath shows
 * through wherever a value is dropped.
 *
 * Only `fill` and `stroke` of the known state types are read, so a notice is never
 * built from caller-supplied keys. A missing or `undefined` channel, or a state type
 * whose entry isn't an object, is "not set" rather than dropped, as `getTheme` treats it.
 *
 * @param params.colors - One layer of overrides; returned as given when absent
 * @param params.source - Field path the dropped entries are named under
 * @returns The drawable overrides and the field path of each dropped value
 *
 * @example
 * ```typescript
 * sanitizeMermaidNodeColors({ colors: { Task: { fill: 'a,b' } }, source: 'customColors' });
 * // { colors: { Task: {} }, dropped: ['customColors.Task.fill'] }
 * ```
 */
export function sanitizeMermaidNodeColors(
    params: SanitizeMermaidNodeColorsParams,
): SanitizedMermaidNodeColors {
    const { colors, source } = params;
    if (!colors) return { colors, dropped: [] };
    const sanitized: NodeColorOverrides = {};
    const dropped: string[] = [];
    for (const stateType of STATE_TYPES) {
        const entry: unknown = colors[stateType];
        if (typeof entry !== 'object' || entry === null) continue;
        const kept: Partial<{ fill: string; stroke: string }> = {};
        for (const channel of COLOR_CHANNELS) {
            const value: unknown = (entry as Record<string, unknown>)[channel];
            if (value === undefined) continue;
            const color = toMermaidColor({ value });
            if (color === undefined) {
                dropped.push(`${source}.${stateType}.${channel}`);
            } else {
                kept[channel] = color;
            }
        }
        sanitized[stateType] = kept;
    }
    return { colors: sanitized, dropped };
}
