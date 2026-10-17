import { existsSync, readdirSync, statSync } from 'node:fs';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';
import { minimatch } from 'minimatch';
import type { DiagramFormat } from './types';

/** A problem with what the command line asked to render. */
export class CliInputError extends Error {}

/** Directory names the walk never descends into. */
/**
 * Directories never walked when expanding a glob, and never reported by `--watch`.
 *
 * Exported so `cliWatch.ts` filters events by the same list: `fs.watch` has no
 * equivalent of this skip, so without it a recursive watch sees every `node_modules`
 * and `.git` write.
 */
export const SKIPPED_DIRECTORIES: readonly string[] = ['node_modules', '.git'];

/** Characters that make a positional a pattern rather than a path. */
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * Whether a positional should be expanded as a glob rather than used as a path.
 *
 * @param pattern - The positional as given on the command line.
 *
 * @returns `true` when it contains a glob metacharacter.
 *
 * @example
 * ```typescript
 * hasGlobMagic('machines/*.asl.json'); // true
 * hasGlobMagic('order.asl.json'); // false
 * ```
 */
export function hasGlobMagic(pattern: string): boolean {
    return GLOB_MAGIC.test(pattern);
}

/** Rewrite a path or pattern with forward slashes, which is all minimatch matches. */
export function toPosix(pathOrPattern: string): string {
    return pathOrPattern.split(sep).join('/').split('\\').join('/');
}

/**
 * A glob pattern with forward slashes and no leading `./`.
 *
 * A leading `./` never appears on the candidates, which come from `relative()`, so
 * leaving it on the pattern would match nothing. Shell completion and copied
 * documentation both produce it constantly. Shared by {@link expandInputs} and
 * {@link commonInputRoot} so the directory walked and the `--preserve-tree` root
 * cannot drift apart.
 */
function normalizePattern(pattern: string): string {
    return toPosix(pattern).replace(/^\.\//, '');
}

/**
 * The leading directory segments of a pattern before its first metacharacter.
 *
 * Walking from here rather than from the working directory keeps a scoped pattern
 * (`machines/**` with a filename) from reading the whole tree. Exported because that
 * scoping cannot be observed from `expandInputs`'s result — matching filters the
 * candidates afterwards either way, so a test of the output passes even with no
 * scoping at all, and `readdirSync` cannot be spied on through an ESM namespace.
 *
 * @param pattern - A pattern containing at least one glob metacharacter.
 *
 * @returns The directory prefix to walk from, relative or absolute as the pattern was,
 *   or `''` when the pattern's first segment already contains a metacharacter.
 *
 * @example
 * ```typescript
 * patternRoot('machines/**' + '/*.asl.json'); // 'machines'
 * patternRoot('*.asl.json'); // ''
 * ```
 */
export function patternRoot(pattern: string): string {
    const segments = toPosix(pattern).split('/');
    const plain: string[] = [];
    for (const segment of segments) {
        // Only reached for patterns that contain magic, so the loop always breaks
        // before the filename: every segment collected here is a real directory. An
        // earlier version popped the last one anyway, which reduced
        // `machines/**/*.asl.json` to no root at all and read the whole tree.
        if (hasGlobMagic(segment)) break;
        plain.push(segment);
    }
    return plain.join('/');
}

/** Whether a directory entry is a symlink that resolves to a regular file. */
function isSymlinkToFile(
    entry: { isSymbolicLink: () => boolean },
    entryPath: string,
): boolean {
    if (!entry.isSymbolicLink()) return false;
    try {
        return statSync(entryPath).isFile();
    } catch {
        // A broken symlink is not a definition; it is also not an error worth failing
        // the whole pattern over, since it matched nothing the caller asked for.
        return false;
    }
}

/** Parameters for {@link walkFiles}. */
interface WalkFilesParams {
    /**
     * Directory every returned path is made relative to, or `null` to return absolute
     * paths — which an absolute pattern has to be matched against.
     */
    cwd: string | null;
    /** Directory to read. */
    directory: string;
}

/** Every file at or below `directory`, as paths relative to `cwd` with `/` separators. */
function walkFiles(params: WalkFilesParams): string[] {
    const { cwd, directory } = params;
    const found: string[] = [];
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        // A pattern rooted at a directory that does not exist matches nothing, which
        // the caller reports as such.
        return found;
    }
    for (const entry of entries) {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
            found.push(...walkFiles({ cwd, directory: entryPath }));
        } else if (entry.isFile() || isSymlinkToFile(entry, entryPath)) {
            // A symlink is neither isFile() nor isDirectory() with withFileTypes, so
            // without the second test a symlinked definition is skipped entirely and
            // the pattern reports no matches. Symlinked *directories* are still not
            // descended, which is what keeps the walk from looping.
            found.push(
                toPosix(cwd === null ? entryPath : relative(cwd, entryPath)),
            );
        }
    }
    return found;
}

