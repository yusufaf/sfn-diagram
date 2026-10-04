import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

/** A candidate font family and the absolute file that must exist to use it. */
export interface FontProbe {
    family: string;
    path: string;
}

/**
 * Per-platform font probing tables, checked in order.
 *
 * Exported so `scripts/font-probes.mjs` — which CI uses to assert an image ships
 * the font this will actually look for — can be pinned against it by
 * `tests/ci/fontProbes.test.ts`, rather than a workflow comment claiming to know
 * the path (#230).
 */
export const FONT_PROBES: Partial<Record<NodeJS.Platform, FontProbe[]>> = {
    darwin: [
        { family: 'Helvetica', path: '/System/Library/Fonts/Helvetica.ttc' },
        { family: 'Arial', path: '/Library/Fonts/Arial.ttf' },
    ],
    linux: [
        {
            family: 'Liberation Sans',
            path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        },
        { family: 'DejaVu Sans', path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
        { family: 'Noto Sans', path: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf' },
    ],
    win32: [{ family: 'Arial', path: `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts\\arial.ttf` }],
};

/** Per-platform directories to hand to resvg as font search paths. */
const FONT_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: [
        '/System/Library/Fonts',
        '/Library/Fonts',
        ...(process.env.HOME ? [`${process.env.HOME}/Library/Fonts`] : []),
    ],
    linux: [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        ...(process.env.HOME ? [`${process.env.HOME}/.fonts`, `${process.env.HOME}/.local/share/fonts`] : []),
    ],
    win32: [`${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts`],
};

/** Env var that forces {@link ResvgFontOptions.loadSystemFonts} on or off. */
export const LOAD_SYSTEM_FONTS_ENV_VAR = 'SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS';

const TRUE_VALUES = new Set(['1', 'on', 'true', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * Read {@link LOAD_SYSTEM_FONTS_ENV_VAR} as a boolean.
 *
 * Unset or empty means "no opinion", so the per-branch default applies. An
 * unrecognized value throws rather than being ignored: the override exists to
 * change how fonts resolve, and silently dropping a typo would leave either a
 * slow scan or missing glyphs with nothing to explain it.
 *
 * @returns `true`/`false` when set, or `undefined` when unset or empty.
 * @throws if the variable is set to a value that is not a recognized boolean.
 */
function readLoadSystemFontsEnv(): boolean | undefined {
    const raw = process.env[LOAD_SYSTEM_FONTS_ENV_VAR];
    const normalized = raw?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (TRUE_VALUES.has(normalized)) {
        return true;
    }
    if (FALSE_VALUES.has(normalized)) {
        return false;
    }
    throw new Error(
        `${LOAD_SYSTEM_FONTS_ENV_VAR} must be one of ${[...TRUE_VALUES, ...FALSE_VALUES].sort().join(', ')}, got '${raw}'.`
    );
}

/** Parameters for {@link resolvePngFontOptions}. */
export interface ResolvePngFontOptionsParams {
    /** Injectable file-existence check, for testing. @default fs.existsSync */
    fileExists?: (path: string) => boolean;

    /** Directories to search for font files, overriding automatic detection. */
    fontDirs?: string[];

    /** Font family to use, overriding automatic detection. */
    fontFamily?: string;

    /** Explicit font files to load, overriding automatic detection. */
    fontFiles?: string[];

    /**
     * Whether resvg should also parse every installed system font. Defaults to
     * `false` whenever a concrete font file or directory resolved, `true` when
     * nothing did.
     */
    loadSystemFonts?: boolean;

    /** Platform to probe for. @default process.platform */
    platform?: NodeJS.Platform;
}

/** Font options in the shape resvg's `Resvg` constructor accepts. */
export interface ResvgFontOptions {
    defaultFontFamily?: string;
    fontDirs?: string[];
    fontFiles?: string[];
    loadSystemFonts: boolean;
    sansSerifFamily?: string;
}

/**
 * Resolve font options for the resvg PNG engine.
 *
 * Font source precedence: explicit params, then `SFN_DIAGRAM_PNG_FONT_DIRS` /
 * `SFN_DIAGRAM_PNG_FONT_FAMILY`, then a fixed table of known per-platform font
 * file paths.
 *
 * `loadSystemFonts` resolves separately: the `loadSystemFonts` param, then
 * `SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS`, then `false` only if an existing font
 * *file* is known, and `true` otherwise. Scanning every installed font costs
 * ~250ms per export and buys nothing once a specific file is known (#336), but
 * nothing short of a readable file proves text can render at all: a directory
 * that exists may hold no font fontdb can parse, and a family name cannot be
 * located without a search path. Both render a blank PNG with the scan off, so
 * both keep it on. Forcing it on restores the pre-#336 shape.
 *
 * @param params - Explicit overrides, an injectable `fileExists`, and platform.
 * @returns Font options ready to pass to resvg's `Resvg` constructor.
 * @throws if `SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS` is set to a non-boolean value.
 *
 * @example
 * ```typescript
 * const font = resolvePngFontOptions({});
 * // { loadSystemFonts: false, sansSerifFamily: 'Liberation Sans', fontFiles: [...] }
 * ```
 */
export function resolvePngFontOptions(params: ResolvePngFontOptionsParams): ResvgFontOptions {
    const { fileExists = existsSync, platform = process.platform } = params;
    const forced = params.loadSystemFonts ?? readLoadSystemFontsEnv();

    if (params.fontFiles || params.fontDirs || params.fontFamily) {
        // fontDirs are best-effort search paths, so a stale/nonexistent one is
        // silently pruned. fontFiles is a specific, deliberate request - pass it
        // through verbatim, and let `fileExists` decide only whether it counts
        // as a resolved font.
        return {
            defaultFontFamily: params.fontFamily,
            fontDirs: (params.fontDirs ?? []).filter(fileExists),
            fontFiles: params.fontFiles,
            loadSystemFonts: forced ?? !(params.fontFiles ?? []).some(fileExists),
            sansSerifFamily: params.fontFamily,
        };
    }

    const envFontDirs = process.env.SFN_DIAGRAM_PNG_FONT_DIRS?.split(delimiter).filter(Boolean);
    const envFontFamily = process.env.SFN_DIAGRAM_PNG_FONT_FAMILY;
    if (envFontDirs || envFontFamily) {
        return {
            defaultFontFamily: envFontFamily,
            fontDirs: (envFontDirs ?? []).filter(fileExists),
            loadSystemFonts: forced ?? true,
            sansSerifFamily: envFontFamily,
        };
    }

    const probes = FONT_PROBES[platform] ?? [];
    const match = probes.find((probe) => fileExists(probe.path));
    if (!match) {
        return { loadSystemFonts: forced ?? true };
    }

    // Forced back on: return the search-path shape this used to return
    // unconditionally, so the pre-#336 rendering is reproducible exactly.
    if (forced) {
        return {
            defaultFontFamily: match.family,
            fontDirs: (FONT_DIRS[platform] ?? []).filter(fileExists),
            loadSystemFonts: true,
            sansSerifFamily: match.family,
        };
    }

    // The probe matched an exact file, so hand resvg just that file. Only the
    // regular face: a `font-weight="bold"` run renders at regular weight rather
    // than being synthesized, which no SVG this package generates asks for but
    // a hand-rolled one passed to PngExporter might.
    return {
        defaultFontFamily: match.family,
        fontFiles: [match.path],
        loadSystemFonts: false,
        sansSerifFamily: match.family,
    };
}
