import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    // Served at the root of sfn.yusufaf.dev (custom domain), not a GH Pages
    // project-page subpath — must be '/', not '/sfn-diagram/'.
    base: '/',
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./test-setup.ts'],
    },
})
