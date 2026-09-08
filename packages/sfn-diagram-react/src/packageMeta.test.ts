import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string): Record<string, unknown> =>
    JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>

const reactPackage = readJson(join(__dirname, '..', 'package.json'))
const rootPackage = readJson(join(__dirname, '..', '..', '..', 'package.json'))

const parseVersion = (version: string): { major: number; minor: number } => {
    const [major, minor] = version.split('.').map(Number)
    return { major, minor }
}

// sfn-diagram 1.6.0 introduced collapse, catchHandling, showVariables,
// generateHtml, and edgeOverrides' qualified-id form - everything this package
// forwards from Step 3 onward. A peer floor older than that would let a
// consumer install a core too old to have those options, so props would be
// silently dropped at runtime instead of failing to install.
const MINIMUM_REQUIRED_CORE_VERSION = { major: 1, minor: 6 }

describe('sfn-diagram peer range', () => {
    it('has a caret range no older than the core version this package requires, and no newer than the workspace has', () => {
        const peerRange = (reactPackage.peerDependencies as Record<string, string>)['sfn-diagram']
        expect(peerRange).toMatch(/^\^\d+\.\d+\.\d+$/)

        const floor = parseVersion(peerRange.slice(1))
        const current = parseVersion(rootPackage.version as string)

        expect(floor.major).toBe(MINIMUM_REQUIRED_CORE_VERSION.major)
        expect(floor.minor).toBeGreaterThanOrEqual(MINIMUM_REQUIRED_CORE_VERSION.minor)

        expect(floor.major).toBe(current.major)
        expect(floor.minor).toBeLessThanOrEqual(current.minor)
    })
})
