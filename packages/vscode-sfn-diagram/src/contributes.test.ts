import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASL_CONTEXT_KEY, ASL_FILENAME_PATTERN } from './aslDetection'

interface ExtensionCommand {
    category: string
    command: string
    title: string
}

interface ExtensionMenuItem {
    command: string
    group: string
    when: string
}

interface ExtensionContributes {
    commands: ExtensionCommand[]
    menus: {
        'editor/title': ExtensionMenuItem[]
    }
}

interface ExtensionManifest {
    activationEvents: string[]
    contributes: ExtensionContributes
}

const manifestPath = new URL('../package.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExtensionManifest

const EXPECTED_WHEN =
    'resourceFilename =~ /\\.asl\\.json$/i || resourceExtname == .asl || (resourceExtname == .json && sfnDiagram.isAslDocument)'

describe('editor/title menu contributions', () => {
    it('gives both preview commands the identical, exact expected when clause', () => {
        const [preview, previewExecution] = manifest.contributes.menus['editor/title']
        expect(preview.when).toBe(EXPECTED_WHEN)
        expect(previewExecution.when).toBe(EXPECTED_WHEN)
    })

    it('never gates on the bare resourceExtname == .json clause (#167 regression guard)', () => {
        for (const item of manifest.contributes.menus['editor/title']) {
            expect(item.when).not.toContain('resourceExtname == .json ||')
            expect(item.when.trim()).not.toBe('resourceExtname == .json')
        }
    })

    it('references the shared ASL context key in every when clause', () => {
        for (const item of manifest.contributes.menus['editor/title']) {
            expect(item.when).toContain(ASL_CONTEXT_KEY)
        }
    })

    it('embeds a regex literal matching ASL_FILENAME_PATTERN', () => {
        for (const item of manifest.contributes.menus['editor/title']) {
            const match = item.when.match(/resourceFilename\s*=~\s*\/(.+?)\/([a-z]*)/)
            expect(match).not.toBeNull()

            const [, source, flags] = match as RegExpMatchArray
            expect(source).toBe(ASL_FILENAME_PATTERN.source)
            expect(flags).toBe(ASL_FILENAME_PATTERN.flags)

            const compiled = new RegExp(source, flags)
            expect(compiled.test('order.asl.json')).toBe(true)
            expect(compiled.test('package.json')).toBe(false)
            expect(compiled.test('tsconfig.json')).toBe(false)
        }
    })

    it('declares every referenced command in contributes.commands', () => {
        const declaredCommands = new Set(manifest.contributes.commands.map((command) => command.command))
        for (const item of manifest.contributes.menus['editor/title']) {
            expect(declaredCommands.has(item.command)).toBe(true)
        }
    })
})

describe('activationEvents', () => {
    it('activates on json and jsonc languages so the sniffed context key can be set in time', () => {
        expect(manifest.activationEvents).toContain('onLanguage:json')
        expect(manifest.activationEvents).toContain('onLanguage:jsonc')
    })
})
