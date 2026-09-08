import type { LayoutDirection } from 'sfn-diagram'

export const CONFIG_SECTION = 'sfnDiagram'
export const LAYOUT_VALUES = ['TB', 'LR', 'RL', 'BT'] as const
export const THEME_VALUES = ['auto', 'dark', 'light'] as const

export type ResolvedTheme = 'dark' | 'light'
export type ThemeSetting = (typeof THEME_VALUES)[number]

export interface SfnDiagramSettings {
    autoPreview: boolean
    collapseContainers: boolean
    layout: LayoutDirection
    showIcons: boolean
    theme: ThemeSetting
}

export const DEFAULT_SETTINGS: SfnDiagramSettings = {
    autoPreview: false,
    collapseContainers: false,
    layout: 'TB',
    showIcons: false,
    theme: 'auto',
}

export interface ConfigurationReader {
    get<Value>(section: string): Value | undefined
}

export interface ResolveSettingsParams {
    configuration: ConfigurationReader
}

interface ReadEnumParams<Value extends string> {
    allowed: readonly Value[]
    fallback: Value
    value: unknown
}

function readEnum<Value extends string>(params: ReadEnumParams<Value>): Value {
    if (typeof params.value === 'string' && (params.allowed as readonly string[]).includes(params.value)) {
        return params.value as Value
    }
    return params.fallback
}

interface ReadBooleanParams {
    fallback: boolean
    value: unknown
}

function readBoolean(params: ReadBooleanParams): boolean {
    return typeof params.value === 'boolean' ? params.value : params.fallback
}

/**
 * Resolves the extension's user-facing settings from a VS Code configuration reader,
 * falling back to `DEFAULT_SETTINGS` for any missing or invalid value.
 *
 * @param params - Parameters object.
 * @param params.configuration - A reader exposing `get<Value>(section)`, typically
 *   `vscode.workspace.getConfiguration(CONFIG_SECTION)`.
 * @returns The fully-resolved settings, with every field defined.
 * @example
 * resolveSettings({ configuration: vscode.workspace.getConfiguration(CONFIG_SECTION) })
 */
export function resolveSettings(params: ResolveSettingsParams): SfnDiagramSettings {
    const { configuration } = params
    return {
        autoPreview: readBoolean({
            fallback: DEFAULT_SETTINGS.autoPreview,
            value: configuration.get('autoPreview'),
        }),
        collapseContainers: readBoolean({
            fallback: DEFAULT_SETTINGS.collapseContainers,
            value: configuration.get('collapseContainers'),
        }),
        layout: readEnum({
            allowed: LAYOUT_VALUES,
            fallback: DEFAULT_SETTINGS.layout,
            value: configuration.get('layout'),
        }),
        showIcons: readBoolean({
            fallback: DEFAULT_SETTINGS.showIcons,
            value: configuration.get('showIcons'),
        }),
        theme: readEnum({
            allowed: THEME_VALUES,
            fallback: DEFAULT_SETTINGS.theme,
            value: configuration.get('theme'),
        }),
    }
}

export const COLOR_THEME_KIND = { dark: 2, highContrast: 3, highContrastLight: 4, light: 1 } as const

export interface ResolveColorSchemeParams {
    colorThemeKind: number
}

/**
 * Maps a VS Code `ColorThemeKind` to the two-way theme the diagram renderer understands.
 *
 * @param params - Parameters object.
 * @param params.colorThemeKind - `vscode.window.activeColorTheme.kind`.
 * @returns `'light'` for the light and high-contrast-light kinds, `'dark'` otherwise
 *   (including unrecognized values).
 * @example
 * resolveColorScheme({ colorThemeKind: vscode.window.activeColorTheme.kind })
 */
export function resolveColorScheme(params: ResolveColorSchemeParams): ResolvedTheme {
    if (params.colorThemeKind === COLOR_THEME_KIND.light || params.colorThemeKind === COLOR_THEME_KIND.highContrastLight) {
        return 'light'
    }
    return 'dark'
}

export interface PreviewDiagramOptions {
    collapse: boolean | undefined
    layout: LayoutDirection
    showIcons: boolean
    theme: ResolvedTheme
}

export interface ToDiagramOptionsParams {
    colorScheme: ResolvedTheme
    settings: SfnDiagramSettings
}

/**
 * Converts resolved user settings and the current VS Code color scheme into the
 * options the diagram renderer needs.
 *
 * @param params - Parameters object.
 * @param params.colorScheme - The current VS Code color scheme, used when `settings.theme` is `'auto'`.
 * @param params.settings - The resolved extension settings.
 * @returns Renderer-ready diagram options, with `collapse: undefined` when collapsing is disabled.
 * @example
 * toDiagramOptions({ colorScheme: 'dark', settings: DEFAULT_SETTINGS })
 */
export function toDiagramOptions(params: ToDiagramOptionsParams): PreviewDiagramOptions {
    const { colorScheme, settings } = params
    return {
        collapse: settings.collapseContainers ? true : undefined,
        layout: settings.layout,
        showIcons: settings.showIcons,
        theme: settings.theme === 'auto' ? colorScheme : settings.theme,
    }
}
