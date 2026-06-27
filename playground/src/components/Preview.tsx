import { useMemo } from 'react'
import { generateMermaid, generateSvg } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'

interface PreviewProps {
    asl: string
    format: 'mermaid' | 'svg'
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
    layout: LayoutDirection
    theme: ThemeOption
}

function renderDiagram(params: RenderDiagramParams): RenderResult {
    const { asl, format, layout, theme } = params
    try {
        if (format === 'mermaid') {
            const { code } = generateMermaid({ aslDefinition: asl })
            return { code, type: 'mermaid' }
        }
        const { svg } = generateSvg({ aslDefinition: asl, layout, theme })
        return { svg, type: 'svg' }
    } catch (err) {
        return {
            error: err instanceof Error ? err.message : String(err),
            type: 'error',
        }
    }
}

export function Preview({ asl, format, layout, theme }: PreviewProps) {
    const result = useMemo(
        () => renderDiagram({ asl, format, layout, theme }),
        [asl, format, layout, theme]
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
