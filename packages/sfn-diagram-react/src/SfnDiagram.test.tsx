import { fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
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

const WITH_PARALLEL = {
    StartAt: 'DoParallel',
    States: {
        DoParallel: {
            Branches: [
                {
                    StartAt: 'BranchAWork',
                    States: {
                        BranchAWork: { End: true, Type: 'Pass' },
                    },
                },
                {
                    StartAt: 'BranchBWork',
                    States: {
                        BranchBWork: { End: true, Type: 'Pass' },
                    },
                },
            ],
            End: true,
            Type: 'Parallel',
        },
    },
}

const TASK_WITH_LAMBDA = {
    StartAt: 'InvokeLambda',
    States: {
        InvokeLambda: {
            End: true,
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ProcessData',
            Type: 'Task',
        },
    },
}

const WITH_ASSIGN = {
    StartAt: 'LoadTotal',
    States: {
        LoadTotal: {
            Assign: { total: '$.total' },
            Next: 'Done',
            Type: 'Pass',
        },
        Done: { Type: 'Succeed' },
    },
}

const WITH_CATCH = {
    StartAt: 'RiskyTask',
    States: {
        HandleError: { Type: 'Fail' },
        RiskyTask: {
            Catch: [{ ErrorEquals: ['States.ALL'], Next: 'HandleError' }],
            End: true,
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:Risky',
            Type: 'Task',
        },
    },
}

const DIFF_BEFORE = {
    StartAt: 'StateA',
    States: {
        StateA: { Next: 'StateB', Type: 'Pass' },
        StateB: { Type: 'Succeed' },
    },
}

const DIFF_AFTER = {
    StartAt: 'StateA',
    States: {
        StateA: { Next: 'StateC', Type: 'Pass' },
        StateC: { Type: 'Succeed' },
    },
}

const WITH_PARALLEL_PLUS_EXTRA = {
    StartAt: 'DoParallel',
    States: {
        DoParallel: {
            Branches: WITH_PARALLEL.States.DoParallel.Branches,
            Next: 'ExtraStep',
            Type: 'Parallel',
        },
        ExtraStep: { Type: 'Succeed' },
    },
}

const HISTORY = {
    events: [
        { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
        {
            id: 2,
            previousEventId: 1,
            type: 'PassStateEntered',
            timestamp: '2024-01-01T00:00:00.100Z',
            stateEnteredEventDetails: { name: 'HelloWorld' },
        },
        {
            id: 3,
            previousEventId: 2,
            type: 'PassStateExited',
            timestamp: '2024-01-01T00:00:00.200Z',
            stateExitedEventDetails: { name: 'HelloWorld' },
        },
        { id: 4, previousEventId: 3, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.300Z' },
    ],
}

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

        it('forwards layout to Mermaid output', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="mermaid" layout="LR" />
            )

            expect(container.querySelector('pre')?.textContent).toContain('direction LR')
        })

        it('forwards theme to Mermaid output', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="mermaid" theme="dark" />
            )

            expect(container.querySelector('pre')?.textContent).toContain(
                "%%{init: {'theme':'dark'}}%%"
            )
        })
    })

    describe('Execution overlay', () => {
        it('renders an SVG overlay coloured by outcome when history is provided', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} history={JSON.stringify(HISTORY)} />
            )
            const svg = container.querySelector('svg')
            expect(svg).toBeInTheDocument()
            // Succeeded state fill from the execution overlay.
            expect(svg?.innerHTML).toContain('#c8e6c9')
        })

        it('renders a Mermaid execution overlay with status classes', () => {
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="mermaid" history={JSON.stringify(HISTORY)} />
            )
            const pre = container.querySelector('pre')
            expect(pre?.textContent).toContain('classDef execSucceeded')
            expect(pre?.textContent).toContain('class HelloWorld execSucceeded')
        })
    })

    describe('Diagram options', () => {
        it('collapses containers when collapse is true', () => {
            const { container: expanded } = render(<SfnDiagram definition={WITH_PARALLEL} />)
            const { container: collapsed } = render(
                <SfnDiagram collapse definition={WITH_PARALLEL} />
            )

            const expandedCount = expanded.querySelectorAll('[data-state-id]').length
            const collapsedCount = collapsed.querySelectorAll('[data-state-id]').length

            expect(collapsedCount).toBeLessThan(expandedCount)
        })

        it('collapses only the named containers when collapse is an array', () => {
            const { container: expanded } = render(<SfnDiagram definition={WITH_PARALLEL} />)
            const { container: collapsed } = render(
                <SfnDiagram collapse={['DoParallel']} definition={WITH_PARALLEL} />
            )

            const expandedCount = expanded.querySelectorAll('[data-state-id]').length
            const collapsedCount = collapsed.querySelectorAll('[data-state-id]').length

            expect(collapsedCount).toBeLessThan(expandedCount)
        })

        it('drops error edges when catchHandling is hide', () => {
            const { container: shown } = render(<SfnDiagram definition={WITH_CATCH} />)
            expect(shown.querySelector('[data-edge-id*="#error#"]')).not.toBeNull()

            const { container: hidden } = render(
                <SfnDiagram catchHandling="hide" definition={WITH_CATCH} />
            )
            expect(hidden.querySelector('[data-edge-id*="#error#"]')).toBeNull()
        })

        it('collapses containers in Mermaid output too', () => {
            const { container: expanded } = render(
                <SfnDiagram definition={WITH_PARALLEL} format="mermaid" />
            )
            const { container: collapsed } = render(
                <SfnDiagram collapse definition={WITH_PARALLEL} format="mermaid" />
            )

            expect(expanded.querySelector('pre')?.textContent).toContain('BranchAWork')
            expect(collapsed.querySelector('pre')?.textContent).not.toContain('BranchAWork')
        })

        it('drops error transitions in Mermaid output when catchHandling is hide', () => {
            const { container: shown } = render(
                <SfnDiagram definition={WITH_CATCH} format="mermaid" />
            )
            expect(shown.querySelector('pre')?.textContent).toContain('HandleError')

            const { container: hidden } = render(
                <SfnDiagram catchHandling="hide" definition={WITH_CATCH} format="mermaid" />
            )
            expect(hidden.querySelector('pre')?.textContent).not.toContain('HandleError')
        })
    })

    describe('Icon options', () => {
        it('renders an image element only when showIcons is set', () => {
            const { container: withoutIcons } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} />
            )
            expect(withoutIcons.querySelector('image')).toBeNull()

            const { container: withIcons } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} showIcons />
            )
            expect(withIcons.querySelector('image')).not.toBeNull()
        })

        it('sizes the icon element from iconSize', () => {
            const { container } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} iconSize={32} showIcons />
            )
            const image = container.querySelector('image')
            expect(image?.getAttribute('width')).toBe('32')
            expect(image?.getAttribute('height')).toBe('32')
        })

        it('positions the icon differently by iconPosition', () => {
            const { container: left } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} iconPosition="left" showIcons />
            )
            const { container: top } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} iconPosition="top" showIcons />
            )

            const leftImage = left.querySelector('image')
            const topImage = top.querySelector('image')

            expect(topImage?.getAttribute('x')).not.toBe(leftImage?.getAttribute('x'))
            expect(topImage?.getAttribute('y')).not.toBe(leftImage?.getAttribute('y'))
        })

        it('is a no-op in Mermaid output', () => {
            const { container: without } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} format="mermaid" />
            )
            const { container: withIcons } = render(
                <SfnDiagram definition={TASK_WITH_LAMBDA} format="mermaid" showIcons />
            )

            expect(withIcons.querySelector('pre')?.textContent).toBe(
                without.querySelector('pre')?.textContent
            )
        })
    })

    describe('showVariables', () => {
        it('shows the assigned-variable annotation by default', () => {
            const { container } = render(<SfnDiagram definition={WITH_ASSIGN} />)
            expect(container.querySelector('svg')?.innerHTML).toContain('$total')
        })

        it('hides the assigned-variable annotation when set to false', () => {
            const { container } = render(
                <SfnDiagram definition={WITH_ASSIGN} showVariables={false} />
            )
            expect(container.querySelector('svg')?.innerHTML).not.toContain('$total')
        })

        it('shows the assigned-variable annotation in Mermaid output by default', () => {
            const { container } = render(
                <SfnDiagram definition={WITH_ASSIGN} format="mermaid" />
            )
            expect(container.querySelector('pre')?.textContent).toContain('$total')
        })

        it('hides the assigned-variable annotation in Mermaid output when set to false', () => {
            const { container } = render(
                <SfnDiagram definition={WITH_ASSIGN} format="mermaid" showVariables={false} />
            )
            expect(container.querySelector('pre')?.textContent).not.toContain('$total')
        })
    })

    describe('edgeStyle', () => {
        it('draws a curved path by default', () => {
            const { container } = render(<SfnDiagram definition={WITH_ASSIGN} />)
            const pathD = container.querySelector('path[data-edge-id]')?.getAttribute('d')
            expect(pathD).toContain('C')
        })

        it('draws a straight path with no cubic command when set to straight', () => {
            const { container } = render(
                <SfnDiagram definition={WITH_ASSIGN} edgeStyle="straight" />
            )
            const pathD = container.querySelector('path[data-edge-id]')?.getAttribute('d')
            expect(pathD).not.toContain('C')
        })
    })

    describe('nodeOverrides and edgeOverrides', () => {
        it('applies a fill override to the matching node', () => {
            const { container } = render(
                <SfnDiagram
                    definition={WITH_ASSIGN}
                    nodeOverrides={{ LoadTotal: { fill: '#ff0000' } }}
                />
            )
            const node = container.querySelector('[data-state-id="LoadTotal"]')
            expect(node?.innerHTML).toContain('#ff0000')
        })

        it('ignores an override for an unknown node id', () => {
            const { container } = render(
                <SfnDiagram
                    definition={WITH_ASSIGN}
                    nodeOverrides={{ NoSuchState: { fill: '#ff0000' } }}
                />
            )
            expect(container.querySelector('svg')).toBeInTheDocument()
            expect(container.querySelector('svg')?.innerHTML).not.toContain('#ff0000')
        })

        it('applies a stroke override to the matching edge by its qualified id', () => {
            const { container: plain } = render(<SfnDiagram definition={WITH_ASSIGN} />)
            const edgeId = plain.querySelector('path[data-edge-id]')?.getAttribute('data-edge-id')
            expect(edgeId).toBeTruthy()

            const { container } = render(
                <SfnDiagram
                    definition={WITH_ASSIGN}
                    edgeOverrides={{ [edgeId as string]: { stroke: '#00ff00' } }}
                />
            )
            const edge = container.querySelector(`path[data-edge-id="${edgeId}"]`)
            expect(edge?.getAttribute('stroke')).toBe('#00ff00')
        })

        it('ignores an override for an unknown edge id', () => {
            const { container } = render(
                <SfnDiagram
                    definition={WITH_ASSIGN}
                    edgeOverrides={{ 'NoSuchEdge->Anywhere#normal#0': { stroke: '#00ff00' } }}
                />
            )
            const edge = container.querySelector('path[data-edge-id]')
            expect(edge?.getAttribute('stroke')).not.toBe('#00ff00')
        })
    })

    describe('HTML format', () => {
        it('renders an iframe rather than a div or pre', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD} format="html" />)
            expect(container.querySelector('iframe')).toBeInTheDocument()
            expect(container.querySelector('div')).toBeNull()
            expect(container.querySelector('pre')).toBeNull()
        })

        it('embeds a full HTML document with the viewer stage as srcDoc', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD} format="html" />)
            const iframe = container.querySelector('iframe')
            const srcDoc = iframe?.getAttribute('srcDoc') ?? iframe?.getAttribute('srcdoc')
            expect(srcDoc).toContain('<!DOCTYPE html')
            expect(srcDoc).toContain('data-sfn="stage"')
        })

        it('sandboxes the iframe and gives it a non-empty title', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD} format="html" />)
            const iframe = container.querySelector('iframe')
            expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
            expect(iframe?.getAttribute('title')).toBeTruthy()
        })

        it('forwards className and style to the iframe', () => {
            const { container } = render(
                <SfnDiagram
                    className="my-diagram"
                    definition={HELLO_WORLD}
                    format="html"
                    style={{ width: '500px' }}
                />
            )
            const iframe = container.querySelector('iframe')
            expect(iframe).toHaveClass('my-diagram')
            expect(iframe).toHaveStyle({ width: '500px' })
        })

        it('reflects diagram options in the embedded document', () => {
            const { container: withToggle } = render(
                <SfnDiagram definition={WITH_PARALLEL} format="html" />
            )
            const { container: withoutToggle } = render(
                <SfnDiagram collapse={false} definition={WITH_PARALLEL} format="html" />
            )

            const getSrcDoc = (container: HTMLElement): string | null | undefined => {
                const iframe = container.querySelector('iframe')
                return iframe?.getAttribute('srcDoc') ?? iframe?.getAttribute('srcdoc')
            }

            expect(getSrcDoc(withToggle)).toContain('data-sfn="collapse-toggle"')
            expect(getSrcDoc(withoutToggle)).not.toContain('data-sfn="collapse-toggle"')
        })

        it('calls onError and renders null when combined with history', () => {
            const onError = vi.fn()
            const { container } = render(
                <SfnDiagram
                    definition={HELLO_WORLD}
                    format="html"
                    history={JSON.stringify(HISTORY)}
                    onError={onError}
                />
            )
            expect(container.firstChild).toBeNull()
            expect(onError).toHaveBeenCalledWith(expect.any(Error))
        })
    })

    describe('onStateClick', () => {
        it('calls the callback once with the clicked state id', () => {
            const onStateClick = vi.fn()
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} onStateClick={onStateClick} />
            )
            const node = container.querySelector('[data-state-id="HelloWorld"]')
            fireEvent.click(node as Element)

            expect(onStateClick).toHaveBeenCalledTimes(1)
            expect(onStateClick).toHaveBeenCalledWith(
                expect.objectContaining({ stateId: 'HelloWorld' })
            )
        })

        it('resolves to the node when a descendant is clicked', () => {
            const onStateClick = vi.fn()
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} onStateClick={onStateClick} />
            )
            const label = container.querySelector('[data-state-id="HelloWorld"] text')
            fireEvent.click(label as Element)

            expect(onStateClick).toHaveBeenCalledWith(
                expect.objectContaining({ stateId: 'HelloWorld' })
            )
        })

        it('does not call the callback when clicking blank canvas', () => {
            const onStateClick = vi.fn()
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} onStateClick={onStateClick} />
            )
            const svg = container.querySelector('svg')
            fireEvent.click(svg as Element)

            expect(onStateClick).not.toHaveBeenCalled()
        })

        it('does not attach a click handler or throw when onStateClick is absent', () => {
            const { container } = render(<SfnDiagram definition={HELLO_WORLD} />)
            const node = container.querySelector('[data-state-id="HelloWorld"]')
            expect(() => fireEvent.click(node as Element)).not.toThrow()
        })

        it('is not invoked in Mermaid format', () => {
            const onStateClick = vi.fn()
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="mermaid" onStateClick={onStateClick} />
            )
            fireEvent.click(container.querySelector('pre') as Element)

            expect(onStateClick).not.toHaveBeenCalled()
        })

        it('is not invoked in HTML format', () => {
            const onStateClick = vi.fn()
            const { container } = render(
                <SfnDiagram definition={HELLO_WORLD} format="html" onStateClick={onStateClick} />
            )
            fireEvent.click(container.querySelector('iframe') as Element)

            expect(onStateClick).not.toHaveBeenCalled()
        })
    })

    describe('Diff mode', () => {
        it('colours added and removed states in the SVG diff', () => {
            const { container } = render(
                <SfnDiagram before={DIFF_BEFORE} definition={DIFF_AFTER} />
            )
            const svg = container.querySelector('svg')
            expect(svg?.innerHTML).toContain('#c8e6c9')
            expect(svg?.innerHTML).toContain('#ffcdd2')
        })

        it('emits classDef diff classes in the Mermaid diff', () => {
            const { container } = render(
                <SfnDiagram before={DIFF_BEFORE} definition={DIFF_AFTER} format="mermaid" />
            )
            const code = container.querySelector('pre')?.textContent
            expect(code).toContain('classDef diffAdded')
            expect(code).toContain('classDef diffRemoved')
            expect(code).toMatchSnapshot()
        })

        it('calls onError and renders null when combined with history', () => {
            const onError = vi.fn()
            const { container } = render(
                <SfnDiagram
                    before={DIFF_BEFORE}
                    definition={DIFF_AFTER}
                    history={JSON.stringify(HISTORY)}
                    onError={onError}
                />
            )
            expect(container.firstChild).toBeNull()
            expect(onError).toHaveBeenCalledWith(expect.any(Error))
        })

        it('calls onError and renders null when combined with format="html"', () => {
            const onError = vi.fn()
            const { container } = render(
                <SfnDiagram
                    before={DIFF_BEFORE}
                    definition={DIFF_AFTER}
                    format="html"
                    onError={onError}
                />
            )
            expect(container.firstChild).toBeNull()
            expect(onError).toHaveBeenCalledWith(expect.any(Error))
        })

        it('applies diagram options to the SVG diff', () => {
            const { container: expanded } = render(
                <SfnDiagram before={WITH_PARALLEL} definition={WITH_PARALLEL_PLUS_EXTRA} />
            )
            const { container: collapsed } = render(
                <SfnDiagram
                    before={WITH_PARALLEL}
                    collapse
                    definition={WITH_PARALLEL_PLUS_EXTRA}
                />
            )

            // The added-state colour proves the diff is actually applied, not just
            // a plain render of `definition` with `before` silently ignored.
            expect(expanded.querySelector('svg')?.innerHTML).toContain('#c8e6c9')
            expect(collapsed.querySelector('svg')?.innerHTML).toContain('#c8e6c9')

            const expandedCount = expanded.querySelectorAll('[data-state-id]').length
            const collapsedCount = collapsed.querySelectorAll('[data-state-id]').length
            expect(collapsedCount).toBeLessThan(expandedCount)
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

    describe('onError', () => {
        const INVALID = { StartAt: 'Missing', States: {} }

        it('fires exactly once per error under StrictMode', () => {
            const onError = vi.fn()

            render(
                <StrictMode>
                    <SfnDiagram definition={INVALID} onError={onError} />
                </StrictMode>
            )

            expect(onError).toHaveBeenCalledTimes(1)
            expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
        })

        it('does not fire again on a re-render with the same definition', () => {
            const onError = vi.fn()
            const { rerender } = render(<SfnDiagram definition={INVALID} onError={onError} />)

            rerender(<SfnDiagram definition={INVALID} onError={onError} />)

            expect(onError).toHaveBeenCalledTimes(1)
        })
    })
})
