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
    EdgeStyleOverride,
    IconPosition,
    LayoutDirection,
    NodeStyle,
    StateType,
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
 * Only data-valued options appear. `iconResolver` and `redact` are callbacks and stay
 * API-only, as does `nodeAnnotations`; `redactFields` and `includeRawState` cover the
 * common cases of `redact`. The style maps (`customColors`, `nodeOverrides`,
 * `edgeOverrides`) have no flag, so the file is the CLI's only way to set them.
 *
 * A `commentGitlab` block in the same file is not part of this type: it belongs to
 * `sfn-diagram comment gitlab` ({@link CommentGitlabConfig}), and the main CLI ignores it.
 */
export interface CliConfig {
    backgroundColor?: string;
    catchHandling?: CatchHandling;
    catchLabelStyle?: CatchLabelStyle;
    collapse?: string[] | boolean;
    /** Per-state-type `fill` and `stroke`, applied over whichever theme is chosen. */
    customColors?: Partial<
        Record<StateType, Partial<Pick<NodeStyle, 'fill' | 'stroke'>>>
    >;
    diagramDescription?: string;
    diagramTitle?: string;
    /** Per-edge style, keyed by edge id (`From->To#normal#0`) or `From->To`. */
    edgeOverrides?: Record<string, EdgeStyleOverride>;
    edgeStyle?: EdgePathStyle;
    format?: DiagramFormat;
    iconPosition?: IconPosition;
    iconSize?: number;
    includeComments?: boolean;
    /** HTML only: `false` inlines no state's raw ASL. Other formats ignore it. */
    includeRawState?: boolean;
    layout?: LayoutDirection;
    /** PNG only: also parse every installed font. Other formats ignore it. */
    loadSystemFonts?: boolean;
    nodeHeight?: number;
    /** Per-state style, keyed by state id. */
    nodeOverrides?: Record<string, Partial<NodeStyle>>;
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
    theme?: CustomTheme | 'auto' | 'dark' | 'light';
}

/** Parameters for {@link loadCliConfig}. */
export interface LoadCliConfigParams {
    /** Path from `--config`, or `null` to search for one. */
    explicitPath: string | null;
    /** Directory the search starts from when `explicitPath` is `null`. */
    startDir: string;
}

/**
 * A JSON Schema (draft-07) fragment, limited to the keywords the config schema uses.
 */
export interface JsonSchema {
    $id?: string;
    $schema?: string;
    additionalProperties?: JsonSchema | boolean;
    anyOf?: JsonSchema[];
    description?: string;
    enum?: readonly string[];
    exclusiveMinimum?: number;
    items?: JsonSchema;
    maximum?: number;
    minimum?: number;
    minLength?: number;
    minProperties?: number;
    pattern?: string;
    properties?: Record<string, JsonSchema | boolean>;
    propertyNames?: JsonSchema;
    required?: string[];
    title?: string;
    type?: 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';
}

/** Parameters for the `reject` callback a {@link ConfigField} validator receives. */
export interface RejectParams {
    /** What the field should have held, completing "expected …" in the error. */
    expected: string;
    /** The field's full path, such as `commentGitlab.theme` or `customColors.Task.fill`. */
    fieldPath: string;
}

/** Parameters for {@link ConfigField.validate}. */
export interface ValidateFieldParams {
    /** The field's full path, named in any error. */
    fieldPath: string;
    /** Throws the config error for a bad value; never returns. */
    reject: (params: RejectParams) => never;
    /** The parsed value, never `undefined`. */
    value: unknown;
}

/**
 * One config field: its check and its JSON Schema fragment, written side by side so the
 * CLI and an editor using the published schema accept the same values.
 */
export interface ConfigField {
    /** One line for editor hover text. */
    description: string;
    /** The JSON Schema fragment describing the values `validate` accepts. */
    schema: JsonSchema;
    /** Returns the value to keep, or calls `reject`. */
    validate: (params: ValidateFieldParams) => unknown;
}

/** Parameters for {@link enumField}. */
interface EnumFieldParams {
    description: string;
    values: readonly string[];
}

