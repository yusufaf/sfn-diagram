import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig([
    {
        ignores: ['dist/', '**/dist/', '**/out/', 'node_modules/', 'site/.astro/', 'site/src/content/docs/reference/', '*.config.js', 'examples/outputs/', 'scripts/', 'coverage/', '**/coverage/', '**/viewerScript.generated.ts'],
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
        plugins: { js },
        extends: ['js/recommended', eslintConfigPrettier],
        languageOptions: { globals: globals.browser },
    },
    tseslint.configs.recommended,
]);
