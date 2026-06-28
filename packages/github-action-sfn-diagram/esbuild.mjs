import { build } from 'esbuild'

await build({
    bundle: true,
    entryPoints: ['src/main.ts'],
    format: 'cjs',
    minify: false,
    outfile: 'dist/index.js',
    platform: 'node',
    target: 'node20',
    // @actions packages and sfn-diagram must be bundled (no node_modules in action)
    external: [],
})

console.log('✔ Action bundle complete')
