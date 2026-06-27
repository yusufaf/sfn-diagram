import { defineConfig } from 'tsdown'

export default defineConfig({
    clean: true,
    dts: true,
    entry: { index: './src/index.ts' },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'sfn-diagram'] },
    format: ['cjs', 'esm'],
    hash: false,
    outDir: './dist',
    platform: 'neutral',
})