/** A string field limited to `values`. */
function enumField(params: EnumFieldParams): ConfigField {
    const { description, values } = params;
    return {
        description,
        schema: { enum: values, type: 'string' },
        validate: ({ fieldPath, reject, value }) => {
            if (typeof value !== 'string' || !values.includes(value)) {
                reject({ expected: `one of: ${values.join(', ')}`, fieldPath });
            }
            return value;
        },
    };
}

/** Parameters for {@link textField}. */
interface TextFieldParams {
    description: string;
}

/**
 * A free-text field, which must be non-empty as the matching flags require.
 *
 * The schema's `\S` matches exactly the characters `trim()` does not strip.
 */
function textField(params: TextFieldParams): ConfigField {
    const { description } = params;
    return {
        description,
        schema: { pattern: '\\S', type: 'string' },
        validate: ({ fieldPath, reject, value }) => {
            if (typeof value !== 'string' || value.trim() === '') {
                reject({ expected: 'a non-empty string', fieldPath });
            }
            return value;
        },
    };
}

/** Parameters for {@link booleanField}. */
interface BooleanFieldParams {
    description: string;
}

/** A `true`/`false` field. */
function booleanField(params: BooleanFieldParams): ConfigField {
    const { description } = params;
    return {
        description,
        schema: { type: 'boolean' },
        validate: ({ fieldPath, reject, value }) => {
            if (typeof value !== 'boolean') {
                reject({ expected: 'true or false', fieldPath });
            }
            return value;
        },
    };
}

/** Parameters for {@link pixelField}. */
interface PixelFieldParams {
    /**
     * Whether zero is acceptable. The same split the flags use: a dimension has to be
     * positive to draw anything, while a separation or a padding of zero is a meaningful
     * request.
     */
    allowZero: boolean;
    description: string;
}

/** A finite pixel count. */
function pixelField(params: PixelFieldParams): ConfigField {
    const { allowZero, description } = params;
    return {
        description,
        schema: allowZero
            ? { minimum: 0, type: 'number' }
            : { exclusiveMinimum: 0, type: 'number' },
        validate: ({ fieldPath, reject, value }) => {
            if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < 0 ||
                (!allowZero && value <= 0)
            ) {
                reject({
                    expected: `a ${allowZero ? 'non-negative' : 'positive'} number of pixels`,
                    fieldPath,
                });
            }
            return value;
        },
    };
}

/** Parameters for {@link unitIntervalField}. */
interface UnitIntervalFieldParams {
    description: string;
}

/** A finite number from 0 to 1. */
function unitIntervalField(params: UnitIntervalFieldParams): ConfigField {
    const { description } = params;
    return {
        description,
        schema: { maximum: 1, minimum: 0, type: 'number' },
        validate: ({ fieldPath, reject, value }) => {
            if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < 0 ||
                value > 1
            ) {
                reject({ expected: 'a number from 0 to 1', fieldPath });
            }
            return value;
        },
    };
}

/** Whether a parsed value is an object that is neither `null` nor an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parameters for {@link formatFieldPath}. */
interface FormatFieldPathParams {
    key: string;
    parent: string;
}

/**
 * Append a map key to a field path: `parent.key` for an identifier-like key, otherwise
 * `parent["key"]`, so a state name with a space or an edge id stays readable.
 */
function formatFieldPath(params: FormatFieldPathParams): string {
    const { key, parent } = params;
    return /^[A-Za-z_$][\w$]*$/.test(key)
        ? `${parent}.${key}`
        : `${parent}[${JSON.stringify(key)}]`;
}

/** Every state type, sorted. The `Record` makes a missing or unknown one a type error. */
const STATE_TYPE_NAMES: readonly string[] = Object.keys({
    Choice: true,
    Fail: true,
    Map: true,
    Parallel: true,
    Pass: true,
    Succeed: true,
    Task: true,
    Wait: true,
} satisfies Record<StateType, true>);