/** Parameters for {@link expandInputs}. */
export interface ExpandInputsParams {
    /** Directory patterns are resolved against. */
    cwd: string;
    /** The positionals, in the order given. */
    patterns: string[];
}

/**
 * Turn the positionals into a concrete list of input paths.
 *
 * A positional with no glob metacharacter passes through untouched — its existence is
 * checked when it is read, which reports a missing file properly. A positional with a
 * metacharacter is expanded by walking from its non-glob prefix and matching with
 * `minimatch`, deliberately *without* `matchBase`: a bare `*.asl.json` means this
 * directory, and a `**` pattern means any depth. With `matchBase` there would be no way
 * to ask for the first.
 *
 * Matches from one pattern are sorted, so a batch's order does not depend on the order
 * the filesystem happens to return entries in.
 *
 * @param params - Expansion parameters
 * @param params.cwd - Directory patterns are resolved against
 * @param params.patterns - The positionals, in the order given
 *
 * @returns The input paths, de-duplicated, keeping first-seen order.
 *
 * @throws {CliInputError} When a pattern matches no file.
 *
 * @example
 * ```typescript
 * expandInputs({ cwd: process.cwd(), patterns: ['machines/*.asl.json'] });
 * // ['machines/order.asl.json', 'machines/refund.asl.json']
 * ```
 */
export function expandInputs(params: ExpandInputsParams): string[] {
    const { cwd, patterns } = params;
    const resolvedCwd = resolve(cwd);
    const collected: string[] = [];

    for (const pattern of patterns) {
        if (!hasGlobMagic(pattern)) {
            collected.push(pattern);
            continue;
        }
        const normalized = normalizePattern(pattern);
        const absolute =
            isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
        const root = patternRoot(normalized);
        const walkRoot = absolute
            ? root === ''
                ? resolvedCwd
                : root
            : root === ''
              ? resolvedCwd
              : join(resolvedCwd, root);
        const candidates = walkFiles({
            // An absolute pattern can only match absolute candidates, so the walk
            // reports them unmodified rather than relative to the working directory.
            cwd: absolute ? null : resolvedCwd,
            directory: walkRoot,
        });
        const matched = candidates
            // `dot: true` because the walk already decides which directories are
            // off limits; without it no pattern would match a path with a dotted
            // segment, so `.github/workflows/machine.asl.json` would be walked and
            // then silently discarded.
            .filter((candidate) =>
                minimatch(candidate, normalized, { dot: true }),
            )
            .sort();
        if (matched.length > 0) {
            collected.push(...matched);
            continue;
        }
        // `order[1].asl.json` is both a real filename and a valid pattern. Rendering
        // it worked before globbing existed, so a pattern that matches nothing falls
        // back to the literal path when that path is there.
        if (existsSync(resolve(resolvedCwd, pattern))) {
            collected.push(pattern);
            continue;
        }
        throw new CliInputError(`No files matched: ${pattern}`);
    }

    return [...new Set(collected)];
}

/**
 * File extension written for each output format.
 *
 * Every {@link DiagramFormat} must appear: a format missing from here would produce an
 * output file with no extension, silently. A test asserts the key set.
 */
export const OUTPUT_EXTENSIONS: Readonly<Record<DiagramFormat, string>> = {
    html: '.html',
    mermaid: '.mmd',
    png: '.png',
    svg: '.svg',
};

/**
 * Input suffixes stripped before the output extension is appended, longest first.
 *
 * Order matters: `order.asl.json` must lose all of `.asl.json`, and matching `.json`
 * first would leave `order.asl.svg`; likewise `main.tf.json` must lose all of `.tf.json`.
 */
const INPUT_SUFFIXES: readonly string[] = [
    '.asl.json',
    '.asl.yaml',
    '.asl.yml',
    '.asl',
    '.tf.json',
    '.tf',
    '.json',
    '.yaml',
    '.yml',
];

/** Parameters for {@link isWithin}. */
interface IsWithinParams {
    /** Absolute directory that may contain `path`. */
    directory: string;
    /** Absolute path to test. */
    path: string;
}

