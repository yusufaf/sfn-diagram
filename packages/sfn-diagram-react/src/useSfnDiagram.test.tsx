import { renderHook } from '@testing-library/react'
import { createLayoutCache } from 'sfn-diagram'
import type { AslDefinition, LayoutCache } from 'sfn-diagram'
import { describe, expect, it } from 'vitest'
import { useSfnDiagram } from './useSfnDiagram'
import type { UseSfnDiagramParams } from './useSfnDiagram'

const HELLO_WORLD: AslDefinition = {
    Comment: 'Hello World',
    StartAt: 'HelloWorld',
    States: {
        HelloWorld: { End: true, Result: 'Hello, World!', Type: 'Pass' },
    },
}

const INVALID = { StartAt: 'Missing', States: {} }

const DIFF_BEFORE: AslDefinition = {
    StartAt: 'StateA',
    States: {
        StateA: { Next: 'StateB', Type: 'Pass' },
        StateB: { Type: 'Succeed' },
    },
}

const DIFF_AFTER: AslDefinition = {
    StartAt: 'StateA',
    States: {
        StateA: { Next: 'StateC', Type: 'Pass' },
        StateC: { Type: 'Succeed' },
    },
}

const DIFF_HISTORY = {
    events: [
        { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
        {
            id: 2,
            previousEventId: 1,
            type: 'PassStateEntered',
            timestamp: '2024-01-01T00:00:00.100Z',
            stateEnteredEventDetails: { name: 'StateA' },
        },
        {
            id: 3,
            previousEventId: 2,
            type: 'PassStateExited',
            timestamp: '2024-01-01T00:00:00.200Z',
            stateExitedEventDetails: { name: 'StateA' },
        },
        { id: 4, previousEventId: 3, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.300Z' },
    ],
}

const ABORTED_HISTORY = {
    events: [
        { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
        {
            id: 2,
            previousEventId: 1,
            type: 'PassStateEntered',
            timestamp: '2024-01-01T00:00:00.100Z',
            stateEnteredEventDetails: { name: 'HelloWorld' },
        },
        { id: 3, previousEventId: 2, type: 'ExecutionAborted', timestamp: '2024-01-01T00:00:00.200Z' },
    ],
}

const CUSTOM_COLORS: UseSfnDiagramParams['customColors'] = {
    Pass: { fill: '#123456', stroke: '#abcdef' },
}

// StateA stays unchanged, so the diff draws it with its state-type colours.
const DIFF_AFTER_UNCHANGED_PASS: AslDefinition = {
    StartAt: 'StateA',
    States: {
        StateA: { Next: 'StateB', Type: 'Pass' },
        StateB: { Comment: 'changed', Type: 'Succeed' },
    },
}

describe('useSfnDiagram', () => {
    it('returns svg output with surfaced metadata for a valid definition', () => {
        const { result } = renderHook(() => useSfnDiagram({ definition: HELLO_WORLD }))

        expect(result.current.type).toBe('svg')
        if (result.current.type !== 'svg') {
            throw new Error('expected svg result')
        }
        expect(result.current.svg.startsWith('<svg')).toBe(true)
        expect(result.current.height).toBeGreaterThan(0)
        expect(result.current.width).toBeGreaterThan(0)
        expect(result.current.metadata.nodeCount).toBe(1)
    })

    it('returns mermaid output with metadata for format: mermaid', () => {
        const { result } = renderHook(() =>
            useSfnDiagram({ definition: HELLO_WORLD, format: 'mermaid' })
        )

        expect(result.current.type).toBe('mermaid')
        if (result.current.type !== 'mermaid') {
            throw new Error('expected mermaid result')
        }
        expect(result.current.code).toContain('stateDiagram-v2')
        expect(result.current.metadata.stateCount).toBe(1)
    })

    it('returns an error result without throwing for an invalid definition', () => {
        const { result } = renderHook(() => useSfnDiagram({ definition: INVALID }))

        expect(result.current.type).toBe('error')
        if (result.current.type !== 'error') {
            throw new Error('expected error result')
        }
        expect(result.current.error).toBeInstanceOf(Error)
    })

    it('is referentially stable across a re-render with unchanged params', () => {
        const { rerender, result } = renderHook(
            (params) => useSfnDiagram(params),
            { initialProps: { definition: HELLO_WORLD } }
        )
        const firstResult = result.current

        rerender({ definition: HELLO_WORLD })

        expect(result.current).toBe(firstResult)
    })

    it('reports aborted states in the execution metadata', () => {
        const { result } = renderHook(() =>
            useSfnDiagram({ definition: HELLO_WORLD, history: JSON.stringify(ABORTED_HISTORY) })
        )

        if (result.current.type !== 'svg' || !('aborted' in result.current.metadata)) {
            throw new Error('expected an execution svg result')
        }
        expect(result.current.metadata.aborted).toEqual(['HelloWorld'])
    })

    it('prefixes marker ids per hook instance', () => {
        const firstId = (svgResult: ReturnType<typeof useSfnDiagram>): string => {
            if (svgResult.type !== 'svg') {
                throw new Error('expected svg result')
            }
            return /\bid="([^"]+)"/.exec(svgResult.svg)?.[1] ?? ''
        }
        const first = renderHook(() => useSfnDiagram({ definition: HELLO_WORLD }))
        const second = renderHook(() => useSfnDiagram({ definition: HELLO_WORLD }))

        const firstMarkerId = firstId(first.result.current)
        const secondMarkerId = firstId(second.result.current)
        expect(firstMarkerId).toMatch(/^sfn-/)
        expect(secondMarkerId).toMatch(/^sfn-/)
        expect(firstMarkerId).not.toBe(secondMarkerId)
    })

    describe('format: html with history and before', () => {
        it('returns html with execution metadata for format: html with history', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({
                    definition: HELLO_WORLD,
                    format: 'html',
                    history: JSON.stringify(ABORTED_HISTORY),
                })
            )

            if (result.current.type !== 'html') {
                throw new Error('expected html result')
            }
            expect(result.current.metadata.execution?.aborted).toEqual(['HelloWorld'])
            expect(result.current.metadata.diff).toBeUndefined()
        })

        it('returns html with diff metadata for format: html with before', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({ before: DIFF_BEFORE, definition: DIFF_AFTER, format: 'html' })
            )

            if (result.current.type !== 'html') {
                throw new Error('expected html result')
            }
            expect(result.current.metadata.diff).toEqual({
                added: ['StateC'],
                modified: ['StateA'],
                removed: ['StateB'],
                unchanged: [],
            })
            expect(result.current.metadata.execution).toBeUndefined()
        })

        it('composes before and history for format: html', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({
                    before: DIFF_BEFORE,
                    definition: DIFF_AFTER,
                    format: 'html',
                    history: DIFF_HISTORY,
                })
            )

            if (result.current.type !== 'html') {
                throw new Error('expected html result')
            }
            expect(result.current.metadata.diff?.added).toEqual(['StateC'])
            expect(result.current.metadata.execution?.succeeded).toEqual(['StateA'])
        })

        it.each(['svg', 'mermaid'] as const)(
            'returns an error for history and before with format: %s',
            (format) => {
                const { result } = renderHook(() =>
                    useSfnDiagram({
                        before: DIFF_BEFORE,
                        definition: DIFF_AFTER,
                        format,
                        history: DIFF_HISTORY,
                    })
                )

                expect(result.current.type).toBe('error')
            }
        )
    })

    describe('cache', () => {
        const CACHE_CASES: Array<{ label: string; params: UseSfnDiagramParams }> = [
            { label: 'SVG diff', params: { before: DIFF_BEFORE, definition: DIFF_AFTER } },
            {
                label: 'execution overlay',
                params: { definition: HELLO_WORLD, history: JSON.stringify(ABORTED_HISTORY) },
            },
            { label: 'html viewer', params: { definition: HELLO_WORLD, format: 'html' } },
        ]

        it('reuses layouts through the cache prop', () => {
            const cache = createLayoutCache()
            const initialProps: UseSfnDiagramParams = { cache, definition: HELLO_WORLD }
            const { rerender } = renderHook(
                (params: UseSfnDiagramParams) => useSfnDiagram(params),
                { initialProps }
            )
            expect(cache.stats().misses).toBeGreaterThanOrEqual(1)
            expect(cache.stats().hits).toBe(0)

            rerender({ cache, definition: HELLO_WORLD, theme: 'dark' })

            expect(cache.stats().hits).toBe(1)
        })

        it.each(CACHE_CASES)('forwards cache to the $label', ({ params }) => {
            const cache = createLayoutCache()
            renderHook(() => useSfnDiagram({ ...params, cache }))

            expect(cache.stats().misses).toBeGreaterThan(0)
        })

        const MERMAID_CASES: Array<{ label: string; params: UseSfnDiagramParams }> = [
            { label: 'plain', params: { definition: HELLO_WORLD, format: 'mermaid' } },
            {
                label: 'diff',
                params: { before: DIFF_BEFORE, definition: DIFF_AFTER, format: 'mermaid' },
            },
            {
                label: 'execution',
                params: {
                    definition: HELLO_WORLD,
                    format: 'mermaid',
                    history: JSON.stringify(ABORTED_HISTORY),
                },
            },
        ]

        it.each(MERMAID_CASES)(
            'does not consult the cache for the $label Mermaid output',
            ({ params }) => {
                const cache = createLayoutCache()
                const { result } = renderHook(() => useSfnDiagram({ ...params, cache }))

                expect(result.current.type).toBe('mermaid')
                expect(cache.stats()).toEqual({ entries: 0, hits: 0, misses: 0 })
            }
        )

        it('recomputes when the cache prop changes identity', () => {
            const firstCache = createLayoutCache()
            const { rerender, result } = renderHook(
                (params: UseSfnDiagramParams) => useSfnDiagram(params),
                { initialProps: { cache: firstCache, definition: HELLO_WORLD } }
            )
            const firstResult = result.current
            const secondCache = createLayoutCache()

            rerender({ cache: secondCache, definition: HELLO_WORLD })

            expect(result.current).not.toBe(firstResult)
            expect(secondCache.stats().misses).toBeGreaterThan(0)
        })

        it('returns an error result for an object not made by createLayoutCache', () => {
            const fakeCache = {
                clear() {},
                stats() {
                    return { entries: 0, hits: 0, misses: 0 }
                },
            } as LayoutCache
            const { result } = renderHook(() =>
                useSfnDiagram({ cache: fakeCache, definition: HELLO_WORLD })
            )

            if (result.current.type !== 'error') {
                throw new Error('expected error result')
            }
            expect(result.current.error).toBeInstanceOf(TypeError)
        })
    })

    describe('customColors', () => {
        const MERMAID_COLOR_CASES: Array<{ label: string; params: UseSfnDiagramParams }> = [
            { label: 'plain', params: { definition: HELLO_WORLD, format: 'mermaid' } },
            {
                label: 'diff',
                params: { before: DIFF_BEFORE, definition: DIFF_AFTER, format: 'mermaid' },
            },
            {
                label: 'execution',
                params: {
                    definition: HELLO_WORLD,
                    format: 'mermaid',
                    history: JSON.stringify(ABORTED_HISTORY),
                },
            },
        ]

        it('colours the state type in the SVG', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({ customColors: CUSTOM_COLORS, definition: HELLO_WORLD })
            )

            if (result.current.type !== 'svg') {
                throw new Error('expected svg result')
            }
            expect(result.current.svg).toContain('fill="#123456"')
            expect(result.current.svg).toContain('stroke="#abcdef"')
        })

        it('colours an unchanged state in the SVG diff', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({
                    before: DIFF_BEFORE,
                    customColors: CUSTOM_COLORS,
                    definition: DIFF_AFTER_UNCHANGED_PASS,
                })
            )

            if (result.current.type !== 'svg') {
                throw new Error('expected svg result')
            }
            expect(result.current.metadata).toMatchObject({ unchanged: ['StateA'] })
            expect(result.current.svg).toContain('fill="#123456"')
        })

        it('colours an unchanged state in the Mermaid diff', () => {
            const { result } = renderHook(() =>
                useSfnDiagram({
                    before: DIFF_BEFORE,
                    customColors: CUSTOM_COLORS,
                    definition: DIFF_AFTER_UNCHANGED_PASS,
                    format: 'mermaid',
                })
            )

            if (result.current.type !== 'mermaid') {
                throw new Error('expected mermaid result')
            }
            expect(result.current.code).toContain('class StateA passState')
            expect(result.current.code).toContain('classDef passState fill:#123456,stroke:#abcdef')
        })

        // These prove the option reaches core. In the diff case (StateA modified) and
        // the execution case (every state takes a run-status class) no state is drawn
        // with the Pass classDef.
        it.each(MERMAID_COLOR_CASES)(
            'sets the state-type classDef in the $label Mermaid output',
            ({ params }) => {
                const { result } = renderHook(() =>
                    useSfnDiagram({ ...params, customColors: CUSTOM_COLORS })
                )

                if (result.current.type !== 'mermaid') {
                    throw new Error('expected mermaid result')
                }
                expect(result.current.code).toContain('classDef passState fill:#123456,stroke:#abcdef')
            }
        )

        it('recomputes when customColors changes', () => {
            const initialProps: UseSfnDiagramParams = {
                customColors: CUSTOM_COLORS,
                definition: HELLO_WORLD,
            }
            const { rerender, result } = renderHook(
                (params: UseSfnDiagramParams) => useSfnDiagram(params),
                { initialProps }
            )

            rerender({ customColors: { Pass: { fill: '#654321' } }, definition: HELLO_WORLD })

            if (result.current.type !== 'svg') {
                throw new Error('expected svg result')
            }
            expect(result.current.svg).toContain('fill="#654321"')
            expect(result.current.svg).not.toContain('fill="#123456"')
        })
    })
})
