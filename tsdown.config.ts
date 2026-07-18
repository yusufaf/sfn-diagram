import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        clean: true,
        dts: true,
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
        dts: true,
        entry: {
            png: './src/png.ts',
        },
        format: ['cjs', 'esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
    {
        clean: false,
        dts: true,
        entry: {
            aws: './src/aws.ts',
        },
        format: ['cjs', 'esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
    {
        clean: false,
        dts: true,
        entry: {
            cfn: './src/cfn.ts',
        },
        format: ['cjs', 'esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
    {
        clean: false,
        dts: false,
        entry: {
            cli: './src/cli.ts',
        },
        format: ['esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
]);
