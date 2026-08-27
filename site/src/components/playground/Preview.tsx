import { useMemo } from 'react'
import {
    generateExecution,
    generateMermaid,
    generateMermaidExecution,
    generateSvg,
} from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'

interface PreviewProps {
    asl: string
    format: 'mermaid' | 'svg'
    /** When set, the diagram is rendered as an execution overlay for this history. */
    history?: string
    layout: LayoutDirection
    theme: ThemeOption
}

interface RenderResult {
    code?: string
    error?: string
    svg?: string
    type: 'error' | 'mermaid' | 'svg'
}

interface RenderDiagramParams {
    asl: string
    format: 'mermaid' | 'svg'
    history?: string
    layout: LayoutDirection
    theme: ThemeOption
}

function renderDiagram(params: RenderDiagramParams): RenderResult {
    const { asl, format, history, layout, theme } = params
    try {
        if (format === 'mermaid') {
            const { code } = history
                ? generateMermaidExecution({ aslDefinition: asl, history })
                : generateMermaid({ aslDefinition: asl })
            return { code, type: 'mermaid' }
        }
        const { svg } = history
            ? generateExecution({ aslDefinition: asl, history, layout, theme })
            : generateSvg({ aslDefinition: asl, layout, theme })
        return { svg, type: 'svg' }
    } catch (err) {
        return {
            error: err instanceof Error ? err.message : String(err),
            type: 'error',
        }
    }
}

export function Preview({ asl, format, history, layout, theme }: PreviewProps) {
    const result = useMemo(
        () => renderDiagram({ asl, format, history, layout, theme }),
        [asl, format, history, layout, theme]
    )

    if (result.type === 'error') {
        return (
            <div className="error-banner" role="alert">
                {result.error}
            </div>
        )
    }

    if (result.type === 'mermaid') {
        return <pre className="mermaid-code">{result.code}</pre>
    }

    return (
        <div
            className="svg-preview"
            dangerouslySetInnerHTML={{ __html: result.svg! }}
        />
    )
}
