import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        exclude: ['packages/**', 'site/**', '**/node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            // Type-only files and ambient declarations have no runtime to cover.
            exclude: ['src/**/*.d.ts', 'src/types/**'],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    exclude: [
                        'packages/**',
                        'site/**',
                        '**/node_modules/**',
                        'tests/performance/**',
                        'tests/element/elementRuntime.test.ts',
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: 'perf',
                    include: ['tests/performance/**/*.test.ts'],
                    // Performance assertions are wall-clock and share the machine with the
                    // puppeteer-driven suites (tests/viewer, tests/visual-outputs) when run
                    // together — that contention is what made the scaling ratio flake. A
                    // single fork with no file parallelism keeps this project's own timing
                    // measurements from contending with each other; running it as a separate
                    // `vitest run --project perf` invocation (see package.json) keeps it off
                    // the puppeteer suites entirely.
                    pool: 'forks',
                    poolOptions: {
                        forks: {
                            singleFork: true,
                        },
                    },
                    fileParallelism: false,
                },
            },
            {
                extends: true,
                test: {
                    name: 'element',
                    include: ['tests/element/elementRuntime.test.ts'],
                    // This suite launches its own Chromium and, per test, shells out to a
                    // separate Node process to build a throwaway browser bundle. Sharing a
                    // worker thread with the other puppeteer-driven suites in 'unit' made its
                    // own browser automation unreliable - same class of contention as 'perf'
                    // above, worked around the same way: an isolated single fork, run as its
                    // own `vitest run --project element` invocation (see package.json).
                    pool: 'forks',
                    poolOptions: {
                        forks: {
                            singleFork: true,
                        },
                    },
                    fileParallelism: false,
                },
            },
        ],
    },
})
