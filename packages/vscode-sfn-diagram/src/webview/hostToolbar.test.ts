import { describe, expect, it } from 'vitest'
import type { CustomTheme } from 'sfn-diagram'
import { buildHostToolbarHtml } from './hostToolbar'

function customTheme(background: string): CustomTheme {
    return {
        background,
        edgeColors: { choice: '#000', default: '#000', error: '#000', normal: '#000' },
        fontFamily: 'sans-serif',
        fontSize: 12,
        nodeColors: {},
        textColor: '#000',
    } as CustomTheme
}

describe('buildHostToolbarHtml', () => {
    it('preselects Dark for theme dark', () => {
        const html = buildHostToolbarHtml({ layout: 'TB', theme: 'dark' })
        expect(html).toMatch(/<option value="dark" selected>Dark<\/option>/)
    })

    it('preselects Light for theme light', () => {
        const html = buildHostToolbarHtml({ layout: 'TB', theme: 'light' })
        expect(html).toMatch(/<option value="light" selected>Light<\/option>/)
    })

    it('preselects Light for a CustomTheme with a light background', () => {
        // A naive `theme === 'light'` check falls through every CustomTheme to
        // 'dark', regardless of its actual colors - resolveViewerTheme classifies
        // by background luminance instead.
        const html = buildHostToolbarHtml({ layout: 'TB', theme: customTheme('#ffffff') })
        expect(html).toMatch(/<option value="light" selected>Light<\/option>/)
    })

    it('preselects Dark for a CustomTheme with a dark background', () => {
        const html = buildHostToolbarHtml({ layout: 'TB', theme: customTheme('#101820') })
        expect(html).toMatch(/<option value="dark" selected>Dark<\/option>/)
    })
})
