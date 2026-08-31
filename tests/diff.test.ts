import { describe, expect, it } from 'vitest'
import { generateDiff, generateMermaid, generateMermaidDiff } from '../src/index'
import { computeContainerChangeAnnotations } from '../src/diff'
import type { AslDefinition } from '../src/types'

const baseAsl: AslDefinition = {
    StartAt: 'StepA',
    States: {
        StepA: { Next: 'StepB', Type: 'Pass' },
        StepB: { Next: 'StepC', Type: 'Task', Resource: 'arn:aws:lambda:::function:fn' },
        StepC: { End: true, Type: 'Succeed' },
    },
}

const modifiedAsl: AslDefinition = {
    StartAt: 'StepA',
    States: {
        // StepA unchanged
        StepA: { Next: 'StepB', Type: 'Pass' },
        // StepB modified (Resource changed)
        StepB: { Next: 'NewStep', Resource: 'arn:aws:lambda:::function:fn-v2', Type: 'Task' },
        // StepC removed
        // NewStep added
        NewStep: { End: true, Type: 'Pass' },
    },
}

describe('generateDiff', () => {
    it('returns svg string', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.svg).toContain('<svg')
        expect(result.svg).toContain('</svg>')
    })

    it('identifies added states', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.metadata.added).toContain('NewStep')
        expect(result.metadata.added).toHaveLength(1)
    })

    it('identifies modified states', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.metadata.modified).toContain('StepB')
        expect(result.metadata.modified).toHaveLength(1)
    })

    it('identifies removed states', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.metadata.removed).toContain('StepC')
        expect(result.metadata.removed).toHaveLength(1)
    })

    it('identifies unchanged states', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.metadata.unchanged).toContain('StepA')
        expect(result.metadata.unchanged).toHaveLength(1)
    })

    it('accepts JSON strings as input', () => {
        const result = generateDiff({
            after: JSON.stringify(modifiedAsl),
            before: JSON.stringify(baseAsl),
        })
        expect(result.metadata.added).toContain('NewStep')
    })

    it('applies green fill to added nodes', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.svg).toContain('#c8e6c9')
    })

    it('applies yellow fill to modified nodes', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.svg).toContain('#fff9c4')
    })

    it('applies red fill to removed nodes', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.svg).toContain('#ffcdd2')
    })

    it('has zero diff when definitions are identical', () => {
        const result = generateDiff({ after: baseAsl, before: baseAsl })
        expect(result.metadata.added).toHaveLength(0)
        expect(result.metadata.modified).toHaveLength(0)
        expect(result.metadata.removed).toHaveLength(0)
        expect(result.metadata.unchanged).toHaveLength(3)
    })

    it('returns positive dimensions', () => {
        const result = generateDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.width).toBeGreaterThan(0)
        expect(result.height).toBeGreaterThan(0)
    })

    it('treats states with reordered properties as unchanged', () => {
        // Same state, keys written in a different order — must not be flagged as modified
        const reordered: AslDefinition = {
            StartAt: 'StepA',
            States: {
                StepA: { Type: 'Pass', Next: 'StepB' },
                StepB: { Resource: 'arn:aws:lambda:::function:fn', Type: 'Task', Next: 'StepC' },
                StepC: { Type: 'Succeed', End: true },
            },
        }
        const result = generateDiff({ after: reordered, before: baseAsl })
        expect(result.metadata.modified).toHaveLength(0)
        expect(result.metadata.unchanged).toHaveLength(3)
    })

    it('merges a caller-supplied nodeOverrides instead of discarding diff coloring', () => {
        const result = generateDiff({
            after: modifiedAsl,
            before: baseAsl,
            nodeOverrides: { StepA: { fill: '#123456' } },
        })
        // Caller's override for the unrelated, unchanged StepA node is applied...
        expect(result.svg).toContain('#123456')
        // ...without wiping out the diff coloring for the nodes generateDiff itself colors.
        expect(result.svg).toContain('#fff9c4') // StepB, modified
        expect(result.svg).toContain('#c8e6c9') // NewStep, added
        expect(result.svg).toContain('#ffcdd2') // StepC, removed
    })
})

