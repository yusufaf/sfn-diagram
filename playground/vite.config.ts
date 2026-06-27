import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    base: '/sfn-diagram/',
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./test-setup.ts'],
    },
})
