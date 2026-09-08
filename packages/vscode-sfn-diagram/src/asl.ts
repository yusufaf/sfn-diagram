export const ASL_FILE_SUFFIXES = ['.asl.json', '.asl'] as const

export interface IsAslFileNameParams {
    fileName: string
}

/**
 * Checks whether a file name (or path) looks like a Step Functions ASL definition.
 *
 * @param params - Parameters object.
 * @param params.fileName - The file name or path to check. Works with both
 *   `\` (Windows) and `/` (POSIX) path separators, and is case-insensitive.
 * @returns `true` if the name ends with `.asl.json` or `.asl`.
 * @example
 * isAslFileName({ fileName: 'order-processing.asl.json' }) // true
 * isAslFileName({ fileName: 'package.json' }) // false
 */
export function isAslFileName(params: IsAslFileNameParams): boolean {
    const lowerFileName = params.fileName.toLowerCase()
    return ASL_FILE_SUFFIXES.some((suffix) => lowerFileName.endsWith(suffix))
}
