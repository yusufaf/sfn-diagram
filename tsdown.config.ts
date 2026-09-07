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
        dts: true,
        entry: {
            ci: './src/ci/index.ts',
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
            element: './src/element/index.ts',
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
            'element-auto': './src/element/auto.ts',
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
    // A separate build step, not a second entry alongside `cli` above: sharing one
    // rolldown build would split the common code into a chunk that `bin.js` imports
    // by relative path, and Node resolves a relative import of the main module
    // literally against a symlink's own path under --preserve-symlinks-main - the
    // same npm/pnpm bin-symlink scenario this split exists to stop mishandling (see
    // isInvokedDirectly()'s removal and tests/cli-entry.test.ts). Building separately
    // duplicates cli.ts's code into bin.js, trading a larger file for a self-contained
    // one with no relative imports to break.
    {
        clean: false,
        dts: false,
        entry: {
            bin: './src/bin.ts',
        },
        format: ['esm'],
        hash: false,
        outDir: './dist',
        platform: 'neutral',
    },
]);
