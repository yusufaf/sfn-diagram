import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        exclude: ['packages/**', 'playground/**', 'site/**', 'node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            // Type-only files and ambient declarations have no runtime to cover.
            exclude: ['src/**/*.d.ts', 'src/types/**'],
        },
    },
})