/**
 * A colour: not blank, on one line, and free of `;`, `{` and `}`. No colour syntax uses
 * them, and Mermaid output copies the value into a `classDef` line, where a line break
 * or a `;` would start a statement of the file's choosing. Control characters and the
 * Unicode line and paragraph separators count as line breaks. Shared as one string by
 * the check and the schema, and written without lookarounds, which JSON Schema's
 * portable regex subset leaves out. The leading run takes only whitespace, so the first
 * non-space character can split the string one way only: a run that could also take
 * it would backtrack quadratically on a long value that fails.
 */
const COLOUR_FORBIDDEN = ';{}\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029';
const COLOUR_PATTERN = `^[^\\S${COLOUR_FORBIDDEN}]*[^\\s${COLOUR_FORBIDDEN}][^${COLOUR_FORBIDDEN}]*$`;
const COLOUR_REGEXP = new RegExp(COLOUR_PATTERN, 'u');

/** Parameters for {@link colourField}. */
interface ColourFieldParams {
    description: string;
}

/** A colour field, checked against {@link COLOUR_PATTERN}. */
function colourField(params: ColourFieldParams): ConfigField {
    const { description } = params;
    return {
        description: `${description} Any SVG colour; quote it in YAML, where # starts a comment.`,
        schema: { pattern: COLOUR_PATTERN, type: 'string' },
        validate: ({ fieldPath, reject, value }) => {
            if (typeof value !== 'string' || !COLOUR_REGEXP.test(value)) {
                reject({
                    expected:
                        'a non-empty string on one line without ;, {, } or control characters',
                    fieldPath,
                });
            }
            return value;
        },
    };
}

/** The style fields the config's style maps accept, each a field in its own right. */
const STYLE_PROPERTIES = {
    fill: colourField({ description: 'Fill colour.' }),
    shape: enumField({
        description: 'Node shape.',
        values: ['circle', 'diamond', 'rect'],
    }),
    stroke: colourField({ description: 'Stroke colour.' }),
    strokeOpacity: unitIntervalField({
        description: 'Opacity of the edge path, arrowhead and label, from 0 to 1.',
    }),
    strokeWidth: pixelField({
        allowZero: true,
        description: 'Stroke width in pixels.',
    }),
} satisfies Record<string, ConfigField>;

type StyleProperty = keyof typeof STYLE_PROPERTIES;

/** What a style map is keyed by: its key check, its error text and its schema. */
const STYLE_MAP_KEYS = {
    edgeId: {
        accepts: (key: string) => key.includes('->'),
        expected: 'an edge id such as From->To#normal#0, or From->To',
        label: 'edge id',
        schema: { pattern: '->', type: 'string' },
    },
    nodeId: {
        accepts: (key: string) => key !== '',
        expected: 'a non-empty state id',
        label: 'state id',
        schema: { minLength: 1, type: 'string' },
    },
    stateType: {
        accepts: (key: string) => STATE_TYPE_NAMES.includes(key),
        expected: `a state type: ${STATE_TYPE_NAMES.join(', ')}`,
        label: 'state type',
        schema: { enum: STATE_TYPE_NAMES, type: 'string' },
    },
} satisfies Record<
    string,
    {
        accepts: (key: string) => boolean;
        expected: string;
        label: string;
        schema: JsonSchema;
    }
>;

/** Parameters for {@link styleMapField}. */
interface StyleMapFieldParams {
    description: string;
    keys: keyof typeof STYLE_MAP_KEYS;
    /** The style fields an entry may set. */
    properties: readonly StyleProperty[];
}

/**
 * A map from a state type, state id or edge id to a style.
 *
 * Strict where the top level is lenient: an unknown key or style field is an error, since
 * a typo inside the map would otherwise be a silent no-op.
 */
