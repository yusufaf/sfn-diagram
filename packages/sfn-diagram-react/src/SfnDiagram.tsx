'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useSfnDiagram } from './useSfnDiagram'
import type { SfnDiagramResult, UseSfnDiagramParams } from './useSfnDiagram'

export interface SfnDiagramProps extends UseSfnDiagramParams {
    className?: string
    onError?: (error: Error) => void
    /**
     * Called when a state node is clicked. SVG format only - a click inside the
     * sandboxed `format="html"` iframe does not reach this handler, and Mermaid
     * output has no clickable elements. `stateId` is the graph node id, which
     * equals the state name for every state whose name is unique across the
     * machine; for a nested state whose name repeats elsewhere in the machine the
     * id is qualified by its scope, so read it off the rendered `data-state-id`
     * rather than assuming the bare name.
     */
    onStateClick?: (params: OnStateClickParams) => void
    style?: React.CSSProperties
    /**
     * Accessible title for the rendered iframe when `format` is `'html'`. Ignored
     * for every other format. Set this when a page renders more than one diagram
     * so screen readers can distinguish between them.
     * @default 'Step Functions diagram'
     */
    title?: string
}

/** Parameters passed to {@link SfnDiagramProps.onStateClick}. */
export interface OnStateClickParams {
    event: React.MouseEvent<HTMLDivElement>
    stateId: string
}

/**
 * Imperative handle exposed via `ref` on {@link SfnDiagram}. There is no
 * programmatic zoom/pan control - core has no public API for it yet (the
 * interactive viewer's controller is not exported from a public subpath) -
 * this handle only surfaces the rendered markup.
 */
export interface SfnDiagramHandle {
    /** The rendered SVG markup for `format="svg"`, or `null` for every other format (including an errored render). */
    getSvg(): string | null
}

export const SfnDiagram = forwardRef<SfnDiagramHandle, SfnDiagramProps>(function SfnDiagram(
    {
        className,
        onError,
        onStateClick,
        style,
        title = 'Step Functions diagram',
        ...diagramParams
    },
    ref
) {
    const result = useSfnDiagram(diagramParams)

    useImperativeHandle(
        ref,
        (): SfnDiagramHandle => ({
            getSvg: () => (result.type === 'svg' ? result.svg : null),
        }),
        [result]
    )

    // A direct click target can be a descendant (the label text, an icon) rather
    // than the node group itself, so `closest` is required - reading `event.target`
    // alone would miss most clicks.
    const handleStateClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target instanceof Element ? event.target : null
            const stateId = target?.closest('[data-state-id]')?.getAttribute('data-state-id')
            if (stateId) {
                onStateClick?.({ event, stateId })
            }
        },
        [onStateClick]
    )

    // Reporting an error is a side effect, so it belongs in an effect rather than
    // the render body: StrictMode double-invokes render in development, which
    // fired onError twice for a single real error. StrictMode also re-runs
    // effects on mount, so the reported result is tracked to keep one error to
    // one call - a consumer that toasts or logs from onError sees it once.
    const reportedResult = useRef<SfnDiagramResult | null>(null)

    useEffect(() => {
        if (result.type !== 'error') {
            reportedResult.current = null
            return
        }
        if (reportedResult.current === result) {
            return
        }
        reportedResult.current = result
        onError?.(result.error)
    }, [onError, result])

    if (result.type === 'error') {
        return null
    }

    if (result.type === 'mermaid') {
        return (
            <pre className={className} style={style}>
                {result.code}
            </pre>
        )
    }

    if (result.type === 'html') {
        return (
            <iframe
                className={className}
                sandbox="allow-scripts"
                srcDoc={result.html}
                style={style}
                title={title}
            />
        )
    }

    return (
        <div
            className={className}
            dangerouslySetInnerHTML={{ __html: result.svg }}
            onClick={onStateClick ? handleStateClick : undefined}
            style={style}
        />
    )
})
