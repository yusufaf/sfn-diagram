import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        clean: true,
        dts: {
            resolve: true,
        },
        entry: {
            index: './src/index.ts',
        },
        format: ['cjs', 'esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
    {
        clean: false,
        dts: {
            resolve: true,
        },
        entry: {
            png: './src/png.ts',
        },
        format: ['cjs', 'esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
]);
