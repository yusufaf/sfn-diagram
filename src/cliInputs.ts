import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';

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
 * (`machines/**` with a filename) from reading the whole tree.
 */
function patternRoot(pattern: string): string {
    const segments = toPosix(pattern).split('/');
    const plain: string[] = [];
    for (const segment of segments) {
        if (hasGlobMagic(segment)) break;
        plain.push(segment);
    }
    // The last plain segment may be the filename itself, which is not a directory;
    // dropping it is harmless because the walk filters by the full pattern anyway.
    plain.pop();
    return plain.join('/');
}

/** Parameters for {@link walkFiles}. */
interface WalkFilesParams {
    /** Directory every returned path is made relative to. */
    cwd: string;
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
        if (entry.isDirectory()) {
            if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
            found.push(
                ...walkFiles({ cwd, directory: join(directory, entry.name) }),
            );
        } else if (entry.isFile()) {
            found.push(toPosix(relative(cwd, join(directory, entry.name))));
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
        const normalized = toPosix(pattern);
        const root = patternRoot(pattern);
        const candidates = walkFiles({
            cwd: resolvedCwd,
            directory: root === '' ? resolvedCwd : join(resolvedCwd, root),
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
        if (matched.length === 0) {
            throw new CliInputError(`No files matched: ${pattern}`);
        }
        collected.push(...matched);
    }

    return [...new Set(collected)];
}
