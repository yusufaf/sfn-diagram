export interface ToIdPrefixParams {
    /** A value returned by React's `useId()`. */
    reactId: string
}

/**
 * Turns a `useId()` value into a core `DiagramOptions.idPrefix`, so each diagram's
 * SVG marker ids are its own and match between the server render and hydration.
 *
 * React 18 ids look like `:r0:`, React 19 ids like `_r_0_`, and both embed the
 * root's `identifierPrefix`, which the caller picks and may contain characters core
 * rejects. Every character outside `[A-Za-z0-9_.-]` becomes `_`, `:` included, so
 * the ids stay valid in a standalone SVG file too. The `sfn-` start keeps the
 * prefix a valid XML name, and the trailing `-` separates it from core's id.
 *
 * @param params - The React id to convert.
 * @returns The prefix core prepends to each marker id.
 *
 * @example
 * toIdPrefix({ reactId: ':r0:' }) // 'sfn-_r0_-'
 */
export function toIdPrefix(params: ToIdPrefixParams): string {
    const { reactId } = params
    return `sfn-${reactId.replace(/[^A-Za-z0-9_.-]/g, '_')}-`
}