function styleMapField(params: StyleMapFieldParams): ConfigField {
    const { description, keys, properties } = params;
    const keyRule = STYLE_MAP_KEYS[keys];
    const styleFields = properties.join(', ');
    const entrySchema: JsonSchema = {
        additionalProperties: false,
        minProperties: 1,
        properties: Object.fromEntries(
            properties.map((name) => [
                name,
                {
                    description: STYLE_PROPERTIES[name].description,
                    ...STYLE_PROPERTIES[name].schema,
                },
            ]),
        ),
        type: 'object',
    };

    return {
        description,
        // A fixed key set lists each key, so editors can complete the state types.
        schema:
            keys === 'stateType'
                ? {
                      additionalProperties: false,
                      properties: Object.fromEntries(
                          STATE_TYPE_NAMES.map((name) => [name, entrySchema]),
                      ),
                      type: 'object',
                  }
                : {
                      additionalProperties: entrySchema,
                      propertyNames: keyRule.schema,
                      type: 'object',
                  },
        validate: ({ fieldPath, reject, value }) => {
            if (!isPlainObject(value)) {
                return reject({
                    expected: `an object keyed by ${keyRule.label}`,
                    fieldPath,
                });
            }
            for (const [key, entry] of Object.entries(value)) {
                const entryPath = formatFieldPath({ key, parent: fieldPath });
                if (!keyRule.accepts(key)) {
                    reject({ expected: keyRule.expected, fieldPath: entryPath });
                }
                if (!isPlainObject(entry) || Object.keys(entry).length === 0) {
                    return reject({
                        expected: `a style naming at least one of: ${styleFields}`,
                        fieldPath: entryPath,
                    });
                }
                for (const [name, styleValue] of Object.entries(entry)) {
                    const stylePath = formatFieldPath({
                        key: name,
                        parent: entryPath,
                    });
                    const property = properties.find(
                        (candidate) => candidate === name,
                    );
                    if (property === undefined) {
                        return reject({
                            expected: `one of the style fields: ${styleFields}`,
                            fieldPath: stylePath,
                        });
                    }
                    STYLE_PROPERTIES[property].validate({
                        fieldPath: stylePath,
                        reject,
                        value: styleValue,
                    });
                }
            }
            return value;
        },
    };
}

/**
 * The largest PNG `scale` the CLI accepts, from the flag or the config file.
 *
 * Catches a DPI value typed as a scale (`--scale 300`), while 10x still covers retina
 * (2-3x) and 300 dpi print (about 3.1x). `scale: 1000` on a three-state diagram asks for
 * a 200 GB image; the resvg engine refuses any image larger than the memory available
 * with an error naming its size, so this cap is about the typo, not memory.
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
 * The fields a {@link CustomTheme} accepts, with their editor descriptions.
 *
 * The names are used only to reject an object that names none of them:
 * `{ backgroundColor: '#111' }` for `background` would otherwise be accepted and render as
 * the plain light theme, with nothing said. Individual field types are left to the
 * renderer, which already tolerates whatever it is given.
 */
const CUSTOM_THEME_FIELD_DESCRIPTIONS: Record<keyof CustomTheme, string> = {
    background: 'Diagram background colour.',
    base: "Built-in theme the omitted fields are taken from: 'light' (default) or 'dark'.",
    edgeColors: 'Edge colours by edge type: normal, error and choice.',
    fontFamily: 'Font family for labels.',
    fontSize: 'Label font size in pixels.',
    nodeColors: 'Per-state-type fill and stroke, keyed by state type.',
    textColor: 'Label text colour.',
};

const CUSTOM_THEME_FIELDS: readonly string[] = Object.keys(
    CUSTOM_THEME_FIELD_DESCRIPTIONS,
);

/**
 * Every config field, keyed by name: the single source for both the CLI's validation
 * and the published JSON Schema (`buildCliConfigSchema`).
 *
 * The mapped type makes a field added to {@link CliConfig} without an entry here, or an
 * entry with no field, a type error.
 */
