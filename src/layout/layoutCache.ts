import { getTheme } from '../config/themes';
import type { DiagramOptions, GraphEdge, StateNode } from '../types';
import type { LayoutResult } from './DagreLayout';

/**
 * The option fields {@link DagreLayout} actually reads, in a fixed order so the key
 * is stable. Kept as an explicit list rather than spreading the whole options object:
 * most of `DiagramOptions` only affects painting (colours, titles, Mermaid output),
 * and including those would miss every cache hit the cache exists to produce — a
 * theme toggle being the main one.
 *
 * Adding a `this.options.<field>` read to DagreLayout without adding it here produces
 * a stale layout, which nothing else detects. `layoutCache.test.ts` guards this list
 * with one test per field, plus an enumeration test that fails when DagreLayout reads
 * an option absent from it.
 */
const LAYOUT_OPTION_KEYS = [
    'collapseControls',
    'height',
    'iconPosition',
    'layout',
    'nodeAnnotations',
    'nodeHeight',
    'nodeSeparation',
    'nodeWidth',
    'padding',
    'rankSeparation',
    'showIcons',
    'showStateTypes',
    'showVariables',
    'width',
] as const satisfies ReadonlyArray<keyof DiagramOptions>;

/** Parameters for {@link createLayoutCache}. */
export interface CreateLayoutCacheParams {
    /**
     * Most recently used entries to retain. Each entry holds the positioned nodes and
     * edges of one graph, so this bounds memory rather than just entry count.
     * @default 32
     */
    maxEntries?: number;
}

/** Hit/miss counters, for benchmarks and for asserting a cache was actually used. */
export interface LayoutCacheStats {
    /** Entries currently retained. */
    entries: number;
    /** Lookups that returned a cached layout. */
    hits: number;
    /** Lookups that had to run the layout. */
    misses: number;
}

/**
 * An opt-in, caller-owned memo of dagre layout results.
 *
 * Created with {@link createLayoutCache} and passed to a render function. The core is
 * stateless without one, so omitting it preserves existing behaviour exactly.
 */
export interface LayoutCache {
    /** Drop every entry. A long-lived host should call this when a document closes. */
    clear(): void;
    /** The cached layout for `key`, or `undefined`. Refreshes the entry's recency. */
    get(key: string): LayoutResult | undefined;
    /** Build the cache key for a graph and the options it will be laid out with. */
    keyFor(params: LayoutCacheKeyForParams): string;
    /** Store `value` under `key`, evicting the least recently used entry if full. */
    set(key: string, value: LayoutResult): void;
    /** Current counters. */
    stats(): LayoutCacheStats;
}

/** Parameters for {@link LayoutCache.keyFor}. */
export interface LayoutCacheKeyForParams {
    /** The edges that will be passed to the layout, after any collapse was applied. */
    edges: GraphEdge[];
    /** The nodes that will be passed to the layout, after any collapse was applied. */
    nodes: StateNode[];
    /** The options the layout will be constructed with. */
    options: DiagramOptions;
}

/**
 * Deterministic JSON for an arbitrary value, with object keys sorted.
 *
 * Plain `JSON.stringify` depends on key insertion order, which differs between a
 * parsed node and one rebuilt by a spread in the collapse styling path — so two
 * structurally identical graphs would key differently and never hit.
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, fieldValue]) => fieldValue !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([name, fieldValue]) => `${JSON.stringify(name)}:${stableStringify(fieldValue)}`).join(',')}}`;
}

/**
 * Reduce one node to the parts that can move the layout.
 *
 * Deliberately conservative: everything on the node is kept except the two things
 * that provably cannot change geometry, so a future DagreLayout that starts reading
 * another node field is already covered.
 *
 * - `style` collapses to its `shape`. That is the only style field the layout reads
 *   (`DagreLayout.ts:192` and `:627`); the rest is colour, which is theme-derived, so
 *   keeping it would miss on every light/dark toggle.
 * - `x`/`y` are dropped. They are layout *outputs*, and a node carrying coordinates
 *   from a previous pass would otherwise key differently from the same node before it.
 */
function layoutRelevantNode(node: StateNode): Record<string, unknown> {
    const relevant: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(node)) {
        if (field === 'style' || field === 'x' || field === 'y') {
            continue;
        }
        relevant[field] = value;
    }
    if (node.style?.shape !== undefined) {
        relevant.shape = node.style.shape;
    }
    return relevant;
}

