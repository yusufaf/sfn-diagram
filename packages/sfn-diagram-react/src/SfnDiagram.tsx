'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
    generateExecution,
    generateMermaid,
    generateMermaidExecution,
    generateSvg,
} from 'sfn-diagram'
import type { ExecutionHistoryInput, LayoutDirection, ThemeOption } from 'sfn-diagram'

export interface SfnDiagramProps {
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

export function SfnDiagram({
    className,
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
            if (format === 'mermaid') {
                const output = history
                    ? generateMermaidExecution({ aslDefinition: asl, history, layout, theme })
                    : generateMermaid({ aslDefinition: asl, layout, theme })
                return { type: 'mermaid', code: output.code }
            }
            const output = history
                ? generateExecution({ aslDefinition: asl, history, layout, theme })
                : generateSvg({ aslDefinition: asl, layout, theme })
            return { type: 'svg', svg: output.svg }
        } catch (err) {
            return { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
        }
    }, [asl, format, history, layout, theme])

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
