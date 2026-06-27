import { useMemo } from 'react'
import { generateMermaid, generateSvg } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'

export interface SfnDiagramProps {
    className?: string
    definition: object | string
    format?: 'mermaid' | 'svg'
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
                const output = generateMermaid({ aslDefinition: asl })
                return { type: 'mermaid', code: output.code }
            }
            const output = generateSvg({ aslDefinition: asl, layout, theme })
            return { type: 'svg', svg: output.svg }
        } catch (err) {
            return { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
        }
    }, [asl, format, layout, theme])

    if (result.type === 'error') {
        onError?.(result.error)
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