export const CONFIG_FIELDS: {
    readonly [Field in keyof Required<CliConfig>]: ConfigField;
} = {
    backgroundColor: textField({
        description: 'Background colour (PNG only).',
    }),
    catchHandling: enumField({
        description:
            "How to treat per-state Catch branches: 'show' renders them, 'hide' drops error edges and handler-only states.",
        values: ['hide', 'show'],
    }),
    catchLabelStyle: enumField({
        description:
            "Catch edge labels: 'error-type' shows error names, 'catch-number' shows \"Catch #N\".",
        values: ['catch-number', 'error-type'],
    }),
    collapse: {
        description:
            'Collapse Parallel/Map containers into a placeholder: true for all, or a list of container names.',
        schema: {
            anyOf: [
                { type: 'boolean' },
                { items: { type: 'string' }, type: 'array' },
            ],
        },
        validate: ({ fieldPath, reject, value }) => {
            const isNameList =
                Array.isArray(value) &&
                value.every((name) => typeof name === 'string');
            if (typeof value !== 'boolean' && !isNameList) {
                reject({
                    expected: 'true, false, or an array of state names',
                    fieldPath,
                });
            }
            return value;
        },
    },
    customColors: styleMapField({
        description:
            'Per-state-type fill and stroke, keyed by state type and applied over whichever theme is chosen.',
        keys: 'stateType',
        properties: ['fill', 'stroke'],
    }),
    diagramDescription: textField({
        description:
            "Accessible description, rendered as the root <svg>'s <desc>.",
    }),
    diagramTitle: textField({
        description:
            "Accessible name, rendered as the root <svg>'s <title> and aria-label.",
    }),
    edgeOverrides: styleMapField({
        description:
            'Per-edge style, keyed by edge id (From->To#normal#0) or From->To for every edge between the pair (SVG, HTML and PNG).',
        keys: 'edgeId',
        properties: ['stroke', 'strokeOpacity', 'strokeWidth'],
    }),
    edgeStyle: enumField({
        description: 'Style of edge paths.',
        values: ['curved', 'orthogonal', 'straight'],
    }),
    format: enumField({
        description: 'Output format.',
        values: ['html', 'mermaid', 'png', 'svg'],
    }),
    iconPosition: enumField({
        description: 'Position of AWS service icons relative to the node label.',
        values: ['left', 'right', 'top'],
    }),
    iconSize: pixelField({
        allowZero: false,
        description: 'Size of AWS service icons in pixels.',
    }),
    includeComments: booleanField({
        description: 'Use state comments as node labels.',
    }),
    includeRawState: booleanField({
        description: "Inline each state's raw ASL in the viewer (HTML only).",
    }),
    layout: enumField({
        description:
            'Graph layout direction: TB (top-bottom), LR (left-right), RL (right-left), BT (bottom-top).',
        values: ['BT', 'LR', 'RL', 'TB'],
    }),
    loadSystemFonts: booleanField({
        description: 'Also parse every installed font (PNG only).',
    }),
    nodeHeight: pixelField({
        allowZero: false,
        description: 'Height of each state node in pixels.',
    }),
    nodeOverrides: styleMapField({
        description:
            "Per-state style, keyed by state id: the state's name, or its data-state-id when the name repeats (SVG, HTML and PNG).",
        keys: 'nodeId',
        properties: ['fill', 'shape', 'stroke', 'strokeWidth'],
    }),
    nodeSeparation: pixelField({
        allowZero: true,
        description: 'Horizontal separation between nodes in pixels.',
    }),
    nodeWidth: pixelField({
        allowZero: false,
        description: 'Width of each state node in pixels.',
    }),
    padding: pixelField({
        allowZero: true,
        description: 'Padding around the diagram in pixels.',
    }),
    rankSeparation: pixelField({
        allowZero: true,
        description: 'Vertical separation between ranks in pixels.',
    }),
    redactFields: {
        description: 'ASL field names to redact from the viewer (HTML only).',
        schema: { items: { pattern: '\\S', type: 'string' }, type: 'array' },
        validate: ({ fieldPath, reject, value }) => {
            if (
                !Array.isArray(value) ||
                !value.every(
                    (name) => typeof name === 'string' && name.trim() !== '',
                )
            ) {
                reject({
                    expected: 'an array of non-empty field names',
                    fieldPath,
                });
            }
            // Trimmed as the flag's values are, so " Parameters" still matches.
            return (value as string[]).map((name) => name.trim());
        },
    },
    scale: {
        description: `Resolution multiplier, at most ${MAX_PNG_SCALE} (PNG only).`,
        schema: {
            exclusiveMinimum: 0,
            maximum: MAX_PNG_SCALE,
            type: 'number',
        },
        validate: ({ fieldPath, reject, value }) => {
            if (!isValidPngScale(value)) {
                reject({
                    expected: `a number greater than 0 and at most ${MAX_PNG_SCALE}`,
                    fieldPath,
                });
            }
            return value;
        },
    },
    showIcons: booleanField({
        description: 'Display AWS service icons on Task state nodes.',
    }),
    showStateTypes: booleanField({
        description: 'Display state type labels on nodes.',
    }),
    showVariables: booleanField({
        description:
            'Annotate nodes with the variables they assign via ASL Assign.',
    }),
    stylePreset: enumField({
        description:
            "Visual style preset: 'aws-standard' uses rectangles, 'enhanced' uses shapes per state type.",
        values: ['aws-standard', 'enhanced'],
    }),
    theme: {
        description:
            "Colour theme: 'light', 'dark', 'auto', or a custom theme object.",
        schema: {
            anyOf: [
                { enum: ['auto', 'dark', 'light'], type: 'string' },
                {
                    // Each branch declares its own property: a bare `required` fails
                    // Ajv's strict mode.
                    anyOf: CUSTOM_THEME_FIELDS.map((name) => ({
                        properties: { [name]: true },
                        required: [name],
                    })),
                    properties: Object.fromEntries(
                        Object.entries(CUSTOM_THEME_FIELD_DESCRIPTIONS).map(
                            ([name, description]) => [name, { description }],
                        ),
                    ),
                    type: 'object',
                },
            ],
        },
        validate: ({ fieldPath, reject, value }) => {
            if (value === 'auto' || value === 'dark' || value === 'light') {
                return value;
            }
            if (!isPlainObject(value)) {
                return reject({
                    expected: "'light', 'dark', 'auto', or a custom theme object",
                    fieldPath,
                });
            }
            const named = Object.keys(value).filter((key) =>
                CUSTOM_THEME_FIELDS.includes(key),
            );
            if (named.length === 0) {
                reject({
                    expected: `a custom theme naming at least one of: ${CUSTOM_THEME_FIELDS.join(', ')}`,
                    fieldPath,
                });
            }
            return value;
        },
    },
};

