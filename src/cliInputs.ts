import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';
import type { DiagramFormat } from './types';

/** A problem with what the command line asked to render. */
export class CliInputError extends Error {}

/** Directory names the walk never descends into. */
const SKIPPED_DIRECTORIES: readonly string[] = ['node_modules', '.git'];

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
function toPosix(pathOrPattern: string): string {
    return pathOrPattern.split(sep).join('/').split('\\').join('/');
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
        // A leading `./` never appears on the candidates, which come from
        // `relative()`, so leaving it on the pattern would match nothing. Shell
        // completion and copied documentation both produce it constantly.
        const normalized = toPosix(pattern).replace(/^\.\//, '');
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
 * first would leave `order.asl.svg`.
 */
const INPUT_SUFFIXES: readonly string[] = [
    '.asl.json',
    '.asl.yaml',
    '.asl.yml',
    '.asl',
    '.json',
    '.yaml',
    '.yml',
];

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
 * The input's directory is deliberately discarded — output is flat, because that is what
 * a caller globs over afterwards. Two inputs that would produce the same name are caught
 * by {@link planOutputPaths} rather than silently overwriting each other.
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

/** One input and the file its output goes to. */
export interface PlannedOutput {
    /** The input path, as it will be read. */
    input: string;
    /** The output path, inside the requested output directory. */
    output: string;
}

/** Parameters for {@link planOutputPaths}. */
export interface PlanOutputPathsParams {
    /** The output format, which decides each extension. */
    format: DiagramFormat;
    /** The inputs, in the order they will be rendered. */
    inputs: string[];
    /** Directory every output is written into. */
    outDir: string;
}

/**
 * Pair every input with its output path, refusing the whole batch if two collide.
 *
 * Collisions are found before anything is written, so a rejected batch leaves no
 * half-populated output directory behind. Every colliding group is reported, not just
 * the first, because a caller fixing one would otherwise have to run again to find the
 * next.
 *
 * @param params - Planning parameters
 * @param params.format - The output format, which decides each extension
 * @param params.inputs - The inputs, in the order they will be rendered
 * @param params.outDir - Directory every output is written into
 *
 * @returns One entry per input, in the order given.
 *
 * @throws {CliInputError} When two or more inputs derive the same output name.
 *
 * @example
 * ```typescript
 * planOutputPaths({ format: 'svg', inputs: ['a/order.asl.json'], outDir: 'out' });
 * // [{ input: 'a/order.asl.json', output: 'out/order.svg' }]
 * ```
 */
export function planOutputPaths(
    params: PlanOutputPathsParams,
): PlannedOutput[] {
    const { format, inputs, outDir } = params;
    const byName = new Map<string, string[]>();

    for (const input of inputs) {
        const name = deriveOutputName({ format, input });
        const existing = byName.get(name);
        if (existing === undefined) {
            byName.set(name, [input]);
        } else {
            existing.push(input);
        }
    }

    const collisions = [...byName.entries()].filter(
        ([, sources]) => sources.length > 1,
    );
    if (collisions.length > 0) {
        const detail = collisions
            .map(
                ([name, sources]) =>
                    `  ${join(outDir, name)} <- ${sources.join(', ')}`,
            )
            .join('\n');
        throw new CliInputError(
            `Two or more inputs would be written to the same file:\n${detail}\n` +
                'Rename one, give them distinct basenames, or render them in separate runs.',
        );
    }

    return inputs.map((input) => ({
        input,
        output: join(outDir, deriveOutputName({ format, input })),
    }));
}