/**
 * Reduce one edge to the parts that can move the layout.
 *
 * Drops `points` and `loopIndex` for the same reason {@link layoutRelevantNode} drops
 * `x`/`y`: {@link LayoutResult} adds them to its edges, so an edge handed back in from
 * a previous layout would otherwise key differently from the identical edge before it.
 */
function layoutRelevantEdge(edge: GraphEdge): Record<string, unknown> {
    const relevant: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(edge)) {
        if (field === 'loopIndex' || field === 'points') {
            continue;
        }
        relevant[field] = value;
    }
    return relevant;
}

/**
 * Create an opt-in layout cache.
 *
 * Pass the result to a render function to memoise dagre layout across calls that do
 * not change geometry — a theme change, an icon toggle, or an execution overlay being
 * painted onto an unchanged definition. On a large definition the layout dominates
 * render cost, so a hit turns a re-render into little more than SVG serialisation.
 *
 * The cache is caller-owned and bounded. Nothing is cached unless a cache is passed,
 * which keeps the core stateless by default: no global state to make tests
 * order-dependent, and no unbounded growth in a long-lived host such as the VS Code
 * extension, which should `clear()` when a document closes.
 *
 * @param params - Optional `maxEntries` bound
 * @returns A cache to hand to a render function
 *
 * @example
 * ```typescript
 * import { createLayoutCache, generateViewerUpdate } from 'sfn-diagram';
 *
 * const cache = createLayoutCache();
 * // Second call reuses the layout: only the theme changed.
 * generateViewerUpdate({ aslDefinition, cache, theme: 'light' });
 * generateViewerUpdate({ aslDefinition, cache, theme: 'dark' });
 * cache.stats(); // { entries: 1, hits: 1, misses: 1 }
 * ```
 *
 * @remarks
 * Keys are the serialised graph and options, not a digest. A 32-bit digest would make
 * a collision return someone else's layout — a silently wrong diagram, the one failure
 * mode no test announces — and an exact key removes that class of bug for a cost
 * bounded by `maxEntries`.
 */
export function createLayoutCache(params: CreateLayoutCacheParams = {}): LayoutCache {
    const { maxEntries = 32 } = params;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new Error(`createLayoutCache: maxEntries must be a positive integer, received ${String(maxEntries)}`);
    }

    const entries = new Map<string, LayoutResult>();
    let hits = 0;
    let misses = 0;

    return {
        clear() {
            entries.clear();
        },

        get(key) {
            const cached = entries.get(key);
            if (cached === undefined) {
                misses += 1;
                return undefined;
            }
            // Delete then re-set: a Map iterates in insertion order, so this moves the
            // entry to the end and makes the first key the least recently used one.
            entries.delete(key);
            entries.set(key, cached);
            hits += 1;
            return cached;
        },

        keyFor(keyParams) {
            const { edges, nodes, options } = keyParams;
            // Resolved, not raw: the layout reads exactly one theme field, so two themes
            // agreeing on it should share a layout. `theme`/`customColors` themselves are
            // deliberately absent from the key.
            const { fontSize } = getTheme(options.theme, options.customColors);
            const layoutOptions: Record<string, unknown> = { fontSize };
            for (const optionKey of LAYOUT_OPTION_KEYS) {
                layoutOptions[optionKey] = options[optionKey];
            }
            return stableStringify({
                edges: edges.map(layoutRelevantEdge),
                nodes: nodes.map(layoutRelevantNode),
                options: layoutOptions,
            });
        },

        set(key, value) {
            if (entries.has(key)) {
                entries.delete(key);
            }
            entries.set(key, value);
            if (entries.size > maxEntries) {
                const leastRecentlyUsed = entries.keys().next().value;
                if (leastRecentlyUsed !== undefined) {
                    entries.delete(leastRecentlyUsed);
                }
            }
        },

        stats() {
            return { entries: entries.size, hits, misses };
        },
    };
}

/** The option fields the cache key covers, exported so a test can assert the list is complete. */
export const LAYOUT_CACHE_OPTION_KEYS: ReadonlyArray<keyof DiagramOptions> = LAYOUT_OPTION_KEYS;
