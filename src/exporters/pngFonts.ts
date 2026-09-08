import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

/** A candidate font family and the absolute file that must exist to use it. */
interface FontProbe {
    family: string;
    path: string;
}

/** Per-platform font probing tables, checked in order. */
const FONT_PROBES: Partial<Record<NodeJS.Platform, FontProbe[]>> = {
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
 * Precedence: explicit params, then `SFN_DIAGRAM_PNG_FONT_DIRS` /
 * `SFN_DIAGRAM_PNG_FONT_FAMILY` env vars, then a fixed table of known
 * per-platform font file paths. `loadSystemFonts` always stays `true` so
 * resvg's own fallback still gets a chance even when nothing above resolves.
 *
 * @param params - Explicit overrides, an injectable `fileExists`, and platform.
 * @returns Font options ready to pass to resvg's `Resvg` constructor.
 *
 * @example
 * ```typescript
 * const font = resolvePngFontOptions({});
 * // { loadSystemFonts: true, sansSerifFamily: 'Liberation Sans', fontDirs: [...] }
 * ```
 */
export function resolvePngFontOptions(params: ResolvePngFontOptionsParams): ResvgFontOptions {
    const { fileExists = existsSync, platform = process.platform } = params;

    if (params.fontFiles || params.fontDirs || params.fontFamily) {
        return {
            defaultFontFamily: params.fontFamily,
            fontDirs: (params.fontDirs ?? []).filter(fileExists),
            fontFiles: params.fontFiles,
            loadSystemFonts: true,
            sansSerifFamily: params.fontFamily,
        };
    }

    const envFontDirs = process.env.SFN_DIAGRAM_PNG_FONT_DIRS?.split(delimiter).filter(Boolean);
    const envFontFamily = process.env.SFN_DIAGRAM_PNG_FONT_FAMILY;
    if (envFontDirs || envFontFamily) {
        return {
            defaultFontFamily: envFontFamily,
            fontDirs: (envFontDirs ?? []).filter(fileExists),
            loadSystemFonts: true,
            sansSerifFamily: envFontFamily,
        };
    }

    const probes = FONT_PROBES[platform] ?? [];
    const match = probes.find((probe) => fileExists(probe.path));
    if (!match) {
        return { loadSystemFonts: true };
    }

    return {
        defaultFontFamily: match.family,
        fontDirs: (FONT_DIRS[platform] ?? []).filter(fileExists),
        loadSystemFonts: true,
        sansSerifFamily: match.family,
    };
}
