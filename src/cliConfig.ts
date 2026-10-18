import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
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
 * Filenames the CLI looks for, in the order they win a tie within one directory.
 *
 * `.sfn-diagramrc` has no extension and is parsed as YAML, which accepts JSON too
 * (YAML 1.2 is a JSON superset), so one parser covers every name here.
 */
export const CONFIG_FILENAMES: readonly string[] = [
    'sfn-diagram.config.json',
    'sfn-diagram.config.yaml',
    'sfn-diagram.config.yml',
    '.sfn-diagramrc',
    '.sfn-diagramrc.json',
    '.sfn-diagramrc.yaml',
    '.sfn-diagramrc.yml',
];

/**
 * A config file that could not be found, parsed, or validated.
 *
 * Carries no exit code: a bad file is a runtime failure (exit 1) under the CLI's
 * exit-code convention, never a usage error, so there is nothing per-instance to
 * choose. `run()` maps it to `EXIT_FAILURE`.
 */
export class CliConfigError extends Error {}

/** Parameters for {@link discoverConfigPath}. */
export interface DiscoverConfigPathParams {
    /** Directory to start from; the search walks up from here. */
    startDir: string;
    /**
     * Directory that ends the walk in addition to a repository root, defaulting to the
     * user's home directory. Passing it explicitly is what makes the bound testable:
     * a test cannot put a file in the real home directory.
     */
    stopAtDir?: string | null;
}

/**
 * The directory the walk stops at when no repository root is found: the user's home.
 *
 * `homedir()` throws on a platform with no notion of one, in which case the walk is
 * bounded only by the filesystem root, as it was before this bound existed.
 */
function defaultStopDirectory(): string | null {
    try {
        return resolve(homedir());
    } catch {
        return null;
    }
}

/**
 * Whether `path` exists and is a regular file.
 *
 * "Not there" is the ordinary answer and means keep looking. Anything else — a
 * permission error, an I/O error, a symlink loop — is reported, because a config file
 * that exists and cannot be read is the kind of thing a person needs told about: left
 * silent, the run proceeds on defaults and nothing says why.
 *
 * @throws {CliConfigError} When `path` cannot be inspected for a reason other than
 *   absence.
 */
function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        const reason = error instanceof Error ? error.message : String(error);
        throw new CliConfigError(`Cannot read config file ${path}: ${reason}`);
    }
}

