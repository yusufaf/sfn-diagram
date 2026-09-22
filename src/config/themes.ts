import type { CustomTheme, ResolvedTheme, StateType } from '../types';

/**
 * AWS Light Theme - matches the AWS Step Functions console light mode
 */
export const AWS_LIGHT_THEME: ResolvedTheme = {
    background: '#ffffff',
    nodeColors: {
        Pass: { fill: '#e1f5fe', stroke: '#0277bd' },
        Task: { fill: '#fff3e0', stroke: '#d84315' },
        Choice: { fill: '#f3e5f5', stroke: '#7b1fa2' },
        Wait: { fill: '#e8f5e8', stroke: '#388e3c' },
        Succeed: { fill: '#e8f5e8', stroke: '#2e7d32' },
        Fail: { fill: '#ffebee', stroke: '#c62828' },
        Parallel: { fill: '#fce4ec', stroke: '#c2185b' },
        Map: { fill: '#f1f8e9', stroke: '#558b2f' },
    },
    edgeColors: {
        choice: '#7b1fa2',
        default: '#9c27b0',
        error: '#c62828',
        normal: '#546e7a',
        retry: '#8f6200',
    },
    textColor: '#212121',
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
};

/**
 * AWS Dark Theme - matches the AWS Step Functions console dark mode
 */
export const AWS_DARK_THEME: ResolvedTheme = {
    background: '#1e1e1e',
    nodeColors: {
        Pass: { fill: '#01579b', stroke: '#4fc3f7' },
        Task: { fill: '#9c3400', stroke: '#ffb74d' },
        Choice: { fill: '#4a148c', stroke: '#ce93d8' },
        Wait: { fill: '#1b5e20', stroke: '#81c784' },
        Succeed: { fill: '#14532d', stroke: '#a5d6a7' },
        Fail: { fill: '#b71c1c', stroke: '#ffb4ab' },
        Parallel: { fill: '#880e4f', stroke: '#f48fb1' },
        Map: { fill: '#33691e', stroke: '#aed581' },
    },
    edgeColors: {
        choice: '#ce93d8',
        default: '#ba68c8',
        error: '#ef5350',
        normal: '#90a4ae',
        retry: '#ffca28',
    },
    textColor: '#e0e0e0',
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
};

/** Per-state-type colour overrides, merged one channel at a time. */
type NodeColorOverrides = Partial<Record<StateType, Partial<{ fill: string; stroke: string }>>>;

/**
 * Merge node colour overrides per channel rather than per state type: an entry that
 * names only a fill would otherwise drop the theme's stroke for that type, leaving
 * the node half-themed.
 */
function mergeNodeColors(
    base: ResolvedTheme['nodeColors'],
    overrides: NodeColorOverrides | undefined,
): ResolvedTheme['nodeColors'] {
    if (!overrides) return base;
    const nodeColors = { ...base };
    for (const [stateType, colors] of Object.entries(overrides)) {
        const key = stateType as StateType;
        nodeColors[key] = { ...nodeColors[key], ...withoutUndefined(colors) };
    }
    return nodeColors;
}

/** Copy of `value` with every `undefined` entry dropped, so a spread cannot blank a base field. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
}

/**
 * Resolve a theme option to a fully specified theme.
 *
 * `'light'` / `'dark'` (or nothing) return the matching built-in theme. A
 * {@link CustomTheme} is merged onto the built-in theme named by its `base`
 * (`'light'` unless set): top-level fields replace, `edgeColors` merges per edge
 * kind, and `nodeColors` merges per state type and channel — so `{ fontSize: 18 }`
 * or `{ nodeColors: { Task: { fill: '#eee' } } }` are complete themes. A
 * fully specified theme resolves to itself, byte for byte.
 *
 * @param theme - Theme name or custom theme; `'light'` when omitted
 * @param customColors - The `customColors` diagram option, applied on top of the theme
 * @returns The resolved theme every field of which is present
 *
 * @example
 * ```typescript
 * getTheme({ base: 'dark', fontSize: 18 }).background; // '#1e1e1e'
 * getTheme({ nodeColors: { Task: { fill: '#eee' } } }).nodeColors.Task.stroke; // '#d84315'
 * ```
 */
export function getTheme(
    theme?: 'light' | 'dark' | CustomTheme,
    customColors?: NodeColorOverrides
): ResolvedTheme {
    let resolved: ResolvedTheme;

    if (!theme || theme === 'light') {
        resolved = AWS_LIGHT_THEME;
    } else if (theme === 'dark') {
        resolved = AWS_DARK_THEME;
    } else {
        const base = theme.base === 'dark' ? AWS_DARK_THEME : AWS_LIGHT_THEME;
        const { background, edgeColors, fontFamily, fontSize, nodeColors, textColor } = theme;
        resolved = {
            ...base,
            ...withoutUndefined({ background, fontFamily, fontSize, textColor }),
            edgeColors: { ...base.edgeColors, ...(edgeColors ? withoutUndefined(edgeColors) : {}) },
            nodeColors: mergeNodeColors(base.nodeColors, nodeColors),
        };
    }

    if (customColors) {
        return { ...resolved, nodeColors: mergeNodeColors(resolved.nodeColors, customColors) };
    }

    return resolved;
}
