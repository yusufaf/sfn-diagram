'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
    generateDiff,
    generateExecution,
    generateHtml,
    generateMermaid,
    generateMermaidDiff,
    generateMermaidExecution,
    generateSvg,
} from 'sfn-diagram'
import type { DiagramOptions, ExecutionHistoryInput } from 'sfn-diagram'

export interface SfnDiagramProps
    extends Pick<
        DiagramOptions,
        | 'catchHandling'
        | 'collapse'
        | 'edgeOverrides'
        | 'edgeStyle'
        | 'iconPosition'
        | 'iconSize'
        | 'layout'
        | 'nodeOverrides'
        | 'showIcons'
        | 'showVariables'
        | 'theme'
    > {
    /**
     * When set, `definition` is treated as the *after* side of a diff and `before`
     * as the *original* side: the rendered diagram highlights added, modified, and
     * removed states rather than the plain machine. Accepts an ASL object or a
     * JSON string. Cannot be combined with `history` or `format="html"` - core has
     * no diff API for either combination.
     *
     * The Mermaid diff (`generateMermaidDiff`) ignores every option in this
     * component's `Pick<DiagramOptions, ...>` list - `layout`, `theme`, and the
     * rest - since core's diff-specific function accepts only the two
     * definitions. The SVG diff honours them.
     */
    before?: object | string
    className?: string
    definition: object | string
    /**
     * Output format. `'svg'` and `'mermaid'` render static markup; `'html'` renders
     * the interactive pan/zoom/search viewer in a sandboxed `<iframe srcDoc>` -
     * an isolated document, so page CSS does not reach it and `onStateClick` does
     * not fire from inside it. Cannot be combined with `history`.
     * @default 'svg'
     */
    format?: 'html' | 'mermaid' | 'svg'
    /**
     * Optional execution history. When provided, the diagram is rendered as an
     * execution overlay: states are coloured by outcome, the taken path is
     * emphasized, and per-state duration / retry counts are annotated.
     * Accepts a GetExecutionHistory events array, the raw command output, or a
     * JSON string of either. Cannot be combined with `format="html"`.
     */
    history?: ExecutionHistoryInput
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

type DiagramResult =
    | { type: 'error'; error: Error }
    | { type: 'html'; html: string }
    | { type: 'mermaid'; code: string }
    | { type: 'svg'; svg: string }

interface ToAslStringParams {
    definition: object | string
}

function toAslString(params: ToAslStringParams): string {
    const { definition } = params
    return typeof definition === 'string' ? definition : JSON.stringify(definition)
}

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
    before,
    catchHandling,
    className,
    collapse,
    definition,
    edgeOverrides,
    edgeStyle,
    format = 'svg',
    history,
    iconPosition,
    iconSize,
    layout = 'TB',
    nodeOverrides,
    onError,
    onStateClick,
    showIcons,
    showVariables,
    style,
    theme = 'light',
    title = 'Step Functions diagram',
}: SfnDiagramProps) {
    const asl = useMemo(() => toAslString({ definition }), [definition])
    const beforeAsl = useMemo(
        () => (before === undefined ? undefined : toAslString({ definition: before })),
        [before]
    )

    const result = useMemo((): DiagramResult => {
        try {
            const diagramOptions = omitUndefinedValues({
                catchHandling,
                collapse,
                edgeOverrides,
                edgeStyle,
                iconPosition,
                iconSize,
                layout,
                nodeOverrides,
                showIcons,
                showVariables,
                theme,
            })
            if (beforeAsl !== undefined) {
                if (history) {
                    throw new Error('history and before cannot be combined')
                }
                if (format === 'html') {
                    throw new Error('before and format="html" cannot be combined')
                }
                if (format === 'mermaid') {
                    const output = generateMermaidDiff({ after: asl, before: beforeAsl })
                    return { type: 'mermaid', code: output.code }
                }
                const output = generateDiff({ after: asl, before: beforeAsl, ...diagramOptions })
                return { type: 'svg', svg: output.svg }
            }
            if (format === 'html') {
                if (history) {
                    throw new Error('history and format="html" cannot be combined')
                }
                const output = generateHtml({ aslDefinition: asl, ...diagramOptions })
                return { type: 'html', html: output.html }
            }
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
    }, [
        asl,
        beforeAsl,
        catchHandling,
        collapse,
        edgeOverrides,
        edgeStyle,
        format,
        history,
        iconPosition,
        iconSize,
        layout,
        nodeOverrides,
        showIcons,
        showVariables,
        theme,
    ])

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
}
