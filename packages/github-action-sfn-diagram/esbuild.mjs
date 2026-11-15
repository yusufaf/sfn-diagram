import { build } from 'esbuild'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The Action ships one committed file, dist/index.js, with every dependency inlined
// (there is no node_modules at run time). Their licences (MIT, ISC, BlueOak, Apache-2.0)
// require the notice in every copy, and most packages carry it only in a LICENSE file,
// so the build appends those notices to the end of the bundle. src/licenceNotices.test.ts
// checks that every inlined package's notice is there.

const packageDir = import.meta.dirname
// LICENSE, LICENCE.md, LICENSE-MIT, LICENSE-APACHE.txt, NOTICE, COPYING, …; never a
// source file such as license.js.
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i
const MARKER = 'node_modules/'
const NO_LICENCE_FILE = '(apache-2.0, no licence file)'

const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Each third-party package the metafile shows was bundled, with its licence text: the
 * licence files in the package root and in every directory between an inlined file
 * and that root (undici nests one under lib/web/fetch). Keyed by the full path through
 * the last node_modules/, so two copies of one package stay apart.
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
            if (text.includes('*/')) {
                throw new Error(`${id}'s licence contains "*/", which would end the notice comment early`)
            }
            return { files, id, licence: manifest.license, text }
        })
        .sort((left, right) => byCodeUnit(left.id, right.id))
}

/**
 * One block comment with every package's notice, packages sharing identical licence text
 * listed together. A package with no licence file is accepted only under Apache-2.0,
 * whose full text another package already carries.
 */
function thirdPartyNotice({ packages }) {
    const idsByText = new Map()
    for (const pkg of packages) {
        if (!pkg.text && pkg.licence !== 'Apache-2.0') {
            throw new Error(`${pkg.id} ships no licence file and isn't Apache-2.0`)
        }
        const key = pkg.text || NO_LICENCE_FILE
        idsByText.set(key, [...(idsByText.get(key) ?? []), pkg.id])
    }
    if (idsByText.has(NO_LICENCE_FILE) && !packages.some((pkg) => pkg.text && pkg.licence === 'Apache-2.0')) {
        throw new Error('no bundled Apache-2.0 licence text covers the packages that ship none')
    }
    const groups = [...idsByText].sort(
        ([left], [right]) => Number(left === NO_LICENCE_FILE) - Number(right === NO_LICENCE_FILE)
    )
    const lines = ['/*! Third-party software bundled into this file, with the notices their licences require.', ' *']
    for (const [text, ids] of groups) {
        lines.push(` * ${[...new Set(ids)].join(', ')}:`, ' *')
        if (text === NO_LICENCE_FILE) {
            lines.push(' * Apache-2.0. These packages ship no licence file; the Apache License 2.0 text is above.')
        } else {
            lines.push(...text.split('\n').map((line) => (line.trimEnd() ? ` * ${line.trimEnd()}` : ' *')))
        }
        lines.push(' *')
    }
    lines.push(' */')
    return lines.join('\n')
}

const result = await build({
    absWorkingDir: packageDir,
    bundle: true,
    entryPoints: ['src/main.ts'],
    format: 'cjs',
    // legalComments stays at its default, 'eof': that keeps core's d3 notice and the
    // notices undici carries for the code it vendors.
    metafile: true,
    minify: false,
    outfile: 'dist/index.js',
    platform: 'node',
    target: 'node24',
    write: false,
    // @actions packages and sfn-diagram must be bundled (no node_modules in action)
    external: [],
})

const [output] = result.outputFiles
mkdirSync(path.join(packageDir, 'dist'), { recursive: true })
writeFileSync(
    path.join(packageDir, 'dist/index.js'),
    `${output.text}${thirdPartyNotice({ packages: inlinedPackages({ metafile: result.metafile }) })}\n`
)

console.log('✔ Action bundle complete')
