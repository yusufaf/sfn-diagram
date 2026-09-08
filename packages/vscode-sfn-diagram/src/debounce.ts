/** Parameters for {@link createDebouncer}. */
export interface CreateDebouncerParams<Value> {
    /** Milliseconds to wait after the last `schedule()` call before `run` fires. */
    delayMs: number
    /** Called with the most recently scheduled value once the delay elapses. */
    run: (value: Value) => void
}

/** A trailing-edge debouncer created by {@link createDebouncer}. */
export interface Debouncer<Value> {
    /** Cancel a pending call, if one is scheduled. Idempotent. */
    cancel(): void
    /** Schedule `run` to fire with `value` after the configured delay, replacing any pending call. */
    schedule(value: Value): void
}

/**
 * Create a trailing-edge debouncer: `schedule()` replaces any pending call rather than
 * queuing another one, so a burst of calls within `delayMs` of each other collapses
 * into a single `run` invocation with the last scheduled value.
 *
 * Used to coalesce a fast-typing user's keystrokes into one diagram refresh, rather
 * than re-parsing and re-rendering on every single character.
 *
 * @param params - Debouncer parameters
 * @returns A handle to schedule or cancel the debounced call
 *
 * @example
 * ```typescript
 * const debouncer = createDebouncer({ delayMs: 200, run: (content) => refresh(content) })
 * debouncer.schedule(editor.document.getText())
 * // ... later, if the panel closes before it fires
 * debouncer.cancel()
 * ```
 */
export function createDebouncer<Value>(params: CreateDebouncerParams<Value>): Debouncer<Value> {
    const { delayMs, run } = params
    let handle: ReturnType<typeof setTimeout> | undefined

    return {
        cancel(): void {
            if (handle !== undefined) {
                clearTimeout(handle)
                handle = undefined
            }
        },
        schedule(value: Value): void {
            if (handle !== undefined) {
                clearTimeout(handle)
            }
            handle = setTimeout(() => {
                handle = undefined
                run(value)
            }, delayMs)
        },
    }
}