describe('computeContainerChangeAnnotations', () => {
    // `generateDiff`'s own diff comparison (computeStateDiff) only classifies
    // top-level ASL state names, which — given ASL's Branches/Iterator nesting — can
    // never coincide with a collapsed container's *hidden descendant* ids in a normal
    // definition. The counting/precedence logic still has to be right for whenever it
    // does (a future nested-diff granularity, or a name reused at two nesting levels),
    // so it's exercised directly here against synthetic sets instead of a live ASL diff.

    it('counts hidden changed ids and annotates only containers with a nonzero count', () => {
        const result = computeContainerChangeAnnotations({
            changedNames: new Set(['Branch1', 'Branch3']),
            effectiveTargets: new Set(['FanOut', 'Empty']),
            existingOverrides: {},
            hiddenIdsByTarget: new Map([
                ['FanOut', new Set(['Branch1', 'Branch2'])],
                ['Empty', new Set(['Branch4'])],
            ]),
        })

        expect(result.nodeAnnotations).toEqual({ FanOut: '1 changed inside' })
        expect(result.nodeOverrides).toEqual({ FanOut: { fill: '#fff9c4', stroke: '#f57f17', strokeWidth: 2 } })
    })

    it('ignores a requested target absent from effectiveTargets (swallowed by an ancestor)', () => {
        const result = computeContainerChangeAnnotations({
            changedNames: new Set(['Inner']),
            effectiveTargets: new Set(['Outer']),
            existingOverrides: {},
            // hiddenIdsByTarget still carries an entry for the swallowed target — see
            // computeCollapsePlan — but it has no placeholder of its own to annotate.
            hiddenIdsByTarget: new Map([
                ['Outer', new Set(['Inner'])],
                ['Inner', new Set()],
            ]),
        })

        expect(Object.keys(result.nodeAnnotations)).toEqual(['Outer'])
    })

    it('keeps a more specific existing override instead of overwriting it with modified', () => {
        const result = computeContainerChangeAnnotations({
            changedNames: new Set(['Branch1']),
            effectiveTargets: new Set(['FanOut']),
            existingOverrides: { FanOut: { fill: '#c8e6c9', stroke: '#2e7d32', strokeWidth: 2 } },
            hiddenIdsByTarget: new Map([['FanOut', new Set(['Branch1'])]]),
        })

        // No override returned for FanOut — the caller's own (added) color stands —
        // but the annotation is still produced regardless.
        expect(result.nodeOverrides).toEqual({})
        expect(result.nodeAnnotations).toEqual({ FanOut: '1 changed inside' })
    })

    it('produces nothing for a target with no hidden changes', () => {
        const result = computeContainerChangeAnnotations({
            changedNames: new Set(['Unrelated']),
            effectiveTargets: new Set(['FanOut']),
            existingOverrides: {},
            hiddenIdsByTarget: new Map([['FanOut', new Set(['Branch1'])]]),
        })

        expect(result.nodeAnnotations).toEqual({})
        expect(result.nodeOverrides).toEqual({})
    })
})

describe('generateDiff with collapse', () => {
    const containerBaseAsl: AslDefinition = {
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                ],
                Next: 'StepX',
            },
            StepX: { Next: 'Done', Resource: 'arn:x', Type: 'Task' },
            Done: { End: true, Type: 'Succeed' },
        },
    }

    it('still colors a container modified by a change in one of its branches once collapsed', () => {
        // computeStateDiff compares whole top-level ASL state entries, so a change
        // inside FanOut's own branch makes FanOut itself "modified" — this is the
        // container's own status (already applied before collapse), not the new
        // hidden-descendant annotation; asserting it here guards against a regression
        // in how collapse and the existing per-name diff coloring interact.
        const after: AslDefinition = {
            ...containerBaseAsl,
            States: {
                ...containerBaseAsl.States,
                FanOut: {
                    ...containerBaseAsl.States.FanOut,
                    Branches: [
                        { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1-v2', End: true } } },
                    ],
                },
            },
        }
        const result = generateDiff({ after, before: containerBaseAsl, collapse: true })

        expect(result.metadata.modified).toEqual(['FanOut'])
        expect(result.svg).toContain('#fff9c4')
        expect(result.svg).not.toContain('changed inside')
    })

    it('does not annotate a placeholder whose hidden contents are unchanged', () => {
        const after: AslDefinition = {
            ...containerBaseAsl,
            States: { ...containerBaseAsl.States, StepX: { Next: 'Done', Resource: 'arn:x-v2', Type: 'Task' } },
        }
        const result = generateDiff({ after, before: containerBaseAsl, collapse: true })

        expect(result.metadata.modified).toEqual(['StepX'])
        expect(result.svg).not.toContain('changed inside')
    })
})

describe('generateMermaidDiff', () => {
    it('returns stateDiagram code with the same change summary as generateDiff', () => {
        const result = generateMermaidDiff({ after: modifiedAsl, before: baseAsl })
        expect(result.code).toContain('stateDiagram-v2')
        expect(result.metadata.added).toEqual(['NewStep'])
        expect(result.metadata.modified).toContain('StepB')
        expect(result.metadata.removed).toEqual(['StepC'])
        expect(result.metadata.unchanged).toContain('StepA')
    })

    it('colours added, modified, and removed states via diff classes', () => {
        const result = generateMermaidDiff({ after: modifiedAsl, before: baseAsl })

        expect(result.code).toContain('classDef diffAdded')
        expect(result.code).toContain('classDef diffModified')
        expect(result.code).toContain('classDef diffRemoved')

        expect(result.code).toContain('class NewStep diffAdded')
        expect(result.code).toContain('class StepB diffModified')
        // Removed states are kept as orphan nodes so they stay visible
        expect(result.code).toContain('class StepC diffRemoved')
    })

    it('does not affect plain generateMermaid output (no diff classes)', () => {
        const plain = generateMermaid({ aslDefinition: baseAsl })
        expect(plain.code).not.toContain('diffAdded')
        expect(plain.code).not.toContain('diffModified')
        expect(plain.code).not.toContain('diffRemoved')
    })
})
