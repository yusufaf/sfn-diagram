'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
    generateExecution,
    generateMermaid,
    generateMermaidExecution,
    generateSvg,
} from 'sfn-diagram'
import type { DiagramOptions, ExecutionHistoryInput, LayoutDirection, ThemeOption } from 'sfn-diagram'

export interface SfnDiagramProps extends Pick<DiagramOptions, 'catchHandling' | 'collapse'> {
    className?: string
    definition: object | string
    format?: 'mermaid' | 'svg'
    /**
     * Optional execution history. When provided, the diagram is rendered as an
     * execution overlay: states are coloured by outcome, the taken path is
     * emphasized, and per-state duration / retry counts are annotated.
     * Accepts a GetExecutionHistory events array, the raw command output, or a
     * JSON string of either.
     */
    history?: ExecutionHistoryInput
    layout?: LayoutDirection
    onError?: (error: Error) => void
    style?: React.CSSProperties
    theme?: ThemeOption
}

type DiagramResult =
    | { type: 'error'; error: Error }
    | { type: 'mermaid'; code: string }
    | { type: 'svg'; svg: string }

// Core's mergeOptions does `{ ...DEFAULT_DIAGRAM_OPTIONS, ...options }`, so a key
// present with value `undefined` overrides the default rather than falling back to
// it - most defaults tolerate that, but catchHandling's `mode === 'show'` check does
// not, silently switching to 'hide'. Omitting unset keys here keeps every prop this
// component forwards absent-when-not-passed instead of present-and-undefined.
function omitUndefinedValues<Options extends Record<string, unknown>>(
    options: Options
): Partial<Options> {
    const result: Partial<Options> = {}
    for (const key of Object.keys(options) as (keyof Options)[]) {
        if (options[key] !== undefined) {
            result[key] = options[key]
        }
    }
    return result
}

export function SfnDiagram({
    catchHandling,
    className,
    collapse,
    definition,
    format = 'svg',
    history,
    layout = 'TB',
    onError,
    style,
    theme = 'light',
}: SfnDiagramProps) {
    const asl = useMemo(
        () => (typeof definition === 'string' ? definition : JSON.stringify(definition)),
        [definition]
    )

    const result = useMemo((): DiagramResult => {
        try {
            const diagramOptions = omitUndefinedValues({ catchHandling, collapse, layout, theme })
            if (format === 'mermaid') {
                const output = history
                    ? generateMermaidExecution({ aslDefinition: asl, history, ...diagramOptions })
                    : generateMermaid({ aslDefinition: asl, ...diagramOptions })
                return { type: 'mermaid', code: output.code }
            }
            const output = history
                ? generateExecution({ aslDefinition: asl, history, ...diagramOptions })
                : generateSvg({ aslDefinition: asl, ...diagramOptions })
            return { type: 'svg', svg: output.svg }
        } catch (err) {
            return { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
        }
    }, [asl, catchHandling, collapse, format, history, layout, theme])

    // Reporting an error is a side effect, so it belongs in an effect rather than
    // the render body: StrictMode double-invokes render in development, which
    // fired onError twice for a single real error. StrictMode also re-runs
    // effects on mount, so the reported result is tracked to keep one error to
    // one call - a consumer that toasts or logs from onError sees it once.
    const reportedResult = useRef<DiagramResult | null>(null)

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

    return (
        <div
            className={className}
            dangerouslySetInnerHTML={{ __html: result.svg }}
            style={style}
        />
    )
}
