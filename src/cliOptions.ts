import type { CliConfig } from './cliConfig';
import type {
    CatchHandling,
    CatchLabelStyle,
    CustomTheme,
    DiagramFormat,
    EdgePathStyle,
    LayoutDirection,
    StylePreset,
} from './types';

/**
 * The absence-preserving view of the command line that {@link resolveCliOptions} reads.
 *
 * Declared here rather than imported from `./cli` so the merge has no dependency on the
 * CLI surface and can be tested without it. `src/cli.ts`'s `CliArgs` is a structural
 * superset: it adds the non-option fields (`input`, `output`, `check`, `diff`, …) that
 * the merge has no opinion about.
 *
 * Every field is `null` when its flag was not given, which is what lets the merge tell
 * "absent" from "explicitly set to the value that happens to be the default".
 */
export interface CliOptionSource {
    backgroundColor: string | null;
    catchHandling: CatchHandling | null;
    catchLabelStyle: CatchLabelStyle | null;
    collapse: string[] | boolean | null;
    diagramDescription: string | null;
    diagramTitle: string | null;
    edgeStyle: EdgePathStyle | null;
    format: DiagramFormat | null;
    iconPosition: 'left' | 'right' | 'top' | null;
    iconSize: number | null;
    includeComments: boolean | null;
    layout: LayoutDirection | null;
    nodeHeight: number | null;
    nodeSeparation: number | null;
    nodeWidth: number | null;
    padding: number | null;
    rankSeparation: number | null;
    showIcons: boolean | null;
    showStateTypes: boolean | null;
    showVariables: boolean | null;
    stylePreset: StylePreset | null;
    theme: CustomTheme | 'dark' | 'light' | null;
}

/**
 * The effective options for one invocation, after flags, config and defaults.
 *
 * The four fields the CLI has always had a default for are non-nullable; every other
 * field stays `null` when nothing set it, so `run()` can keep using conditional spreads
 * and let the library apply its own documented default rather than restating it here.
 */
export interface ResolvedCliOptions {
    backgroundColor: string | null;
    catchHandling: CatchHandling;
    catchLabelStyle: CatchLabelStyle | null;
    collapse: string[] | boolean | null;
    diagramDescription: string | null;
    diagramTitle: string | null;
    edgeStyle: EdgePathStyle | null;
    format: DiagramFormat;
    iconPosition: 'left' | 'right' | 'top' | null;
    iconSize: number | null;
    includeComments: boolean | null;
    layout: LayoutDirection;
    nodeHeight: number | null;
    nodeSeparation: number | null;
    nodeWidth: number | null;
    padding: number | null;
    rankSeparation: number | null;
    showIcons: boolean | null;
    showStateTypes: boolean | null;
    showVariables: boolean | null;
    stylePreset: StylePreset | null;
    theme: CustomTheme | 'dark' | 'light';
}

/** Parameters for {@link resolveCliOptions}. */
export interface ResolveCliOptionsParams {
    /** The command line, with `null` for every option not given. */
    args: CliOptionSource;
    /** The loaded config file, or `null` when there is none. */
    config: CliConfig | null;
}

/**
 * First of `flag`, then `configured`, then `fallback`.
 *
 * `null` and `undefined` are the only absent values, so a `false` or a `0` from either
 * side is kept — the reason this is a function rather than a chain of `||`.
 */
function pick<Value>(
    flag: Value | null,
    configured: Value | undefined,
    fallback: Value,
): Value {
    if (flag !== null) return flag;
    if (configured !== undefined) return configured;
    return fallback;
}

/** As {@link pick}, but with no default: the option stays unset. */
function pickOptional<Value>(
    flag: Value | null,
    configured: Value | undefined,
): Value | null {
    if (flag !== null) return flag;
    if (configured !== undefined) return configured;
    return null;
}

/**
 * Merge an invocation's flags over its config file over the built-in defaults.
 *
 * An explicit flag always wins, including when its value equals the default — which is
 * why `parseArgs` reports an absent option as `null` rather than substituting a default
 * of its own.
 *
 * @param params - Merge parameters
 * @param params.args - The command line, with `null` for every option not given
 * @param params.config - The loaded config file, or `null`
 *
 * @returns The effective options for this invocation.
 *
 * @example
 * ```typescript
 * resolveCliOptions({
 *     args: { ...noFlags, layout: 'BT' },
 *     config: { layout: 'LR', padding: 40 },
 * }); // { layout: 'BT', padding: 40, format: 'svg', theme: 'light', ... }
 * ```
 */
export function resolveCliOptions(
    params: ResolveCliOptionsParams,
): ResolvedCliOptions {
    const { args, config } = params;
    const settings: CliConfig = config ?? {};

    return {
        backgroundColor: pickOptional(
            args.backgroundColor,
            settings.backgroundColor,
        ),
        catchHandling: pick(args.catchHandling, settings.catchHandling, 'show'),
        catchLabelStyle: pickOptional(
            args.catchLabelStyle,
            settings.catchLabelStyle,
        ),
        collapse: pickOptional(args.collapse, settings.collapse),
        diagramDescription: pickOptional(
            args.diagramDescription,
            settings.diagramDescription,
        ),
        diagramTitle: pickOptional(args.diagramTitle, settings.diagramTitle),
        edgeStyle: pickOptional(args.edgeStyle, settings.edgeStyle),
        format: pick(args.format, settings.format, 'svg'),
        iconPosition: pickOptional(args.iconPosition, settings.iconPosition),
        iconSize: pickOptional(args.iconSize, settings.iconSize),
        includeComments: pickOptional(
            args.includeComments,
            settings.includeComments,
        ),
        layout: pick(args.layout, settings.layout, 'TB'),
        nodeHeight: pickOptional(args.nodeHeight, settings.nodeHeight),
        nodeSeparation: pickOptional(
            args.nodeSeparation,
            settings.nodeSeparation,
        ),
        nodeWidth: pickOptional(args.nodeWidth, settings.nodeWidth),
        padding: pickOptional(args.padding, settings.padding),
        rankSeparation: pickOptional(
            args.rankSeparation,
            settings.rankSeparation,
        ),
        showIcons: pickOptional(args.showIcons, settings.showIcons),
        showStateTypes: pickOptional(
            args.showStateTypes,
            settings.showStateTypes,
        ),
        showVariables: pickOptional(args.showVariables, settings.showVariables),
        stylePreset: pickOptional(args.stylePreset, settings.stylePreset),
        theme: pick(args.theme, settings.theme, 'light'),
    };
}
