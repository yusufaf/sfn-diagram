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

// sfn-diagram 2.0 introduced the `sfn-diagram/html` subpath this package renders
// `format="html"` through, typed definitions as `AslDefinition`, made `idPrefix`
// the way each diagram gets its own marker ids, added the `aborted` execution
// status, and went ES modules only on Node 22.12. A peer floor older than that
// would let a consumer install a core this package cannot import from.
const MINIMUM_REQUIRED_CORE_VERSION = { major: 2, minor: 0 }

describe('sfn-diagram peer range', () => {
    it('has a caret range no older than the core version this package requires, and no newer than the next core release', () => {
        const peerRange = (reactPackage.peerDependencies as Record<string, string>)['sfn-diagram']
        expect(peerRange).toMatch(/^\^\d+\.\d+\.\d+$/)

        const floor = parseVersion(peerRange.slice(1))
        const current = parseVersion(rootPackage.version as string)

        expect(floor.major).toBe(MINIMUM_REQUIRED_CORE_VERSION.major)
        expect(floor.minor).toBeGreaterThanOrEqual(MINIMUM_REQUIRED_CORE_VERSION.minor)

        if (floor.major === current.major) {
            expect(floor.minor).toBeLessThanOrEqual(current.minor)
        } else {
            // The peer may name the next core major before release-please bumps the
            // workspace version, since both publish in the same release run.
            expect(floor.major).toBe(current.major + 1)
            expect(peerRange).toBe(`^${floor.major}.0.0`)
        }
    })
})
