'use client'

import { useMemo } from 'react'
import {
    generateDiff,
    generateExecution,
    generateHtml,
    generateMermaid,
    generateMermaidDiff,
    generateMermaidExecution,
    generateSvg,
} from 'sfn-diagram'
import type {
    DiagramOptions,
    DiffOutput,
    ExecutionHistoryInput,
    ExecutionOutput,
    HtmlOutput,
    MermaidDiffOutput,
    MermaidExecutionOutput,
    MermaidOutput,
    SvgOutput,
} from 'sfn-diagram'

export interface UseSfnDiagramParams
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
     * type's `Pick<DiagramOptions, ...>` list - `layout`, `theme`, and the rest -
     * since core's diff-specific function accepts only the two definitions. The
     * SVG diff honours them.
     */
    before?: object | string
    definition: object | string
    /**
     * Output format. `'svg'` and `'mermaid'` render static markup; `'html'` renders
     * the interactive pan/zoom/search viewer as a self-contained HTML document.
     * Cannot be combined with `history`.
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
}

/** Result of {@link useSfnDiagram} - the raw output of whichever core function the params select. */
export type SfnDiagramResult =
    | { error: Error; type: 'error' }
    | {
          height: number
          html: string
          metadata: HtmlOutput['metadata']
          type: 'html'
          width: number
      }
    | {
          code: string
          metadata: MermaidDiffOutput['metadata'] | MermaidExecutionOutput['metadata'] | MermaidOutput['metadata']
          type: 'mermaid'
      }
    | {
          height: number
          metadata: DiffOutput['metadata'] | ExecutionOutput['metadata'] | SvgOutput['metadata']
          svg: string
          type: 'svg'
          width: number
      }

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
// not, silently switching to 'hide'. Omitting unset keys here keeps every option
// this hook forwards absent-when-not-passed instead of present-and-undefined.
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

/**
 * Generate a Step Functions diagram and return the raw output - SVG or HTML
 * markup, Mermaid code, dimensions, and metadata - without rendering it.
 *
 * This is the same generation logic `<SfnDiagram>` runs internally, exposed
 * directly for a consumer who needs the underlying string or metadata rather
 * than mounted markup - for example, building a data URI for `<img src>`, a
 * download button, or a custom render target.
 *
 * @param params - The same option-bearing props `<SfnDiagram>` accepts, minus
 * the presentational ones (`className`, `onError`, `onStateClick`, `style`,
 * `title`).
 * @returns A {@link SfnDiagramResult} discriminated union. Errors are returned
 * as `{ type: 'error', error }` rather than thrown.
 *
 * @example
 * ```tsx
 * function DownloadSvgButton({ definition }: { definition: object }) {
 *     const result = useSfnDiagram({ definition })
 *     if (result.type !== 'svg') return null
 *
 *     const href = `data:image/svg+xml;base64,${btoa(result.svg)}`
 *     return <a download="diagram.svg" href={href}>Download SVG</a>
 * }
 * ```
 */
export function useSfnDiagram(params: UseSfnDiagramParams): SfnDiagramResult {
    const {
        before,
        catchHandling,
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
        showIcons,
        showVariables,
        theme = 'light',
    } = params

    const asl = useMemo(() => toAslString({ definition }), [definition])
    const beforeAsl = useMemo(
        () => (before === undefined ? undefined : toAslString({ definition: before })),
        [before]
    )

    return useMemo((): SfnDiagramResult => {
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
                    return { code: output.code, metadata: output.metadata, type: 'mermaid' }
                }
                const output = generateDiff({ after: asl, before: beforeAsl, ...diagramOptions })
                return {
                    height: output.height,
                    metadata: output.metadata,
                    svg: output.svg,
                    type: 'svg',
                    width: output.width,
                }
            }
            if (format === 'html') {
                if (history) {
                    throw new Error('history and format="html" cannot be combined')
                }
                const output = generateHtml({ aslDefinition: asl, ...diagramOptions })
                return {
                    height: output.height,
                    html: output.html,
                    metadata: output.metadata,
                    type: 'html',
                    width: output.width,
                }
            }
            if (format === 'mermaid') {
                const output = history
                    ? generateMermaidExecution({ aslDefinition: asl, history, ...diagramOptions })
                    : generateMermaid({ aslDefinition: asl, ...diagramOptions })
                return { code: output.code, metadata: output.metadata, type: 'mermaid' }
            }
            const output = history
                ? generateExecution({ aslDefinition: asl, history, ...diagramOptions })
                : generateSvg({ aslDefinition: asl, ...diagramOptions })
            return {
                height: output.height,
                metadata: output.metadata,
                svg: output.svg,
                type: 'svg',
                width: output.width,
            }
        } catch (err) {
            return { error: err instanceof Error ? err : new Error(String(err)), type: 'error' }
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
}
