import { buildUpdateBridgeScript } from '../updateBridge'

/** An event the update bridge dispatched on the fake `document`. */
export interface DispatchedEvent {
    detail: unknown
    type: string
}

/** A running update bridge, wired to fakes instead of a webview. */
export interface RunningUpdateBridge {
    /** Every event the bridge dispatched on `document`, in order. */
    dispatched: DispatchedEvent[]
    /** Deliver a host message to the bridge, as `window.postMessage` would. */
    post: (data: unknown) => void
}

/**
 * Run the script from `buildUpdateBridgeScript` in Node against a fake `window`,
 * `document` and `CustomEvent`, so tests can post host messages to it and inspect what it
 * hands the viewer. Test-only: nothing outside `*.test.ts` imports it, so it is never
 * bundled.
 *
 * @returns The fake bridge's dispatched events and a way to post messages to it
 *
 * @example
 * ```typescript
 * const bridge = runUpdateBridge()
 * bridge.post(buildUpdateContentMessage({ update }))
 * bridge.dispatched[0].type // => 'sfn-set-content'
 * ```
 */
export function runUpdateBridge(): RunningUpdateBridge {
    const dispatched: DispatchedEvent[] = []
    let messageHandler: ((event: { data: unknown }) => void) | undefined

    class FakeCustomEvent {
        detail: unknown
        type: string

        constructor(type: string, init?: { detail?: unknown }) {
            this.detail = init?.detail
            this.type = type
        }
    }

    const fakeWindow = {
        addEventListener: (type: string, handler: (event: { data: unknown }) => void) => {
            if (type === 'message') messageHandler = handler
        },
    }
    const fakeDocument = {
        dispatchEvent: (event: DispatchedEvent) => {
            dispatched.push({ detail: event.detail, type: event.type })
            return true
        },
        querySelector: () => null,
    }

    new Function('window', 'document', 'CustomEvent', buildUpdateBridgeScript())(
        fakeWindow,
        fakeDocument,
        FakeCustomEvent,
    )

    return {
        dispatched,
        post: (data: unknown) => {
            if (!messageHandler) throw new Error('the update bridge registered no message listener')
            messageHandler({ data })
        },
    }
}
