import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = join(__dirname, '..')
const DIST = join(PACKAGE_DIR, 'dist')

interface Manifest {
    engines: { node: string }
    exports: Record<string, Record<string, unknown>>
    main?: string
}

const readManifest = (path: string): Manifest =>
    JSON.parse(readFileSync(path, 'utf-8')) as Manifest

const manifest = readManifest(join(PACKAGE_DIR, 'package.json'))
const rootManifest = readManifest(join(PACKAGE_DIR, '..', '..', 'package.json'))

// Like core since 2.0 (#524), this package ships ES modules only. These read
// `dist/`, so the package's `test` script builds first.
describe('module format', () => {
    it('declares ES module entry points only', () => {
        expect(manifest.main).toBeUndefined()
        const entry = manifest.exports['.']
        expect(Object.keys(entry)).toEqual(['types', 'default'])
        expect(entry.types).toMatch(/\.d\.ts$/)
        expect(entry.default).toMatch(/\.js$/)
    })

    it('requires the same Node floor as core', () => {
        expect(manifest.engines.node).toBe(rootManifest.engines.node)
    })

    it('emits no CommonJS files or CommonJS declarations', () => {
        expect(readdirSync(DIST).filter((name) => /\.(cjs|d\.cts)$/.test(name))).toEqual([])
    })

    // Node 22.12 and later load an ES module through require(), which is what keeps
    // CommonJS callers working without a CommonJS build.
    it('lets CommonJS require() load the ES module', () => {
        const script = [
            "const reactPackage = require('sfn-diagram-react')",
            'console.log(JSON.stringify({',
            '    exportNames: Object.keys(reactPackage).sort(),',
            "    resolved: require.resolve('sfn-diagram-react'),",
            '}))',
        ].join('\n')
        const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', script], {
            cwd: PACKAGE_DIR,
            encoding: 'utf8',
        })

        expect(result.status, result.stderr).toBe(0)
        const output = JSON.parse(result.stdout) as { exportNames: string[]; resolved: string }
        expect(output.resolved.replace(/\\/g, '/')).toMatch(/dist\/index\.js$/)
        expect(output.exportNames).toEqual(['SfnDiagram', 'useSfnDiagram'])
    }, 30000)
})
