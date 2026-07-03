import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SfnDiagram } from './SfnDiagram'

const HELLO_WORLD = {
    Comment: 'Hello World',
    StartAt: 'HelloWorld',
    States: {
        HelloWorld: { End: true, Result: 'Hello, World!', Type: 'Pass' },
    },
}

const HELLO_WORLD_STR = JSON.stringify(HELLO_WORLD)

describe('SfnDiagram', () => {
    describe('SVG format', () => {
        it('renders SVG container for valid definition object', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD} />)
            const svg = container.querySelector('svg')
            expect(svg).toBeInTheDocument()
        })

        it('renders SVG container for valid definition string', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD_STR} />)
            const svg = container.querySelector('svg')
            expect(svg).toBeInTheDocument()
        })

        it('forwards className to wrapper div', () => {
            const { container } = render(
                <SfnDiagram className="my-diagram" definition={HELLO_WORLD} />
            )
            expect(container.firstChild).toHaveClass('my-diagram')
        })

        it('forwards style to wrapper div', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} style={{ width: '500px' }} />
            )
            expect(container.firstChild).toHaveStyle({ width: '500px' })
        })
    })

    describe('Mermaid format', () => {
        it('renders pre element with mermaid code', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="mermaid" />
            )
            const pre = container.querySelector('pre')
            expect(pre).toBeInTheDocument()
            expect(pre?.textContent).toContain('stateDiagram-v2')
        })
    })

    describe('Error handling', () => {
        it('returns null and calls onError for invalid JSON string', () => {
            const onError = vi.fn()
            const { container } = render(
                <SfnDiagram definition="not json" onError={onError} />
            )
            expect(container.firstChild).toBeNull()
            expect(onError).toHaveBeenCalledWith(expect.any(Error))
        })

        it('returns null and calls onError for invalid definition object', () => {
            const onError = vi.fn()
            const { container } = render(
                // Structurally invalid at runtime (missing States), but a valid `object` prop
                <SfnDiagram definition={{ StartAt: 'Missing' }} onError={onError} />
            )
            expect(container.firstChild).toBeNull()
            expect(onError).toHaveBeenCalledWith(expect.any(Error))
        })

        it('renders null without onError when definition is invalid', () => {
            const { container } = render(<SfnDiagram definition="bad json" />)
            expect(container.firstChild).toBeNull()
        })
    })
})
