import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Preview } from './Preview'

const SIMPLE_ASL = JSON.stringify({
    StartAt: 'Hello',
    States: {
        Hello: { End: true, Type: 'Pass' },
    },
})

describe('Preview', () => {
    it('renders an SVG element for valid ASL in svg format', () => {
        const { container } = render(
            <Preview asl={SIMPLE_ASL} format="svg" layout="TB" theme="light" />
        )
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('shows error alert for invalid JSON', () => {
        render(<Preview asl="not valid json" format="svg" layout="TB" theme="light" />)
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('displays error message text for invalid ASL', () => {
        render(<Preview asl="{" format="svg" layout="TB" theme="light" />)
        const alert = screen.getByRole('alert')
        expect(alert.textContent).toBeTruthy()
    })

    it('renders a pre element containing mermaid code for mermaid format', () => {
        const { container } = render(
            <Preview asl={SIMPLE_ASL} format="mermaid" layout="TB" theme="light" />
        )
        const pre = container.querySelector('pre')
        expect(pre).toBeTruthy()
        expect(pre?.textContent).toContain('stateDiagram-v2')
    })

    it('renders an execution overlay when history is provided', () => {
        const history = JSON.stringify({
            events: [
                { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
                { id: 2, previousEventId: 1, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.010Z', stateEnteredEventDetails: { name: 'Hello' } },
                { id: 3, previousEventId: 2, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.120Z', stateExitedEventDetails: { name: 'Hello' } },
                { id: 4, previousEventId: 3, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.130Z' },
            ],
        })
        const { container } = render(
            <Preview asl={SIMPLE_ASL} format="svg" history={history} layout="TB" theme="light" />
        )
        // Succeeded state fill from the execution overlay.
        expect(container.querySelector('svg')?.innerHTML).toContain('#c8e6c9')
    })
})