/**
 * Whether `path` is `directory` itself or somewhere below it.
 *
 * Checks for a `..` segment rather than a `..` prefix, so a child directory literally
 * named `..ab` still counts as inside. A cross-drive `relative` comes back absolute
 * rather than starting with `..`, so that case is tested separately.
 */
function isWithin(params: IsWithinParams): boolean {
    const rel = relative(params.directory, params.path);
    return (
        rel === '' ||
        (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    );
}

/** Parameters for {@link commonInputRoot}. */
export interface CommonInputRootParams {
    /** Directory relative positionals are resolved against. */
    cwd: string;
    /** The positionals as given, before glob expansion. */
    patterns: string[];
}

/**
 * The directory `--preserve-tree` mirrors outputs relative to: the deepest directory
 * every positional's base sits in.
 *
 * A glob contributes its non-glob prefix ({@link patternRoot}) and a literal path its
 * directory — never the files a glob happened to match. Rooting at the matches would
 * make every output move as soon as a new match appeared higher up the tree, which is
 * the reason a mirrored layout is opt-in at all (#328). Rooted at the command line,
 * outputs move only when the command line changes, and `--watch` keeps the same root on
 * every re-run.
 *
 * Pure: nothing is read from the filesystem.
 *
 * @param params - Root parameters
 * @param params.cwd - Directory relative positionals are resolved against
 * @param params.patterns - The positionals as given, before glob expansion
 *
 * @returns An absolute directory; `cwd` itself when there are no patterns.
 *
 * @throws {CliInputError} When two positionals share no directory at all — different
 *   Windows drives, or a network share and a drive.
 *
 * @example
 * ```typescript
 * commonInputRoot({
 *     cwd: '/repo',
 *     patterns: ['machines/a/order.asl.json', 'machines/b/' + '*.asl.json'],
 * });
 * // '/repo/machines'
 * ```
 */
export function commonInputRoot(params: CommonInputRootParams): string {
    const { cwd, patterns } = params;
    const bases = patterns.map((pattern) => {
        const base = hasGlobMagic(pattern)
            ? patternRoot(normalizePattern(pattern)) || '.'
            : dirname(pattern);
        return resolve(cwd, base);
    });
    if (bases.length === 0) return resolve(cwd);

    let root = bases[0];
    for (const base of bases.slice(1)) {
        while (!isWithin({ directory: root, path: base })) {
            const parent = dirname(root);
            if (parent === root) {
                throw new CliInputError(
                    `--preserve-tree needs inputs that share a directory; ${bases[0]} and ${base} are on different drives or network shares`,
                );
            }
            root = parent;
        }
    }
    return root;
}

/** Parameters for {@link deriveOutputName}. */
export interface DeriveOutputNameParams {
    /** The output format, which decides the extension. */
    format: DiagramFormat;
    /** The input path; only its basename is used. */
    input: string;
}

/**
 * The output filename for one input, with no directory part.
 *
 * The input's directory is deliberately discarded — output is flat by default, because
 * that is what a caller globs over afterwards; `--preserve-tree` puts the directory back
 * in {@link planOutputPaths}. Two inputs that would produce the same name are caught
 * there rather than silently overwriting each other.
 *
 * @param params - Derivation parameters
 * @param params.format - The output format, which decides the extension
 * @param params.input - The input path; only its basename is used
 *
 * @returns The output filename, e.g. `order.svg`.
 *
 * @example
 * ```typescript
 * deriveOutputName({ format: 'svg', input: 'machines/order.asl.json' }); // 'order.svg'
 * ```
 */
export function deriveOutputName(params: DeriveOutputNameParams): string {
    const { format, input } = params;
    const name = basename(toPosix(input));
    const suffix = INPUT_SUFFIXES.find((candidate) =>
        name.toLowerCase().endsWith(candidate),
    );
    const stem = suffix === undefined ? name : name.slice(0, -suffix.length);
    return `${stem}${OUTPUT_EXTENSIONS[format]}`;
}

/** One source and the name its output file is derived from. */
export interface OutputNamingSource {
    /** How this source is named in errors: a file path, or an ARN. */
    label: string;
    /**
     * The string the output filename is derived from — a path for a file input, a
     * state machine name for an ARN. Kept separate from {@link OutputNamingSource.label}
     * because an ARN has no basename and its colons cannot be part of a filename.
     */
    nameSource: string;
}

/** One source and the file its output goes to. */
export interface PlannedOutput {
    /** How the source is named in errors: a file path, or an ARN. */
    label: string;
    /** The output path, inside the requested output directory. */
    output: string;
}

/** Parameters for {@link planOutputPaths}. */
export interface PlanOutputPathsParams {
    /** The output format, which decides each extension. */
    format: DiagramFormat;
    /** Directory every output is written into. */
    outDir: string;
    /** The sources, in the order they will be rendered. */
    sources: OutputNamingSource[];
    /**
     * Absolute directory each output keeps its input's directory relative to, from
     * `--preserve-tree`; omitted for flat output.
     */
    treeRoot?: string;
}

/**
 * Pair every source with its output path, refusing the whole batch if two collide.
 *
 * Collisions are found before anything is written, so a rejected batch leaves no
 * half-populated output directory behind. Every colliding group is reported, not just
 * the first, because a caller fixing one would otherwise have to run again to find the
 * next. With a `treeRoot` collisions are still checked: `order.asl.json` and
 * `order.json` in one directory derive the same name whatever the layout.
 *
 * @param params - Planning parameters
 * @param params.format - The output format, which decides each extension
 * @param params.outDir - Directory every output is written into
 * @param params.sources - The sources, in the order they will be rendered
 * @param params.treeRoot - Absolute directory each output keeps its input's directory
 *   relative to (`--preserve-tree`); omitted for flat output
 *
 * @returns One entry per source, in the order given.
 *
 * @throws {CliInputError} When two or more sources derive the same output path, or
 *   when a source lies outside `treeRoot` — refused so nothing is written outside
 *   `outDir`.
 *
 * @example
 * ```typescript
 * planOutputPaths({
 *     format: 'svg',
 *     outDir: 'out',
 *     sources: [{ label: 'a/order.asl.json', nameSource: 'a/order.asl.json' }],
 * });
 * // [{ label: 'a/order.asl.json', output: 'out/order.svg' }]
 *
 * planOutputPaths({
 *     format: 'svg',
 *     outDir: 'out',
 *     sources: [{ label: 'a/order.asl.json', nameSource: '/repo/a/order.asl.json' }],
 *     treeRoot: '/repo',
 * });
 * // [{ label: 'a/order.asl.json', output: 'out/a/order.svg' }]
 * ```
 */
export function planOutputPaths(
    params: PlanOutputPathsParams,
): PlannedOutput[] {
    const { format, outDir, sources, treeRoot } = params;
    const keys = sources.map((source) => {
        const name = deriveOutputName({ format, input: source.nameSource });
        if (treeRoot === undefined) return name;
        const inputDir = dirname(resolve(source.nameSource));
        if (!isWithin({ directory: treeRoot, path: inputDir })) {
            // Reachable from the command line: a glob that matched nothing is kept as
            // a literal path, and a `..` after its magic segment can resolve above the
            // glob's prefix. Refusing here guarantees nothing is written outside
            // --out-dir.
            throw new CliInputError(
                `--preserve-tree cannot place ${source.label}: it resolves outside the inputs' common root ${treeRoot}`,
            );
        }
        return join(relative(treeRoot, inputDir), name);
    });

    const byKey = new Map<string, OutputNamingSource[]>();
    sources.forEach((source, index) => {
        const existing = byKey.get(keys[index]);
        if (existing === undefined) {
            byKey.set(keys[index], [source]);
        } else {
            existing.push(source);
        }
    });

    const collisions = [...byKey.entries()].filter(
        ([, group]) => group.length > 1,
    );
    if (collisions.length > 0) {
        const detail = collisions
            .map(
                ([key, group]) =>
                    `  ${join(outDir, key)} <- ${group.map((source) => source.label).join(', ')}`,
            )
            .join('\n');
        // Only point at --preserve-tree when it would separate every clash: suggesting
        // it for a same-directory pair sends the caller into a second refusal.
        const treeWouldHelp = (): boolean =>
            collisions.every(
                ([, group]) =>
                    new Set(
                        group.map((source) =>
                            dirname(resolve(source.nameSource)),
                        ),
                    ).size === group.length,
            );
        const hint =
            treeRoot !== undefined
                ? 'Rename one, or render them in separate runs.'
                : treeWouldHelp()
                  ? 'Rename one, pass --preserve-tree to keep their directories apart, or render them in separate runs.'
                  : 'Rename one, give them distinct basenames, or render them in separate runs.';
        throw new CliInputError(
            `Two or more inputs would be written to the same file:\n${detail}\n${hint}`,
        );
    }

    return keys.map((key, index) => ({
        label: sources[index].label,
        output: join(outDir, key),
    }));
}
