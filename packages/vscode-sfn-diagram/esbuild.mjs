import { build } from 'esbuild'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// The extension ships out/extension.js with its runtime dependencies inlined (dagre,
// through sfn-diagram). Their licences require the notice in every copy, and most
// packages carry it only in a LICENSE file that the .vsix doesn't include, so the build
// appends those notices to the end of the bundle. A first pass only reads the metafile
// to find what gets inlined; the second writes the bundle with the notice as its footer,
// which esbuild places before the sourceMappingURL comment so the map stays exact. A
// package with no licence file fails the build. src/licenceNotices.test.ts checks that
// every inlined package's notice is there. `pnpm dev` (watch mode) skips the notice:
// it never ships.

const packageDir = import.meta.dirname
// LICENSE, LICENCE.md, LICENSE-MIT, NOTICE, COPYING, …; never a source file such as
// license.js.
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i
const MARKER = 'node_modules/'

const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Each third-party package the metafile shows was bundled, with its licence text: the
 * licence files in the package root and in every directory between an inlined file
 * and that root. Keyed by the full path through the last node_modules/, so two copies
 * of one package stay apart. sfn-diagram itself resolves through the workspace link to
 * ../../dist, which is first party, so it never reaches here.
 */
function inlinedPackages({ metafile }) {
    const subdirsByRoot = new Map()
    for (const input of Object.keys(metafile.inputs)) {
        const index = input.lastIndexOf(MARKER)
        if (index === -1) {
            continue
        }
        const segments = input.slice(index + MARKER.length).split('/')
        const nameLength = segments[0].startsWith('@') ? 2 : 1
        const root = input.slice(0, index + MARKER.length) + segments.slice(0, nameLength).join('/')
        const subdirs = subdirsByRoot.get(root) ?? new Set([''])
        const inner = segments.slice(nameLength, -1)
        for (let depth = 1; depth <= inner.length; depth++) {
            subdirs.add(inner.slice(0, depth).join('/'))
        }
        subdirsByRoot.set(root, subdirs)
    }
    return [...subdirsByRoot]
        .map(([root, subdirs]) => {
            const dir = path.join(packageDir, root)
            const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
            const id = `${manifest.name}@${manifest.version}`
            const files = [...subdirs]
                .filter((subdir) => existsSync(path.join(dir, subdir)))
                .flatMap((subdir) =>
                    readdirSync(path.join(dir, subdir))
                        // statSync follows symlinks: a symlinked LICENSE counts, a directory doesn't.
                        .filter((file) => LICENCE_FILE.test(file) && statSync(path.join(dir, subdir, file)).isFile())
                        .map((file) => (subdir ? `${subdir}/${file}` : file))
                )
                .sort(byCodeUnit)
            const text = files
                .map((file) => readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim())
                .join('\n\n')
            if (!text) {
                throw new Error(`${id} ships no licence file`)
            }
            if (text.includes('*/')) {
                throw new Error(`${id}'s licence contains "*/", which would end the notice comment early`)
            }
            return { files, id, text }
        })
        .sort((left, right) => byCodeUnit(left.id, right.id))
}

/**
 * One block comment with every package's notice, packages sharing identical licence text
 * listed together. Throws on an empty list: the bundle always inlines dagre, so finding
 * nothing means the metafile changed shape, not that there is nothing to credit.
 */
function thirdPartyNotice({ packages }) {
    if (packages.length === 0) {
        throw new Error("esbuild's metafile lists no node_modules packages, but the bundle inlines dagre at least")
    }
    const idsByText = new Map()
    for (const pkg of packages) {
        idsByText.set(pkg.text, [...(idsByText.get(pkg.text) ?? []), pkg.id])
    }
    const lines = ['/*! Third-party software bundled into this file, with the notices their licences require.', ' *']
    for (const [text, ids] of idsByText) {
        lines.push(` * ${[...new Set(ids)].join(', ')}:`, ' *')
        lines.push(...text.split('\n').map((line) => (line.trimEnd() ? ` * ${line.trimEnd()}` : ' *')))
        lines.push(' *')
    }
    lines.push(' */')
    return lines.join('\n')
}

const options = {
    absWorkingDir: packageDir,
    bundle: true,
    entryPoints: ['src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
    outfile: 'out/extension.js',
    platform: 'node',
    sourcemap: true,
}

const analysis = await build({ ...options, metafile: true, write: false })
const notice = thirdPartyNotice({ packages: inlinedPackages({ metafile: analysis.metafile }) })
await build({ ...options, footer: { js: notice } })

console.log('✔ Extension bundle complete')