/** Whether `path` exists at all, as a file or a directory. */
function exists(path: string): boolean {
    try {
        statSync(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the nearest config file at or above `startDir`.
 *
 * Walks up one directory at a time, checking {@link CONFIG_FILENAMES} in order within
 * each, and stops after the first directory that contains a `.git` entry, or that is the
 * user's home directory. A config belongs to a project, and without a bound the search
 * would climb to the filesystem root and pick up an unrelated file — `~/sfn-diagram.config.json`
 * from a scratch directory, or `/sfn-diagram.config.json` inside a container whose
 * mounted tree has no `.git`. `.git` is checked as an entry of any kind, since a
 * worktree's `.git` is a file rather than a directory.
 *
 * The walk starts at the working directory rather than at the input file's directory,
 * so `sfn-diagram sub/dir/machine.asl.json` does not pick up
 * `sub/dir/sfn-diagram.config.json`. That keeps one invocation's configuration
 * independent of which input it happens to name.
 *
 * @param params - Search parameters
 * @param params.startDir - Directory to start from
 * @param params.stopAtDir - Directory that ends the walk besides a repository root;
 *   defaults to the user's home directory, and `null` removes the bound
 *
 * @returns The absolute path of the nearest config file, or `null` if there is none.
 *
 * @throws {CliConfigError} When a candidate path exists but cannot be inspected.
 *
 * @example
 * ```typescript
 * discoverConfigPath({ startDir: process.cwd() }); // '/repo/sfn-diagram.config.json'
 * ```
 */
export function discoverConfigPath(
    params: DiscoverConfigPathParams,
): string | null {
    const { startDir, stopAtDir } = params;
    let directory = resolve(startDir);
    const stopAt = stopAtDir === undefined ? defaultStopDirectory() : stopAtDir;

    for (;;) {
        for (const filename of CONFIG_FILENAMES) {
            const candidate = join(directory, filename);
            if (isFile(candidate)) return candidate;
        }
        // A repository root ends the search, after its own files have been checked.
        // So does the home directory: outside a repository there is nothing else to
        // stop the walk before the filesystem root.
        if (exists(join(directory, '.git'))) return null;
        if (stopAt !== null && directory === stopAt) return null;

        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

/**
 * A validated config file.
 *
 * Every field is optional and named for the `DiagramOptions` field it supplies, not for
 * the flag that overrides it, so a reader of the file and a reader of the library API
 * see the same vocabulary: `catchHandling` rather than `hideCatch`, `includeComments`
 * rather than `hideComments`.
 *
 * Only data-valued options appear. `iconResolver`, `redact`, `customColors`,
 * `nodeOverrides`, `edgeOverrides` and `nodeAnnotations` are callbacks or record maps
 * with no textual form the CLI can accept, and stay API-only; `redactFields` and
 * `includeRawState` cover the common cases of `redact`.
 *
 * A `commentGitlab` block in the same file is not part of this type: it belongs to
 * `sfn-diagram comment gitlab` ({@link CommentGitlabConfig}), and the main CLI ignores it.
 */
export interface CliConfig {
    backgroundColor?: string;
    catchHandling?: CatchHandling;
    catchLabelStyle?: CatchLabelStyle;
    collapse?: string[] | boolean;
    diagramDescription?: string;
    diagramTitle?: string;
    edgeStyle?: EdgePathStyle;
    format?: DiagramFormat;
    iconPosition?: 'left' | 'right' | 'top';
    iconSize?: number;
    includeComments?: boolean;
    /** HTML only: `false` inlines no state's raw ASL. Other formats ignore it. */
    includeRawState?: boolean;
    layout?: LayoutDirection;
    /** PNG only: also parse every installed font. Other formats ignore it. */
    loadSystemFonts?: boolean;
    nodeHeight?: number;
    nodeSeparation?: number;
    nodeWidth?: number;
    padding?: number;
    rankSeparation?: number;
    /** HTML only: ASL field names to redact. Other formats ignore it. */
    redactFields?: string[];
    /** PNG only: resolution multiplier, at most {@link MAX_PNG_SCALE}. Other formats ignore it. */
    scale?: number;
    showIcons?: boolean;
    showStateTypes?: boolean;
    showVariables?: boolean;
    stylePreset?: StylePreset;
    theme?: CustomTheme | 'dark' | 'light';
}

/** Parameters for {@link loadCliConfig}. */
export interface LoadCliConfigParams {
    /** Path from `--config`, or `null` to search for one. */
    explicitPath: string | null;
    /** Directory the search starts from when `explicitPath` is `null`. */
    startDir: string;
}

/** Enum-valued config fields and the values each accepts. */
const ENUM_FIELDS = {
    catchHandling: ['hide', 'show'],
    catchLabelStyle: ['catch-number', 'error-type'],
    edgeStyle: ['curved', 'orthogonal', 'straight'],
    format: ['html', 'mermaid', 'png', 'svg'],
    iconPosition: ['left', 'right', 'top'],
    layout: ['BT', 'LR', 'RL', 'TB'],
    stylePreset: ['aws-standard', 'enhanced'],
} as const satisfies Record<string, readonly string[]>;

/** Free-text config fields, which must be non-empty as the matching flags require. */
const STRING_FIELDS = [
    'backgroundColor',
    'diagramDescription',
    'diagramTitle',
] as const;

/** Boolean config fields. */
const BOOLEAN_FIELDS = [
    'includeComments',
    'includeRawState',
    'loadSystemFonts',
    'showIcons',
    'showStateTypes',
    'showVariables',
] as const;

/**
 * Pixel-valued config fields, and whether zero is acceptable for each.
 *
 * The same split the flags use: a dimension has to be positive to draw anything, while
 * a separation or a padding of zero is a meaningful request.
 */
const PIXEL_FIELDS = {
    iconSize: { allowZero: false },
    nodeHeight: { allowZero: false },
    nodeSeparation: { allowZero: true },
    nodeWidth: { allowZero: false },
    padding: { allowZero: true },
    rankSeparation: { allowZero: true },
} as const satisfies Record<string, { allowZero: boolean }>;

/**
 * The largest PNG `scale` the CLI accepts, from the flag or the config file.
 *
 * resvg aborts the whole process, with no catchable error, when it cannot allocate the
 * target pixmap: `scale: 1000` on a three-state diagram asks for 200 GB. The cap catches
 * the likeliest way to get there, a DPI value typed as a scale (`--scale 300`), while 10x
 * still covers retina (2-3x) and 300 dpi print (about 3.1x).
 */
export const MAX_PNG_SCALE = 10;

/**
 * Whether a value is a PNG scale the CLI accepts: a finite number above 0 and at most
 * {@link MAX_PNG_SCALE}. Shared by `--scale` and the config file so the bound cannot drift.
 *
 * @param value - The parsed flag or config value
 *
 * @returns `true` when the value can be passed to `exportPng` as `scale`.
 *
 * @example
 * isValidPngScale(2); // true
 * isValidPngScale(300); // false: above the cap
 * isValidPngScale(Number.NaN); // false
 */
export function isValidPngScale(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= MAX_PNG_SCALE
    );
}

/**
 * The fields a {@link CustomTheme} accepts.
 *
 * Used only to reject an object that names none of them: `{ backgroundColor: '#111' }`
 * for `background` would otherwise be accepted and render as the plain light theme, with
 * nothing said. Individual field types are left to the renderer, which already tolerates
 * whatever it is given.
 */
const CUSTOM_THEME_FIELDS: readonly string[] = [
    'background',
    'base',
    'edgeColors',
    'fontFamily',
    'fontSize',
    'nodeColors',
    'textColor',
];

/** Parameters for {@link validateConfig}. */
interface ValidateConfigParams {
    /** Prepended to a field's name in errors, such as `commentGitlab.` for a nested block. */
    fieldPrefix?: string;
    /** The file the object came from, named in every error. */
    path: string;
    /** The parsed object to validate. */
    raw: Record<string, unknown>;
}

/**
 * Validate one parsed config object, dropping keys the CLI does not know.
 *
 * @param params - Validation parameters
 * @param params.fieldPrefix - Prepended to a field's name in errors
 * @param params.path - The file the object came from, named in every error
 * @param params.raw - The parsed object to validate
 *
 * @returns The validated config.
 *
 * @throws {CliConfigError} When a known field has the wrong type or an out-of-range
 *   value.
 */
function validateConfig(params: ValidateConfigParams): CliConfig {
    const { fieldPrefix = '', path, raw } = params;
    const config: Record<string, unknown> = {};
    const reject = (field: string, expected: string): never => {
        throw new CliConfigError(
            `Invalid ${fieldPrefix}${field} in ${path}: expected ${expected}`,
        );
    };

    for (const [field, allowed] of Object.entries(ENUM_FIELDS)) {
        const value = raw[field];
        if (value === undefined) continue;
        if (
            typeof value !== 'string' ||
            !(allowed as readonly string[]).includes(value)
        ) {
            reject(field, `one of: ${allowed.join(', ')}`);
        }
        config[field] = value;
    }

    for (const field of STRING_FIELDS) {
        const value = raw[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.trim() === '') {
            reject(field, 'a non-empty string');
        }
        config[field] = value;
    }

    for (const field of BOOLEAN_FIELDS) {
        const value = raw[field];
        if (value === undefined) continue;
        if (typeof value !== 'boolean') reject(field, 'true or false');
        config[field] = value;
    }

    for (const [field, { allowZero }] of Object.entries(PIXEL_FIELDS)) {
        const value = raw[field];
        if (value === undefined) continue;
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            (!allowZero && value <= 0)
        ) {
            reject(
                field,
                `a ${allowZero ? 'non-negative' : 'positive'} number of pixels`,
            );
        }
        config[field] = value;
    }

    if (raw.scale !== undefined) {
        if (!isValidPngScale(raw.scale)) {
            reject('scale', `a number greater than 0 and at most ${MAX_PNG_SCALE}`);
        }
        config.scale = raw.scale;
    }

    if (raw.collapse !== undefined) {
        const value = raw.collapse;
        const isNameList =
            Array.isArray(value) &&
            value.every((name) => typeof name === 'string');
        if (typeof value !== 'boolean' && !isNameList) {
            reject('collapse', 'true, false, or an array of state names');
        }
        config.collapse = value;
    }

    if (raw.redactFields !== undefined) {
        const value = raw.redactFields;
        if (
            !Array.isArray(value) ||
            !value.every(
                (name) => typeof name === 'string' && name.trim() !== '',
            )
        ) {
            reject('redactFields', 'an array of non-empty field names');
        }
        // Trimmed as the flag's values are, so " Parameters" still matches.
        config.redactFields = (value as string[]).map((name) => name.trim());
    }

    if (raw.theme !== undefined) {
        const value = raw.theme;
        if (value === 'dark' || value === 'light') {
            config.theme = value;
        } else if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            const named = Object.keys(value).filter((key) =>
                CUSTOM_THEME_FIELDS.includes(key),
            );
            if (named.length === 0) {
                reject(
                    'theme',
                    `a custom theme naming at least one of: ${CUSTOM_THEME_FIELDS.join(', ')}`,
                );
            }
            config.theme = value;
        } else {
            reject('theme', "'light', 'dark', or a custom theme object");
        }
    }

    return config as CliConfig;
}

/** Parameters for {@link readConfigFile}. */
type ReadConfigFileParams = LoadCliConfigParams;

/**
 * Find, read and parse the config file, without validating any field.
 *
 * @param params - Read parameters
 * @param params.explicitPath - Path from `--config`, or `null` to search
 * @param params.startDir - Directory the search starts from
 *
 * @returns The parsed top-level object and the file it came from, or `null` when there
 *   is no config. An empty file, or a `null` document, gives an empty object.
 *
 * @throws {CliConfigError} When `explicitPath` cannot be read, the file is not valid
 *   JSON or YAML, or its top level is not an object.
 */
function readConfigFile(
    params: ReadConfigFileParams,
): { path: string; raw: Record<string, unknown> } | null {
    const { explicitPath, startDir } = params;
    const path =
        explicitPath === null
            ? discoverConfigPath({ startDir })
            : resolve(explicitPath);
    if (path === null) return null;

    let source: string;
    try {
        source = readFileSync(path, 'utf-8');
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new CliConfigError(`Cannot read config file ${path}: ${reason}`);
    }

    let parsed: unknown;
    try {
        // YAML 1.2 is a JSON superset, so one parser handles every supported filename.
        parsed = parseYaml(source);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new CliConfigError(`Cannot parse config file ${path}: ${reason}`);
    }

    // An empty file, and an explicit `null` document, both mean "no settings" rather
    // than "invalid" - a config someone has commented out should not fail the run.
    if (parsed === undefined || parsed === null) return { path, raw: {} };

    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliConfigError(
            `Invalid config file ${path}: the top level must be an object`,
        );
    }

    return { path, raw: parsed as Record<string, unknown> };
}

/**
 * Load the config file, either the one `--config` names or the nearest discovered one.
 *
 * Unknown keys are dropped rather than rejected, so a `$schema` key for editor
 * completion is harmless and a field added by a later release does not make an older
 * CLI fail on the same file. The `commentGitlab` block is one such key here: it
 * belongs to `comment gitlab` ({@link loadCommentGitlabConfig}), and a mistake in it
 * does not fail a local render.
 *
 * @param params - Load parameters
 * @param params.explicitPath - Path from `--config`, or `null` to search
 * @param params.startDir - Directory the search starts from
 *
 * @returns The config and the file it came from, or `null` when there is no config.
 *
 * @throws {CliConfigError} When `explicitPath` cannot be read, the file is not valid
 *   JSON or YAML, its top level is not an object, or a known field is invalid.
 *
 * @example
 * ```typescript
 * const loaded = loadCliConfig({ explicitPath: null, startDir: process.cwd() });
 * if (loaded) console.log(loaded.path, loaded.config);
 * ```
 */
export function loadCliConfig(
    params: LoadCliConfigParams,
): { config: CliConfig; path: string } | null {
    const file = readConfigFile(params);
    if (file === null) return null;
    return {
        config: validateConfig({ path: file.path, raw: file.raw }),
        path: file.path,
    };
}

/** The `commentGitlab` block fields `comment gitlab` honours: the render settings it forwards. */
export const COMMENT_GITLAB_CONFIG_FIELDS = [
    'catchHandling',
    'collapse',
    'layout',
    'theme',
] as const;

/** A validated `commentGitlab` block. */
export type CommentGitlabConfig = Pick<
    CliConfig,
    (typeof COMMENT_GITLAB_CONFIG_FIELDS)[number]
>;

/** Parameters for {@link loadCommentGitlabConfig}. */
export type LoadCommentGitlabConfigParams = LoadCliConfigParams;

/**
 * Load the `commentGitlab` block of the config file, for `sfn-diagram comment gitlab`.
 *
 * The subcommand reads only this block, never the top-level fields: most of those are
 * options it has no use for, and a file written for local renders should not quietly
 * change what a pipeline posts to a merge request. Unlike the top level, the block is
 * strict. A key outside {@link COMMENT_GITLAB_CONFIG_FIELDS} is an error rather than
 * dropped, because a setting the subcommand silently ignores is exactly the
 * half-working behaviour the block exists to avoid.
 *
 * @param params - Load parameters
 * @param params.explicitPath - Path from `--config`, or `null` to search
 * @param params.startDir - Directory the search starts from
 *
 * @returns The validated block and the file it came from, or `null` when no file was
 *   found or a discovered file has no `commentGitlab` key. A `commentGitlab: null`
 *   block gives an empty config.
 *
 * @throws {CliConfigError} When the file cannot be read or parsed; it has a top-level
 *   key that differs from `commentGitlab` only in case, spacing or punctuation (such as
 *   `commentGitLab` or `comment_gitlab`), even beside a correct block; `explicitPath`
 *   names a file with no `commentGitlab` block; the block is not an object; it has an
 *   unsupported key; or a field is invalid.
 *
 * @example
 * ```typescript
 * // sfn-diagram.config.yaml:  commentGitlab: { theme: dark, catchHandling: hide }
 * loadCommentGitlabConfig({ explicitPath: null, startDir: process.cwd() });
 * // { config: { catchHandling: 'hide', theme: 'dark' }, path: '/repo/sfn-diagram.config.yaml' }
 * ```
 */
export function loadCommentGitlabConfig(
    params: LoadCommentGitlabConfigParams,
): { config: CommentGitlabConfig; path: string } | null {
    const file = readConfigFile(params);
    if (file === null) return null;
    const { path, raw } = file;

    // The main CLI drops unknown top-level keys, so a near miss such as `commentGitLab`,
    // `comment_gitlab` or `comment gitlab` would otherwise leave the block silently
    // unread. Quoted, since a stray space is one way to miss.
    const nearMisses = Object.keys(raw)
        .filter(
            (key) =>
                key !== 'commentGitlab' &&
                key.toLowerCase().replace(/[^a-z0-9]/g, '') === 'commentgitlab',
        )
        .sort();
    if (nearMisses.length > 0) {
        const named = nearMisses.map((key) => JSON.stringify(key)).join(', ');
        throw new CliConfigError(
            `Unknown ${nearMisses.length === 1 ? 'key' : 'keys'} ${named} in ${path}: did you mean commentGitlab?`,
        );
    }

    if (!('commentGitlab' in raw)) {
        // An explicit path is a statement of intent; a no-op there would hide a typo.
        if (params.explicitPath !== null) {
            throw new CliConfigError(
                `${path} has no commentGitlab block; comment gitlab reads only that block`,
            );
        }
        return null;
    }

    const block = raw.commentGitlab;
    if (block === null || block === undefined) return { config: {}, path };
    if (typeof block !== 'object' || Array.isArray(block)) {
        throw new CliConfigError(
            `Invalid commentGitlab in ${path}: expected an object`,
        );
    }

    const supported: readonly string[] = COMMENT_GITLAB_CONFIG_FIELDS;
    const unsupported = Object.keys(block)
        .filter((key) => !supported.includes(key))
        .sort();
    if (unsupported.length > 0) {
        const named = unsupported
            .map((key) => `commentGitlab.${key}`)
            .join(', ');
        throw new CliConfigError(
            `Unsupported ${named} in ${path}: comment gitlab reads only ${supported.join(', ')}`,
        );
    }

    return {
        config: validateConfig({
            fieldPrefix: 'commentGitlab.',
            path,
            raw: block as Record<string, unknown>,
        }) as CommentGitlabConfig,
        path,
    };
}
