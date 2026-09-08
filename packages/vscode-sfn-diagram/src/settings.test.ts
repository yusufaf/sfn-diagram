import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    COLOR_THEME_KIND,
    CONFIG_SECTION,
    DEFAULT_SETTINGS,
    LAYOUT_VALUES,
    THEME_VALUES,
    resolveColorScheme,
    resolveSettings,
    toDiagramOptions,
    type ConfigurationReader,
    type SfnDiagramSettings,
} from './settings'

function stubConfiguration(values: Partial<SfnDiagramSettings>): ConfigurationReader {
    return {
        get<Value>(section: string): Value | undefined {
            return (values as Record<string, unknown>)[section] as Value | undefined
        },
    }
}

describe('resolveSettings', () => {
    it('returns the defaults for an empty configuration', () => {
        expect(resolveSettings({ configuration: stubConfiguration({}) })).toEqual(DEFAULT_SETTINGS)
    })

    it('applies a partial configuration over the defaults', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ layout: 'LR' }) })
        expect(settings).toEqual({ ...DEFAULT_SETTINGS, layout: 'LR' })
    })

    it('reads all five settings through verbatim when valid', () => {
        const settings = resolveSettings({
            configuration: stubConfiguration({
                autoPreview: true,
                collapseContainers: true,
                layout: 'BT',
                showIcons: true,
                theme: 'light',
            }),
        })
        expect(settings).toEqual({
            autoPreview: true,
            collapseContainers: true,
            layout: 'BT',
            showIcons: true,
            theme: 'light',
        })
    })

    it('falls back to the default layout for an unrecognized value', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ layout: 'LTR' as never }) })
        expect(settings.layout).toBe('TB')
    })

    it('falls back to the default layout for an empty string', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ layout: '' as never }) })
        expect(settings.layout).toBe('TB')
    })

    it('falls back to the default layout for a number', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ layout: 42 as never }) })
        expect(settings.layout).toBe('TB')
    })

    it('falls back to the default layout for null', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ layout: null as never }) })
        expect(settings.layout).toBe('TB')
    })

    it('falls back to the default theme for the wrong case', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ theme: 'Dark' as never }) })
        expect(settings.theme).toBe('auto')
    })

    it('falls back to the default theme for an unrecognized value', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ theme: 'blue' as never }) })
        expect(settings.theme).toBe('auto')
    })

    it('does not coerce a string into a boolean for showIcons', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ showIcons: 'true' as never }) })
        expect(settings.showIcons).toBe(false)
    })

    it('does not coerce a number into a boolean for autoPreview', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ autoPreview: 1 as never }) })
        expect(settings.autoPreview).toBe(false)
    })

    it('does not coerce null into a boolean for collapseContainers', () => {
        const settings = resolveSettings({ configuration: stubConfiguration({ collapseContainers: null as never }) })
        expect(settings.collapseContainers).toBe(false)
    })
})

describe('resolveColorScheme', () => {
    it('maps the light color-theme kind to light', () => {
        expect(resolveColorScheme({ colorThemeKind: COLOR_THEME_KIND.light })).toBe('light')
    })

    it('maps the dark color-theme kind to dark', () => {
        expect(resolveColorScheme({ colorThemeKind: COLOR_THEME_KIND.dark })).toBe('dark')
    })

    it('maps high-contrast to dark', () => {
        expect(resolveColorScheme({ colorThemeKind: COLOR_THEME_KIND.highContrast })).toBe('dark')
    })

    it('maps high-contrast-light to light', () => {
        expect(resolveColorScheme({ colorThemeKind: COLOR_THEME_KIND.highContrastLight })).toBe('light')
    })

    it('falls back to dark for an unknown kind', () => {
        expect(resolveColorScheme({ colorThemeKind: 99 })).toBe('dark')
    })
})

describe('toDiagramOptions', () => {
    it('resolves an auto theme to dark when the color scheme is dark', () => {
        const options = toDiagramOptions({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, theme: 'auto' },
        })
        expect(options.theme).toBe('dark')
    })

    it('resolves an auto theme to light when the color scheme is light', () => {
        const options = toDiagramOptions({
            colorScheme: 'light',
            settings: { ...DEFAULT_SETTINGS, theme: 'auto' },
        })
        expect(options.theme).toBe('light')
    })

    it('lets an explicit theme win over the color scheme', () => {
        const options = toDiagramOptions({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, theme: 'light' },
        })
        expect(options.theme).toBe('light')
    })

    it('maps collapseContainers: false to collapse: undefined', () => {
        const options = toDiagramOptions({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, collapseContainers: false },
        })
        expect(options.collapse).toBeUndefined()
    })

    it('maps collapseContainers: true to collapse: true', () => {
        const options = toDiagramOptions({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, collapseContainers: true },
        })
        expect(options.collapse).toBe(true)
    })

    it('passes layout and showIcons through unchanged', () => {
        const options = toDiagramOptions({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, layout: 'LR', showIcons: true },
        })
        expect(options.layout).toBe('LR')
        expect(options.showIcons).toBe(true)
    })

    it('returns exactly the four PreviewDiagramOptions keys', () => {
        const options = toDiagramOptions({ colorScheme: 'dark', settings: DEFAULT_SETTINGS })
        expect(Object.keys(options).sort()).toEqual(['collapse', 'layout', 'showIcons', 'theme'])
    })
})

describe('manifest parity', () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
        contributes: { configuration: { properties: Record<string, { default: unknown; enum?: string[]; enumDescriptions?: string[] }> } }
    }
    const properties = packageJson.contributes.configuration.properties

    it('has a manifest property for every default setting and vice versa', () => {
        const settingKeys = Object.keys(DEFAULT_SETTINGS).sort()
        const manifestKeys = Object.keys(properties)
            .map((key) => key.slice(`${CONFIG_SECTION}.`.length))
            .sort()
        expect(manifestKeys).toEqual(settingKeys)
    })

    it('has manifest defaults matching DEFAULT_SETTINGS', () => {
        for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SfnDiagramSettings>) {
            expect(properties[`${CONFIG_SECTION}.${key}`].default).toEqual(DEFAULT_SETTINGS[key])
        }
    })

    it('has a layout enum matching LAYOUT_VALUES', () => {
        expect(properties[`${CONFIG_SECTION}.layout`].enum).toEqual([...LAYOUT_VALUES])
    })

    it('has a theme enum matching THEME_VALUES', () => {
        expect(properties[`${CONFIG_SECTION}.theme`].enum).toEqual([...THEME_VALUES])
    })

    it('has matching enumDescriptions lengths for each enum property', () => {
        for (const property of Object.values(properties)) {
            if (property.enum) {
                expect(property.enumDescriptions?.length).toBe(property.enum.length)
            }
        }
    })
})
