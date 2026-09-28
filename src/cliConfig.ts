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
 * with no textual form the CLI can accept, and stay API-only.
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
    layout?: LayoutDirection;
    nodeHeight?: number;
    nodeSeparation?: number;
    nodeWidth?: number;
    padding?: number;
    rankSeparation?: number;
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
    /** The file the object came from, named in every error. */
    path: string;
    /** The parsed top-level object. */
    raw: Record<string, unknown>;
}

/**
 * Validate one parsed config object, dropping keys the CLI does not know.
 *
 * @param params - Validation parameters
 * @param params.path - The file the object came from, named in every error
 * @param params.raw - The parsed top-level object
 *
 * @returns The validated config.
 *
 * @throws {CliConfigError} When a known field has the wrong type or an out-of-range
 *   value.
 */
function validateConfig(params: ValidateConfigParams): CliConfig {
    const { path, raw } = params;
    const config: Record<string, unknown> = {};
    const reject = (field: string, expected: string): never => {
        throw new CliConfigError(
            `Invalid ${field} in ${path}: expected ${expected}`,
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

/**
 * Load the config file, either the one `--config` names or the nearest discovered one.
 *
 * Unknown keys are dropped rather than rejected, so a `$schema` key for editor
 * completion is harmless and a field added by a later release does not make an older
 * CLI fail on the same file.
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
    if (parsed === undefined || parsed === null) return { config: {}, path };

    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliConfigError(
            `Invalid config file ${path}: the top level must be an object`,
        );
    }

    return {
        config: validateConfig({
            path,
            raw: parsed as Record<string, unknown>,
        }),
        path,
    };
}
