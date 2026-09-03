import type { DiagramOptions } from '../types';

/**
 * Default diagram options - used when options not provided
 */
export const DEFAULT_DIAGRAM_OPTIONS: Required<
    Omit<
        DiagramOptions,
        | 'width'
        | 'height'
        | 'collapse'
        | 'customColors'
        | 'iconResolver'
        | 'nodeOverrides'
        | 'edgeOverrides'
        | 'nodeAnnotations'
    >
> & {
    width: number | undefined;
    height: number | undefined;
    collapse: DiagramOptions['collapse'];
    customColors: DiagramOptions['customColors'];
    iconResolver: DiagramOptions['iconResolver'];
    nodeOverrides: DiagramOptions['nodeOverrides'];
    edgeOverrides: DiagramOptions['edgeOverrides'];
    nodeAnnotations: DiagramOptions['nodeAnnotations'];
} = {
    // Output format
    format: 'svg',

    // Theming
    theme: 'light',
    customColors: undefined,

    // Layout
    layout: 'TB',
    rankSeparation: 50,
    nodeSeparation: 50,

    // Dimensions (auto-calculate if not provided)
    width: undefined,
    height: undefined,
    nodeWidth: 120,
    nodeHeight: 60,
    padding: 20,

    // Content options
    includeComments: true,
    showStateTypes: false,
    showVariables: true,
    edgeStyle: 'curved',
    catchHandling: 'show',
    catchLabelStyle: 'error-type',
    collapse: undefined,
    stylePreset: 'aws-standard',

    // Icon options
    iconPosition: 'left' as const,
    iconResolver: undefined,
    iconSize: 24,
    showIcons: false,

    // PNG-specific
    pngQuality: 90,
    backgroundColor: 'transparent',

    // Diff / execution overlay style overrides
    nodeOverrides: undefined,
    edgeOverrides: undefined,
    nodeAnnotations: undefined,
};

/**
 * Merge user-provided options with defaults
 */
export function mergeOptions(options: DiagramOptions = {}): typeof DEFAULT_DIAGRAM_OPTIONS {
    return {
        ...DEFAULT_DIAGRAM_OPTIONS,
        ...options,
    };
}

/**
 * Merge two record-valued option maps per key, with `override` winning on any key
 * present in both. Unlike a plain object spread of the maps themselves, an `undefined`
 * side is treated as "no entries" rather than wiping the other side's keys.
 *
 * @param base - The map to merge into, e.g. a previously-computed set of overrides
 * @param override - The map whose keys take precedence over `base`'s
 * @returns The merged map, or `undefined` when both inputs are `undefined`
 *
 * @example
 * ```typescript
 * mergeRecordOptions({ A: 1, C: 3 }, { A: 10, B: 2 }); // { A: 10, B: 2, C: 3 }
 * ```
 */
export function mergeRecordOptions<Key extends string, Value>(
    base: Record<Key, Value> | undefined,
    override: Record<Key, Value> | undefined
): Record<Key, Value> | undefined;
export function mergeRecordOptions<Key extends string, Value>(
    base: Record<Key, Value>,
    override: Partial<Record<Key, Value>> | undefined
): Record<Key, Value>;
export function mergeRecordOptions<Key extends string, Value>(
    base: Partial<Record<Key, Value>> | undefined,
    override: Partial<Record<Key, Value>> | undefined
): Partial<Record<Key, Value>> | undefined;
export function mergeRecordOptions<Key extends string, Value>(
    base: Partial<Record<Key, Value>> | undefined,
    override: Partial<Record<Key, Value>> | undefined
): Partial<Record<Key, Value>> | undefined {
    if (!base && !override) return undefined;
    return { ...base, ...override };
}

/**
 * Merge two sets of diagram options, combining the four record-valued options
 * (`customColors`, `edgeOverrides`, `nodeAnnotations`, `nodeOverrides`) per key instead
 * of letting `override` replace each map wholesale. Every other option is a plain
 * override, same as a shallow spread.
 *
 * @param base - The options to merge into, e.g. a generator's current options
 * @param override - The options whose values (and per-key record entries) take precedence
 * @returns The merged options
 *
 * @example
 * ```typescript
 * mergeDiagramOptions({ nodeOverrides: { A: styleA } }, { nodeOverrides: { B: styleB } });
 * // { nodeOverrides: { A: styleA, B: styleB } }
 * ```
 */
export function mergeDiagramOptions(base: DiagramOptions, override: DiagramOptions): DiagramOptions {
    return {
        ...base,
        ...override,
        customColors: mergeRecordOptions(base.customColors, override.customColors),
        edgeOverrides: mergeRecordOptions(base.edgeOverrides, override.edgeOverrides),
        nodeAnnotations: mergeRecordOptions(base.nodeAnnotations, override.nodeAnnotations),
        nodeOverrides: mergeRecordOptions(base.nodeOverrides, override.nodeOverrides),
    };
}
