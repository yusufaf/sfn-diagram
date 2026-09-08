/** Context key toggled to reflect whether the active editor looks like an ASL definition. */
export const ASL_CONTEXT_KEY = 'sfnDiagram.isAslDocument'

/**
 * Filename pattern for the `.asl.json` convention. Kept as the single source of truth:
 * both {@link isAslFilename} and the `editor/title` `when` clauses in `package.json` must
 * agree, and `src/contributes.test.ts` asserts they do.
 */
export const ASL_FILENAME_PATTERN = /\.asl\.json$/i

/**
 * Upper bound, in characters, on documents considered for content sniffing.
 * `looksLikeAslContent` runs on every keystroke of the active editor, so a large
 * non-ASL JSON file must be rejected cheaply rather than parsed.
 */
export const MAX_SNIFF_LENGTH = 1_000_000

interface IsAslFilenameParams {
    filename: string
}

/**
 * Checks whether a filename matches the `.asl.json` or `.asl` naming convention.
 *
 * @param params - The filename to check. May be a bare name or a full path; only the
 * trailing extension is inspected, and the check is case-insensitive.
 * @returns `true` when the filename ends in `.asl.json` or `.asl`.
 * @example
 * isAslFilename({ filename: 'order-processing.asl.json' }) // true
 * isAslFilename({ filename: 'package.json' }) // false
 */
export function isAslFilename(params: IsAslFilenameParams): boolean {
    const { filename } = params
    return ASL_FILENAME_PATTERN.test(filename) || filename.toLowerCase().endsWith('.asl')
}

interface LooksLikeAslContentParams {
    text: string
}

/**
 * Sniffs document text for the shape of an ASL (Amazon States Language) state machine
 * definition: a top-level JSON object with a string `StartAt` and an object `States`.
 *
 * Intentionally shallow: it does not detect ASL nested inside another document (for
 * example a CloudFormation template's `Resources.*.Properties.Definition`), and it does
 * not tolerate JSONC comments. Both are naming-convention gaps covered instead by
 * {@link isAslFilename}.
 *
 * @param params - The document text to sniff.
 * @returns `true` when the text parses as a plausible top-level ASL definition.
 * @example
 * looksLikeAslContent({ text: '{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}' }) // true
 * looksLikeAslContent({ text: '{"name":"my-package"}' }) // false
 */
export function looksLikeAslContent(params: LooksLikeAslContentParams): boolean {
    const { text } = params

    if (text.length > MAX_SNIFF_LENGTH) {
        return false
    }

    if (!(text.includes('"StartAt"') && text.includes('"States"'))) {
        return false
    }

    const withoutBom = text.replace(/^\uFEFF/, '')

    let parsed: unknown
    try {
        parsed = JSON.parse(withoutBom)
    } catch {
        return false
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return false
    }

    const definition = parsed as Record<string, unknown>
    if (typeof definition.StartAt !== 'string') {
        return false
    }

    const states = definition.States
    return typeof states === 'object' && states !== null && !Array.isArray(states)
}

interface IsAslDocumentParams {
    filename: string
    text: string
}

/**
 * Determines whether a document should be treated as an ASL state machine definition,
 * combining the fast filename convention with a content sniff fallback.
 *
 * The filename check wins first so a brand-new, still-empty `*.asl.json` file is
 * recognized immediately. Otherwise the content is sniffed, which recovers ASL files
 * named plainly (for example `statemachine.json`).
 *
 * @param params - The document's filename (bare name or full path) and current text.
 * @returns `true` when the filename matches the ASL convention or the content looks
 * like a top-level ASL definition.
 * @example
 * isAslDocument({ filename: 'statemachine.json', text: '{"StartAt":"A","States":{}}' }) // true
 * isAslDocument({ filename: 'package.json', text: '{"name":"my-package"}' }) // false
 */
export function isAslDocument(params: IsAslDocumentParams): boolean {
    const { filename, text } = params
    return isAslFilename({ filename }) || looksLikeAslContent({ text })
}
