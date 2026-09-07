import { defineConfig } from 'tsdown'

export default defineConfig({
    // Rolldown drops the source directive when it bundles, and a Next.js App Router
    // consumer reads it off the built file rather than off `src/`. JS only - a bare
    // expression statement in a `.d.ts` is a TS1036 error.
    banner: { js: "'use client'" },
    clean: true,
    dts: true,
    entry: { index: './src/index.ts' },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'sfn-diagram'] },
    format: ['cjs', 'esm'],
    hash: false,
    outDir: './dist',
    platform: 'neutral',
})
