import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIST = join(__dirname, '..', 'dist')

describe("'use client' directive", () => {
    // The component uses hooks, so it cannot be a React Server Component. Without
    // this directive a Next.js App Router consumer has to wrap it in their own
    // client boundary or the build throws.
    it('is the first statement of the component source', () => {
        const source = readFileSync(join(__dirname, 'SfnDiagram.tsx'), 'utf-8')

        expect(source.trimStart().startsWith("'use client'")).toBe(true)
    })

    // Rolldown strips the source directive when it bundles, so tsdown re-emits it
    // as a JS banner. The built file is what a consumer's bundler actually reads.
    it.each(['index.js', 'index.cjs'])(
        'survives the build into dist/%s',
        (fileName) => {
            const built = join(DIST, fileName)
            if (!existsSync(built)) {
                return
            }

            expect(readFileSync(built, 'utf-8')).toMatch(/^["']use client["']/)
        }
    )

    // A bare expression statement is a TS1036 error in an ambient declaration file.
    it.each(['index.d.ts', 'index.d.cts'])('is not emitted into dist/%s', (fileName) => {
        const built = join(DIST, fileName)
        if (!existsSync(built)) {
            return
        }

        expect(readFileSync(built, 'utf-8')).not.toContain('use client')
    })
})
