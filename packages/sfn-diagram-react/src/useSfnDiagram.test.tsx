import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSfnDiagram } from './useSfnDiagram'

const HELLO_WORLD = {
    Comment: 'Hello World',
    StartAt: 'HelloWorld',
    States: {
        HelloWorld: { End: true, Result: 'Hello, World!', Type: 'Pass' },
    },
}

const INVALID = { StartAt: 'Missing', States: {} }

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
})
