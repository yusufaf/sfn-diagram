import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        exclude: ['packages/**', 'site/**', '**/node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: [
                // Type-only files and ambient declarations have no runtime to cover.
                'src/**/*.d.ts',
                'src/types/**',
                // The in-page half of the viewer: this code is serialized into a
                // <script> and executed inside a real Chromium page by
                // tests/viewer/viewerRuntime.test.ts and tests/element/**, where the v8
                // provider cannot see it at all. Counting it measures instrumentation
                // rather than testing - it would put the total at 70% instead of 94%,
                // forcing the thresholds below to a level nothing could trip.
                //
                // Deliberately not the whole of src/renderers/viewer: edgeData,
                // stateData, viewerShell, viewerStyles, scriptJson, minimapThreshold
                // and index all run in plain Node and stay inside the gate. Only the
                // modules below are browser-only. (controller/hash and
                // controller/exportActions do have some Node-side tests, but both are
                // mostly page code, so they follow the rest of controller/.)
                'src/renderers/viewer/controller/**',
                'src/renderers/viewer/*.generated.ts',
                'src/renderers/viewer/relayout.ts',
                'src/renderers/viewer/viewerController.ts',
                'src/renderers/viewer/viewerScript.ts',
            ],
            // Set just under what the unit suite reaches today (94.22 statements,
            // 88.58 branches, 93.55 functions, 94.83 lines), so a real regression
            // fails and ordinary churn does not. Raise them when the real numbers do.
            thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
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
                    maxWorkers: 1,
                    isolate: false,
                    fileParallelism: false,
                    // Vitest 4 refuses to run projects with different maxWorkers in the
                    // same group; a distinct groupOrder keeps an all-project run working.
                    sequence: { groupOrder: 1 },
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
                    maxWorkers: 1,
                    isolate: false,
                    fileParallelism: false,
                    // Vitest 4 refuses to run projects with different maxWorkers in the
                    // same group; a distinct groupOrder keeps an all-project run working.
                    sequence: { groupOrder: 2 },
                },
            },
        ],
    },
})
