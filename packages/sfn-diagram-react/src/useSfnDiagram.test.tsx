import { renderHook } from '@testing-library/react'
import type { AslDefinition } from 'sfn-diagram'
import { describe, expect, it } from 'vitest'
import { useSfnDiagram } from './useSfnDiagram'

const HELLO_WORLD: AslDefinition = {
    Comment: 'Hello World',
    StartAt: 'HelloWorld',
    States: {
        HelloWorld: { End: true, Result: 'Hello, World!', Type: 'Pass' },
    },
}

const INVALID = { StartAt: 'Missing', States: {} }

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
})
