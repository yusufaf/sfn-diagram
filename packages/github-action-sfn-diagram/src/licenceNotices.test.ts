import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The committed bundle inlines dagre and some 45 other packages, and their licences
 * (MIT, ISC, BlueOak, Apache-2.0) require their notice in every copy. esbuild.mjs
 * appends those notices at the end of dist/index.js. These checks keep a build change
 * from silently dropping them. They find the inlined packages from the bundle's own
 * `// …node_modules/…` path comments, so they share no code with the build.
 */

const packageDir = join(__dirname, '..')
const bundle = readFileSync(join(packageDir, 'dist', 'index.js'), 'utf-8').replace(/\r\n/g, '\n')

const NOTICE_HEADING = 'Third-party software bundled into this file'
const notice = bundle.includes(NOTICE_HEADING) ? bundle.slice(bundle.indexOf(NOTICE_HEADING)) : ''

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i
const PATH_COMMENT = /^\/\/ (\S*node_modules\/\S+)$/gm
const MARKER = 'node_modules/'

interface InlinedPackage {
    id: string
    licence: string | undefined
    licenceFiles: string[]
    root: string
}

/** Every non-blank line of a licence file, trimmed. */
function licenceLines(file: string): string[] {
    return readFileSync(file, 'utf-8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

/** An inlined input's package root, as written in the path comment: everything up to and including its name. */
function packagePrefix(input: string): string {
    const index = input.lastIndexOf(MARKER)
    const segments = input.slice(index + MARKER.length).split('/')
    const nameLength = segments[0].startsWith('@') ? 2 : 1
    return input.slice(0, index + MARKER.length) + segments.slice(0, nameLength).join('/')
}

function inlinedInputs(): string[] {
    return [...bundle.matchAll(PATH_COMMENT)].map((match) => match[1])
}

/**
 * The packages the bundle inlines, with the licence files in each package root and in
 * every directory between an inlined file and that root (undici nests one under
 * lib/web/fetch).
 */
function inlinedPackages(): InlinedPackage[] {
    const dirsByRoot = new Map<string, Set<string>>()
    for (const input of inlinedInputs()) {
        const root = join(packageDir, packagePrefix(input))
        const dirs = dirsByRoot.get(root) ?? new Set([root])
        let dir = dirname(join(packageDir, input))
        while (dir.startsWith(root + sep)) {
            dirs.add(dir)
            dir = dirname(dir)
        }
        dirsByRoot.set(root, dirs)
    }
    return [...dirsByRoot]
        .map(([root, dirs]) => {
            const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
                license?: string
                name: string
                version: string
            }
            const licenceFiles = [...dirs]
                .filter((dir) => existsSync(dir))
                .flatMap((dir) =>
                    readdirSync(dir)
                        .filter((file) => LICENCE_FILE.test(file) && statSync(join(dir, file)).isFile())
                        .map((file) => join(dir, file))
                )
            return { id: `${manifest.name}@${manifest.version}`, licence: manifest.license, licenceFiles, root }
        })
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

/** A licence file's path inside its package, with `/` separators on every OS. */
function packageRelative(params: { file: string; pkg: InlinedPackage }): string {
    return relative(params.pkg.root, params.file).split(sep).join('/')
}

describe('third-party licence notices in the Action bundle', () => {
    const packages = inlinedPackages()

    it("includes dagre's copyright and every line of its MIT licence", () => {
        expect(notice).toContain('Copyright (c) 2012-2014 Chris Pettitt')
        const dagre = packages.find((pkg) => pkg.id.startsWith('@dagrejs/dagre@'))
        expect(dagre?.licenceFiles.length).toBeGreaterThan(0)
        for (const file of dagre!.licenceFiles) {
            for (const line of licenceLines(file)) {
                expect(notice).toContain(line)
            }
        }
    })

    it('includes the licence undici nests under lib/web/fetch', () => {
        expect(notice).toContain('Copyright (c) 2020 Ethan Arrowood')
        const undici = packages.find((pkg) => pkg.id.startsWith('undici@'))
        expect(undici).toBeDefined()
        const files = undici!.licenceFiles.map((file) => packageRelative({ file, pkg: undici! }))
        expect(files).toContain('lib/web/fetch/LICENSE')
    })

    it("includes llhttp's licence, which undici inlines without one", () => {
        expect(inlinedInputs().some((input) => input.endsWith('undici/lib/llhttp/llhttp-wasm.js'))).toBe(true)
        expect(notice).toContain('Copyright Fedor Indutny, 2018.')
        expect(notice).toContain('This software is licensed under the MIT License.')
        expect(notice).toContain('https://github.com/nodejs/llhttp/blob/v9.3.0/LICENSE')
        for (const line of licenceLines(join(packageDir, 'licences', 'llhttp-LICENSE'))) {
            expect(notice).toContain(line)
        }
    })

    it('keeps the legal comments esbuild collects', () => {
        expect(bundle).toContain('Copyright 2010-2022 Mike Bostock')
        expect(bundle).toContain('formdata-polyfill. MIT License')
        expect(bundle).toContain('ws. MIT License')
    })

    it('finds the packages the bundle inlines', () => {
        const ids = packages.map((pkg) => pkg.id)
        for (const prefix of ['@actions/core@', '@dagrejs/dagre@', 'undici@']) {
            expect(ids.some((id) => id.startsWith(prefix))).toBe(true)
        }
        expect(packages.length).toBeGreaterThan(20)
        // One entry per installed copy: two copies of a package (two versions, or one
        // version under two pnpm peer paths) each need checking.
        expect(new Set(inlinedInputs().map(packagePrefix)).size).toBe(packages.length)
    })

    it.each(packages)('names $id and carries every line of its licence', ({ id, licence, licenceFiles }) => {
        expect(notice).toContain(id)
        if (licenceFiles.length === 0) {
            expect(licence).toBe('Apache-2.0')
            expect(notice).toContain('Apache License')
            expect(notice).toContain('Version 2.0, January 2004')
            return
        }
        for (const file of licenceFiles) {
            for (const line of licenceLines(file)) {
                expect(notice).toContain(line)
            }
        }
    })
})
