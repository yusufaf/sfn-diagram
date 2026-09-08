import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf-8')
) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional: boolean }>;
};

describe.each(['@resvg/resvg-js', 'node-html-to-image'])('%s as a PNG engine peer', (name) => {
    it('is declared as an optional peer dependency', () => {
        expect(packageJson.peerDependencies?.[name]).toBeDefined();
        expect(packageJson.peerDependenciesMeta?.[name]?.optional).toBe(true);
    });

    it('is declared as a devDependency for local testing', () => {
        expect(packageJson.devDependencies?.[name]).toBeDefined();
    });

    it('is never a hard dependency', () => {
        expect(packageJson.dependencies?.[name]).toBeUndefined();
    });
});
