import type { ViewerUpdate } from 'sfn-diagram'

/** A host-to-webview message carrying a freshly-rendered diagram to patch in place. */
export interface UpdateContentMessage {
    command: 'updateContent'
    contentHtml: string
    edgeData: ViewerUpdate['edgeData']
    stateData: ViewerUpdate['stateData']
}

/** A host-to-webview message reporting that a debounced refresh failed to render. */
export interface RenderErrorMessage {
    command: 'renderError'
    message: string
}

/** Every message `DiagramPanel` can post to the webview. */
export type HostMessage = RenderErrorMessage | UpdateContentMessage

/** Parameters for {@link buildUpdateContentMessage}. */
export interface BuildUpdateContentMessageParams {
    /** The diagram content to patch into the live viewer. */
    update: ViewerUpdate
}

/**
 * Build the message that hands a debounced keystroke's freshly-rendered diagram to the
 * live webview, for the update bridge (`buildUpdateBridgeScript`) to dispatch as
 * `sfn-set-content`.
 *
 * @param params - Message parameters
 * @returns The `updateContent` message to post via `webview.postMessage`
 *
 * @example
 * ```typescript
 * webview.postMessage(buildUpdateContentMessage({ update: renderPreviewUpdate(params) }))
 * ```
 */
export function buildUpdateContentMessage(params: BuildUpdateContentMessageParams): UpdateContentMessage {
    const { update } = params
    return {
        command: 'updateContent',
        contentHtml: update.contentHtml,
        edgeData: update.edgeData,
        stateData: update.stateData,
    }
}

/** Parameters for {@link buildRenderErrorMessage}. */
export interface BuildRenderErrorMessageParams {
    /** The error a debounced refresh threw, e.g. from malformed JSON mid-edit. */
    error: unknown
}

/**
 * Build the message reporting that a debounced refresh failed to render, so the host
 * toolbar's status chip can surface it without replacing the last good diagram.
 *
 * @param params - Message parameters
 * @returns The `renderError` message to post via `webview.postMessage`
 *
 * @example
 * ```typescript
 * try {
 *     // ...
 * } catch (error) {
 *     webview.postMessage(buildRenderErrorMessage({ error }))
 * }
 * ```
 */
export function buildRenderErrorMessage(params: BuildRenderErrorMessageParams): RenderErrorMessage {
    const { error } = params
    return {
        command: 'renderError',
        message: error instanceof Error ? error.message : String(error),
    }
}
