import { generateSvg } from 'sfn-diagram'
import { describe, expect, it } from 'vitest'
import { toIdPrefix } from './idPrefix'

describe('toIdPrefix', () => {
    it.each([
        ['_r_0_', 'sfn-_r_0_-'],
        [':r0:', 'sfn-_r0_-'],
        ['«r0»', 'sfn-_r0_-'],
        ['my app#_r_0_', 'sfn-my_app__r_0_-'],
    ])('turns %j into %j', (reactId, expected) => {
        expect(toIdPrefix({ reactId })).toBe(expected)
    })

    it('gives core a prefix it accepts for any identifierPrefix', () => {
        expect(() =>
            generateSvg({
                aslDefinition: { StartAt: 'A', States: { A: { End: true, Type: 'Pass' } } },
                idPrefix: toIdPrefix({ reactId: 'a "b" #c' }),
            })
        ).not.toThrow()
    })
})