/** Parameters for {@link validateCliConfig}. */
export interface ValidateCliConfigParams {
    /** Prepended to a field's name in errors, such as `commentGitlab.` for a nested block. */
    fieldPrefix?: string;
    /** The file the object came from, named in every error. */
    path: string;
    /** The parsed object to validate. */
    raw: Record<string, unknown>;
}

/**
 * Validate one parsed config object against {@link CONFIG_FIELDS}, dropping keys the CLI
 * does not know.
 *
 * Fields are checked in alphabetical order, so with several bad fields the error names
 * the alphabetically first.
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
 *
 * @example
 * ```typescript
 * validateCliConfig({ path: 'sfn-diagram.config.json', raw: { layout: 'LR', widht: 1 } });
 * // { layout: 'LR' }
 * ```
 */
export function validateCliConfig(params: ValidateCliConfigParams): CliConfig {
    const { fieldPrefix = '', path, raw } = params;
    const config: Record<string, unknown> = {};
    const reject = ({ expected, fieldPath }: RejectParams): never => {
        throw new CliConfigError(
            `Invalid ${fieldPath} in ${path}: expected ${expected}`,
        );
    };

    for (const [field, spec] of Object.entries(CONFIG_FIELDS)) {
        const value = raw[field];
        if (value === undefined) continue;
        config[field] = spec.validate({
            fieldPath: `${fieldPrefix}${field}`,
            reject,
            value,
        });
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
        config: validateCliConfig({ path: file.path, raw: file.raw }),
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
        config: validateCliConfig({
            fieldPrefix: 'commentGitlab.',
            path,
            raw: block as Record<string, unknown>,
        }) as CommentGitlabConfig,
        path,
    };
}
