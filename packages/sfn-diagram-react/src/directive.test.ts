import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIST = join(__dirname, '..', 'dist')

// These read `dist/`, so the package's `test` script builds first. An absent file
// fails rather than skips: a vacuous pass here would not guard anything.
const built = (fileName: string): string => readFileSync(join(DIST, fileName), 'utf-8')

describe("'use client' directive", () => {
    // Both modules use hooks, so neither can be a React Server Component. Without
    // this directive a Next.js App Router consumer has to wrap it in their own
    // client boundary or the build throws.
    it.each(['SfnDiagram.tsx', 'useSfnDiagram.ts'])(
        'is the first statement of %s',
        (fileName) => {
            const source = readFileSync(join(__dirname, fileName), 'utf-8')

            expect(source.trimStart().startsWith("'use client'")).toBe(true)
        }
    )

    // Rolldown strips the source directive when it bundles, so tsdown re-emits it
    // as a JS banner. The built file is what a consumer's bundler actually reads.
    it.each(['index.js', 'index.cjs'])('survives the build into dist/%s', (fileName) => {
        expect(built(fileName)).toMatch(/^["']use client["']/)
    })

    // A bare expression statement is a TS1036 error in an ambient declaration file.
    it.each(['index.d.ts', 'index.d.cts'])('is not emitted into dist/%s', (fileName) => {
        expect(built(fileName)).not.toContain('use client')
    })
})
