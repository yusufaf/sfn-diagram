import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
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

/**
 * Leading bytes of the font formats resvg's fontdb parses: TrueType, OpenType,
 * a TrueType collection, and the two older sfnt tags.
 *
 * `wOFF`/`wOF2` are deliberately absent. fontdb does not decompress WOFF, so a
 * web font is readable, plausible, and useless - exactly the case this check
 * exists to catch.
 */
const FONT_MAGIC = new Set(['\u0000\u0001\u0000\u0000', 'OTTO', 'ttcf', 'true', 'typ1']);

/**
 * Whether a path is a directory.
 *
 * `existsSync` is equally true for a regular file, which resvg cannot search
 * and which must not count as a font source - honouring `loadSystemFonts:
 * false` against one would render every label blank.
 *
 * @param path - Path to a candidate font directory.
 * @returns `true` if it is a directory.
 */
function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Whether a path is a font file this process can read and resvg can parse.
 *
 * Three different things: `existsSync` is true for a directory and for a file
 * with no read permission, and a readable file can still be something fontdb
 * will not parse - a `.woff`, or a truncated `.ttf`. resvg reports none of them;
 * it renders a valid, blank PNG. So this opens the file and reads its magic
 * number rather than trusting the path (#336).
 *
 * @param path - Absolute path to a candidate font file.
 * @returns `true` if it is a readable regular file in a format resvg parses.
 */
function isReadableFile(path: string): boolean {
    let handle: number | undefined;
    try {
        // Open first and stat the descriptor, rather than stat'ing the path and
        // opening it afterwards: checking one thing and then using another is a
        // race, and CodeQL's js/file-system-race is right to call it one.
        handle = openSync(path, 'r');
        if (!fstatSync(handle).isFile()) {
            return false;
        }

        const magic = Buffer.alloc(4);
        if (readSync(handle, magic, 0, 4, 0) < 4) {
            return false;
        }

        return FONT_MAGIC.has(magic.toString('latin1'));
    } catch {
        return false;
    } finally {
        if (handle !== undefined) {
            closeSync(handle);
        }
    }
}

/**
 * The first family named in a CSS font stack, unquoted, or `undefined` if it
 * names none.
 *
 * Every family that reaches here may be a stack - `theme.fontFamily` is one by
 * definition, and a caller passing `fontFamily: 'Inter, sans-serif'` is natural
 * - while resvg's `defaultFontFamily` takes a single family name and does not
 * split a list. Handing it the whole stack matches nothing at all, which looks
 * exactly like the option having no effect.
 *
 * @param stack - A CSS `font-family` value, or nothing.
 * @returns The first family in it, trimmed and unquoted.
 */
function firstFamilyIn(stack?: string): string | undefined {
    const first = stack
        ?.split(',')[0]
        ?.trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();

    return first || undefined;
}

/**
 * Codepoint ranges every font in {@link FONT_PROBES} covers.
 *
 * Deliberately narrow: guessing generously renders tofu, guessing strictly only
 * costs the font scan. General Punctuation is not a range here because Arial
 * has no glyph for 44 codepoints in it, U+2010 HYPHEN among them.
 */
const WIDELY_COVERED_RANGES: [number, number][] = [
    [0x0000, 0x024f],
    [0x0370, 0x03ff],
    [0x0400, 0x04ff],
];

/**
 * Punctuation outside those ranges, measured as covered, and common enough in a
 * state name to be worth the fast path: dashes, curly quotes, bullet, ellipsis.
 */
const WIDELY_COVERED_PUNCTUATION = new Set([
    0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026,
]);

/**
 * Whether text holds a codepoint one probed font is unlikely to cover.
 *
 * The fast path gives up resvg's fallback, so a glyph the resolved face lacks
 * renders as a tofu box with nothing reported - including the U+21BB in this
 * package's own retry-count label, which Arial does not have.
 *
 * @param text - The SVG markup; its own syntax is ASCII, so only text content
 * reaches here.
 * @returns `true` if the system fonts should stay searchable for it.
 */
function needsWiderCoverage(text: string): boolean {
    for (const character of text) {
        const codepoint = character.codePointAt(0) ?? 0;
        const covered =
            WIDELY_COVERED_PUNCTUATION.has(codepoint) ||
            WIDELY_COVERED_RANGES.some(([first, last]) => codepoint >= first && codepoint <= last);
        if (!covered) {
            return true;
        }
    }

    return false;
}

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

/** Parameters for {@link refuseBlank}. */
interface RefuseBlankParams {
    /** The caller's or env var's `loadSystemFonts`, if either set one. */
    forced?: boolean;

    /** Whether any font file or search directory resolved. */
    hasSource: boolean;

    /** The branch's own default, used when nothing forced a value. */
    otherwise: boolean;

    /** Platform being resolved for, named in the error. */
    platform: NodeJS.Platform;

    /** `fontFiles` entries that were rejected, named in the error. */
    rejected?: string[];
}

/**
 * Apply a forced `loadSystemFonts`, unless turning it off would leave resvg
 * with no font at all.
 *
 * resvg renders a valid, entirely blank PNG when it has no loadable font and
 * reports nothing, so an unsatisfiable `false` would reproduce the silent
 * failure #336 is about. Refusing it is noisier than a blank diagram and far
 * easier to act on.
 *
 * @param params - The forced value, whether a font source resolved, the branch
 * default, and the platform.
 * @returns The `loadSystemFonts` value to use.
 * @throws if `false` was forced and no font file or directory resolved.
 */
function refuseBlank(params: RefuseBlankParams): boolean {
    const { forced, hasSource, otherwise, platform, rejected = [] } = params;

    if (forced === false && !hasSource) {
        // The common way to get here is passing fontFiles that all failed the
        // readable-file check, so name them: telling someone to pass the thing
        // they just passed is no help.
        const cause = rejected.length
            ? `could not read any of ${rejected.join(', ')}`
            : `no font resolved on ${platform}`;
        throw new Error(
            `PNG font resolution ${cause} and system fonts are disabled, so no text would render. Pass a readable font file in fontFiles, a fontDirs path, or allow system fonts.`
        );
    }

    return forced ?? otherwise;
}

/** Parameters for {@link resolvePngFontOptions}. */
export interface ResolvePngFontOptionsParams {
    /**
     * Injectable directory check, for testing. `existsSync` is also true for a
     * regular file, which resvg cannot use as a search path and which must not
     * count as a font source either.
     * @default a `statSync` directory check
     */
    dirExists?: (path: string) => boolean;

    /** Directories to search for font files, overriding automatic detection. */
    fontDirs?: string[];

    /** Font family to use, overriding automatic detection. */
    fontFamily?: string;

    /** Explicit font files to load, overriding automatic detection. */
    fontFiles?: string[];

    /**
     * Injectable font-file check, for testing. Decides whether a `fontFiles`
     * entry, or a probe path, counts as a resolved font.
     * @default {@link isReadableFile}, which opens the path and matches its
     * magic number, so a readable `.woff` or `.pfb` is rejected
     */
    isFile?: (path: string) => boolean;

    /**
     * Whether resvg should also parse every installed system font. Defaults to
     * `false` only when a readable font file resolved and no other family has
     * to be matched, `true` otherwise - a directory or a family name does not
     * prove a loadable font.
     */
    loadSystemFonts?: boolean;

    /** Platform to probe for. @default process.platform */
    platform?: NodeJS.Platform;

    /**
     * Font family the SVG itself asks for, as opposed to an override. Unlike
     * {@link ResolvePngFontOptionsParams.fontFamily} it is not a font *source*,
     * so the env vars and the probe table are still consulted; it only names
     * the family, and keeps the system fonts searchable by default because a
     * family cannot be matched out of one font file.
     */
    preferredFamily?: string;

    /**
     * The SVG being rendered. Read only to decide whether one font file can
     * cover its text; a glyph the resolved face lacks renders as tofu with
     * nothing reported, so text outside the ranges every probed font covers
     * keeps the system fonts searchable.
     */
    renderedText?: string;
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
 * `preferredFamily` sits outside that precedence: it names the family on
 * whatever source resolves, rather than being a source itself, and is ignored
 * when `fontFamily` overrides it. One asymmetry follows: an explicit
 * `fontFamily` is matched only within the fonts the caller also supplied, since
 * passing both is a deliberate pairing and second-guessing it would cost the
 * scan on the one path where the caller has named their fonts. Every family is read as a CSS stack and
 * narrowed to its first entry, since resvg matches one name and not a list.
 *
 * `loadSystemFonts` resolves separately: the `loadSystemFonts` param, then
 * `SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS`, then `false` only if a readable font
 * *file* is known, no `preferredFamily` has to be matched, and `renderedText`
 * stays inside the ranges every probed font covers; `true` otherwise. Scanning every installed font costs ~250ms per export and buys
 * nothing once a specific file is known (#336), but nothing short of a readable
 * file proves text can render at all: a directory that exists may hold no font
 * fontdb can parse, and a family name cannot be located without a search path.
 * Each renders a blank PNG with the scan off, so each keeps it on. Forcing it
 * on restores the pre-#336 shape.
 *
 * @param params - Explicit overrides, injectable path checks, and platform.
 * @returns Font options ready to pass to resvg's `Resvg` constructor.
 * @throws if `SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS` is set to a non-boolean value,
 * or if system fonts are disabled with no font file or directory to load.
 *
 * @example
 * ```typescript
 * const font = resolvePngFontOptions({});
 * // { loadSystemFonts: false, sansSerifFamily: 'Liberation Sans', fontFiles: [...] }
 * ```
 */
export function resolvePngFontOptions(params: ResolvePngFontOptionsParams): ResvgFontOptions {
    const { dirExists = isDirectory, isFile = isReadableFile, platform = process.platform } = params;
    const forced = params.loadSystemFonts ?? readLoadSystemFontsEnv();
    const overrideFamily = firstFamilyIn(params.fontFamily);
    // An override replaces the family the SVG asked for, so the preferred one
    // stops mattering - including for whether the scan has to stay on for it.
    const preferredFamily = overrideFamily === undefined ? firstFamilyIn(params.preferredFamily) : undefined;
    const oneFaceIsEnough = !needsWiderCoverage(params.renderedText ?? '');

    // `.length`, not truthiness: `[]` is truthy, and `exportPng({ fontFiles: [] })`
    // taking this branch shadows the env vars and the probe table with no font
    // source at all - which, with the scan forced off, now throws.
    if (params.fontFiles?.length || params.fontDirs?.length || params.fontFamily) {
        // fontDirs are best-effort search paths, so a stale/nonexistent one is
        // silently pruned. fontFiles is a specific, deliberate request - pass it
        // through verbatim, and let `isFile` decide only whether it counts as a
        // resolved font.
        const fontDirs = (params.fontDirs ?? []).filter(dirExists);
        const fontFiles = params.fontFiles ?? [];
        const fontFileResolved = fontFiles.some(isFile);
        const family = overrideFamily ?? preferredFamily;
        return {
            defaultFontFamily: family,
            fontDirs,
            fontFiles: params.fontFiles,
            // A directory can only be known to hold a usable font by walking it,
            // so it is not enough to turn the scan off by itself - but it is a
            // real search path, so it is enough to honour an explicit `false`.
            loadSystemFonts: refuseBlank({
                forced,
                hasSource: fontFileResolved || fontDirs.length > 0,
                otherwise: !fontFileResolved || preferredFamily !== undefined || !oneFaceIsEnough,
                platform,
                rejected: fontFiles,
            }),
            sansSerifFamily: family,
        };
    }

    // Both treat empty as unset. `''.split(delimiter).filter(Boolean)` is an
    // empty array, which is truthy, so a variable that is set but blank would
    // otherwise take this branch and shadow the probe table with no font at all.
    const envFontDirs = process.env.SFN_DIAGRAM_PNG_FONT_DIRS?.split(delimiter).filter(Boolean);
    const envFontFamily = firstFamilyIn(process.env.SFN_DIAGRAM_PNG_FONT_FAMILY);
    if (envFontDirs?.length || envFontFamily) {
        const fontDirs = (envFontDirs ?? []).filter(dirExists);
        const family = envFontFamily ?? preferredFamily;
        return {
            defaultFontFamily: family,
            fontDirs,
            loadSystemFonts: refuseBlank({
                forced,
                hasSource: fontDirs.length > 0,
                otherwise: true,
                platform,
            }),
            sansSerifFamily: family,
        };
    }

    // `isFile`, not `dirExists`: a probe path that exists but is a directory,
    // or is unreadable by this process, loads no glyph and resvg does not say
    // so. Existence alone was enough to strand the default path on one
    // unloadable file with the scan already off.
    const probes = FONT_PROBES[platform] ?? [];
    const match = probes.find((probe) => isFile(probe.path));
    if (!match) {
        return {
            defaultFontFamily: preferredFamily,
            loadSystemFonts: refuseBlank({ forced, hasSource: false, otherwise: true, platform }),
            sansSerifFamily: preferredFamily,
        };
    }

    const family = preferredFamily ?? match.family;
    const loadSystemFonts = refuseBlank({
        forced,
        hasSource: true,
        // One font file cannot satisfy a different family, nor a glyph it has no
        // coverage for, so either keeps the fonts searchable.
        otherwise: preferredFamily !== undefined || !oneFaceIsEnough,
        platform,
    });

    // Scanning: the search-path shape this used to return unconditionally, so
    // the pre-#336 rendering stays reproducible.
    if (loadSystemFonts) {
        return {
            defaultFontFamily: family,
            fontDirs: (FONT_DIRS[platform] ?? []).filter(dirExists),
            loadSystemFonts: true,
            sansSerifFamily: family,
        };
    }

    // Not scanning: hand resvg the one probed file. Only the regular face, so a
    // `font-weight="bold"` run renders at regular weight rather than being
    // synthesized - which no SVG this package generates asks for, but a
    // hand-rolled one passed to PngExporter might.
    return {
        defaultFontFamily: family,
        fontFiles: [match.path],
        loadSystemFonts: false,
        sansSerifFamily: family,
    };
}
