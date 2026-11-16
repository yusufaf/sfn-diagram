import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * out/extension.js inlines dagre (and any other runtime dependency), whose licence
 * requires its notice in every copy. esbuild.mjs appends those notices at the end of
 * the bundle. These checks keep a build change from silently dropping them. They find
 * the inlined packages from the bundle's own `// …node_modules/…` path comments, so they
 * share no code with the build. turbo runs `build` before `test`, so out/ exists.
 */

const packageDir = join(__dirname, '..')
const bundlePath = join(packageDir, 'out', 'extension.js')
if (!existsSync(bundlePath)) {
    throw new Error('out/extension.js is missing: run pnpm --filter vscode-sfn-diagram build first')
}
const bundle = readFileSync(bundlePath, 'utf-8').replace(/\r\n/g, '\n')

const NOTICE_HEADING = 'Third-party software bundled into this file'

/**
 * The notice block only, never the rest of the bundle: core's inlined relayout bundle
 * already carries dagre's licence, so a check over the whole file would pass without
 * the notice.
 */
function noticeBlock(): string {
    const start = bundle.indexOf(NOTICE_HEADING)
    if (start === -1) {
        return ''
    }
    const end = bundle.indexOf('\n */', start)
    return bundle.slice(start, end === -1 ? undefined : end)
}

const notice = noticeBlock()

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i
const PATH_COMMENT = /^\/\/ (\S*node_modules\/\S+)$/gm
const MARKER = 'node_modules/'

interface InlinedPackage {
    id: string
    licenceFiles: string[]
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
 * every directory between an inlined file and that root.
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
            return { id: `${manifest.name}@${manifest.version}`, licenceFiles }
        })
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

describe('third-party licence notices in the extension bundle', () => {
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

    it('finds the packages the bundle inlines', () => {
        const ids = packages.map((pkg) => pkg.id)
        expect(ids.some((id) => id.startsWith('@dagrejs/dagre@'))).toBe(true)
        expect(packages.length).toBeGreaterThanOrEqual(1)
        // One entry per installed copy: two copies of a package each need checking.
        expect(new Set(inlinedInputs().map(packagePrefix)).size).toBe(packages.length)
    })

    it.each(packages)('names $id and carries every line of its licence', ({ id, licenceFiles }) => {
        expect(notice).toContain(id)
        expect(licenceFiles.length).toBeGreaterThan(0)
        for (const file of licenceFiles) {
            for (const line of licenceLines(file)) {
                expect(notice).toContain(line)
            }
        }
    })

    it('keeps the legal comments esbuild collects', () => {
        // Not the d3 copyright line: the escaped relayout string carries that too. The
        // real newline here can't match that JSON-escaped copy.
        expect(bundle).toMatch(/\/\*! @license\n\s*\* buildLinePath is ported from d3-shape/)
    })
})
