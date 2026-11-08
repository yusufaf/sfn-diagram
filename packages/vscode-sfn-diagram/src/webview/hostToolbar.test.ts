import { describe, expect, it } from 'vitest'
import { buildHostToolbarHtml, buildHostToolbarStyles } from './hostToolbar'

describe('buildHostToolbarHtml', () => {
    it('preselects Dark for theme dark', () => {
        const html = buildHostToolbarHtml({ layout: 'TB', theme: 'dark' })
        expect(html).toMatch(/<option value="dark" selected>Dark<\/option>/)
    })

    it('preselects Light for theme light', () => {
        const html = buildHostToolbarHtml({ layout: 'TB', theme: 'light' })
        expect(html).toMatch(/<option value="light" selected>Light<\/option>/)
    })
})

describe('buildHostToolbarStyles', () => {
    it('floats the pill above the viewer chrome by default', () => {
        const css = buildHostToolbarStyles()
        expect(css).toMatch(/\.sfn-host-toolbar \{[^}]*z-index: 4;/)
    })

    it('drops the pill beneath the detail panel once it is a bottom sheet', () => {
        const css = buildHostToolbarStyles()
        const compactBlock = css.slice(css.indexOf('@media (max-width: 640px)'))
        expect(compactBlock).toContain('[data-sfn="panel"].sfn-open ~ .sfn-host-toolbar { z-index: 2; }')
    })
})
