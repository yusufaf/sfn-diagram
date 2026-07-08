import { describe, expect, it } from 'vitest'
import { generateDiff, generateMermaid, generateMermaidDiff } from '../src/index'
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
