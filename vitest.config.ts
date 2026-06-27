import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        exclude: ['packages/**', 'playground/**', 'node_modules/**'],
    },
})
