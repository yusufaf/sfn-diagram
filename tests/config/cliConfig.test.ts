import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAMES, discoverConfigPath } from '../../src/cliConfig';

describe('discoverConfigPath', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sfn-config-'));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('returns null when no config exists anywhere above startDir', () => {
        // A .git entry stops the walk, so the search cannot escape the temp dir and
        // find the developer's own config while the test runs.
        writeFileSync(join(root, '.git'), '');
        expect(discoverConfigPath({ startDir: root })).toBeNull();
    });

    it('finds a config in startDir itself', () => {
        writeFileSync(join(root, '.git'), '');
        const configPath = join(root, 'sfn-diagram.config.json');
        writeFileSync(configPath, '{}');
        expect(discoverConfigPath({ startDir: root })).toBe(configPath);
    });

    it('walks up to find a config in an ancestor', () => {
        writeFileSync(join(root, '.git'), '');
        const configPath = join(root, 'sfn-diagram.config.json');
        writeFileSync(configPath, '{}');
        const nested = join(root, 'a', 'b', 'c');
        mkdirSync(nested, { recursive: true });
        expect(discoverConfigPath({ startDir: nested })).toBe(configPath);
    });

    it('prefers the nearest config when several exist on the way up', () => {
        writeFileSync(join(root, '.git'), '');
        writeFileSync(join(root, 'sfn-diagram.config.json'), '{}');
        const nested = join(root, 'a');
        mkdirSync(nested, { recursive: true });
        const nearer = join(nested, 'sfn-diagram.config.json');
        writeFileSync(nearer, '{}');
        expect(discoverConfigPath({ startDir: nested })).toBe(nearer);
    });

    it('stops at a directory containing .git', () => {
        writeFileSync(join(root, 'sfn-diagram.config.json'), '{}');
        const repo = join(root, 'repo');
        mkdirSync(repo, { recursive: true });
        writeFileSync(join(repo, '.git'), '');
        expect(discoverConfigPath({ startDir: repo })).toBeNull();
    });

    it('resolves ties within one directory by CONFIG_FILENAMES order', () => {
        writeFileSync(join(root, '.git'), '');
        // Written in reverse so the result cannot come from creation order.
        for (const name of [...CONFIG_FILENAMES].reverse()) {
            writeFileSync(join(root, name), '{}');
        }
        expect(discoverConfigPath({ startDir: root })).toBe(
            join(root, CONFIG_FILENAMES[0]),
        );
    });

    it('lists the filenames it searches, nearest-first within a directory', () => {
        expect([...CONFIG_FILENAMES]).toEqual([
            'sfn-diagram.config.json',
            'sfn-diagram.config.yaml',
            'sfn-diagram.config.yml',
            '.sfn-diagramrc',
            '.sfn-diagramrc.json',
            '.sfn-diagramrc.yaml',
        ]);
    });

    it('ignores a directory that shares a config filename', () => {
        writeFileSync(join(root, '.git'), '');
        mkdirSync(join(root, 'sfn-diagram.config.json'));
        expect(discoverConfigPath({ startDir: root })).toBeNull();
    });
});
