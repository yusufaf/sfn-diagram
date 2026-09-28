import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CONFIG_FILENAMES,
    CliConfigError,
    discoverConfigPath,
    loadCliConfig,
} from '../../src/cliConfig';

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

describe('loadCliConfig', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sfn-config-load-'));
        writeFileSync(join(root, '.git'), '');
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const write = (name: string, contents: string): string => {
        const path = join(root, name);
        writeFileSync(path, contents);
        return path;
    };

    it('returns null when there is no config to load', () => {
        expect(
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toBeNull();
    });

    it('reads a discovered JSON config', () => {
        const path = write(
            'sfn-diagram.config.json',
            JSON.stringify({ layout: 'LR', padding: 40, theme: 'dark' }),
        );
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { layout: 'LR', padding: 40, theme: 'dark' },
            path,
        });
    });

    it('reads a YAML config', () => {
        const path = write(
            'sfn-diagram.config.yaml',
            'layout: LR\nshowIcons: true\niconSize: 32\n',
        );
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { iconSize: 32, layout: 'LR', showIcons: true },
            path,
        });
    });

    it('parses an extensionless .sfn-diagramrc as YAML', () => {
        const path = write('.sfn-diagramrc', 'theme: dark\n');
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { theme: 'dark' },
            path,
        });
    });

    it('accepts JSON in an extensionless .sfn-diagramrc', () => {
        // YAML 1.2 is a JSON superset, so one parse path covers both.
        const path = write('.sfn-diagramrc', '{ "theme": "dark" }');
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { theme: 'dark' },
            path,
        });
    });

    it('reads the file --config names, skipping discovery', () => {
        write('sfn-diagram.config.json', JSON.stringify({ theme: 'dark' }));
        const explicit = write(
            'other.json',
            JSON.stringify({ theme: 'light' }),
        );
        expect(
            loadCliConfig({ explicitPath: explicit, startDir: root }),
        ).toEqual({
            config: { theme: 'light' },
            path: explicit,
        });
    });

    it('throws when --config names a file that does not exist', () => {
        expect(() =>
            loadCliConfig({
                explicitPath: join(root, 'absent.json'),
                startDir: root,
            }),
        ).toThrowError(CliConfigError);
    });

    it('throws when the file is not valid JSON or YAML', () => {
        write('sfn-diagram.config.json', '{ "theme": ');
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/sfn-diagram\.config\.json/);
    });

    it.each([
        ['an array', '[]'],
        ['a string', '"dark"'],
        ['a number', '42'],
    ])('throws when the top level is %s', (_label, contents) => {
        write('sfn-diagram.config.json', contents);
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/must be an object/);
    });

    it('treats an empty file as an empty config', () => {
        const path = write('sfn-diagram.config.yaml', '');
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: {},
            path,
        });
    });

    it('treats an explicit null document as an empty config', () => {
        const path = write('sfn-diagram.config.yaml', 'null\n');
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: {},
            path,
        });
    });

    it.each([
        ['theme', 'neon', /theme/],
        ['layout', 'diagonal', /layout/],
        ['format', 'gif', /format/],
        ['edgeStyle', 'wiggly', /edgeStyle/],
        ['stylePreset', 'fancy', /stylePreset/],
        ['catchLabelStyle', 'numbers', /catchLabelStyle/],
        ['iconPosition', 'middle', /iconPosition/],
        ['catchHandling', 'maybe', /catchHandling/],
    ])('throws for an out-of-range %s', (field, value, pattern) => {
        write('sfn-diagram.config.json', JSON.stringify({ [field]: value }));
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(pattern);
    });

    it.each([
        ['padding', '"wide"'],
        ['nodeWidth', 'true'],
        ['iconSize', '"big"'],
        ['showIcons', '"yes"'],
        ['includeComments', '1'],
        ['diagramTitle', '42'],
        ['collapse', '3'],
    ])('throws when %s has the wrong type', (field, jsonValue) => {
        write('sfn-diagram.config.json', `{ "${field}": ${jsonValue} }`);
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(new RegExp(field));
    });

    it('applies the same pixel bounds the flags use', () => {
        write('sfn-diagram.config.json', JSON.stringify({ nodeWidth: 0 }));
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/nodeWidth/);
    });

    it('accepts zero for padding and the separations, as the flags do', () => {
        const path = write(
            'sfn-diagram.config.json',
            JSON.stringify({
                nodeSeparation: 0,
                padding: 0,
                rankSeparation: 0,
            }),
        );
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { nodeSeparation: 0, padding: 0, rankSeparation: 0 },
            path,
        });
    });

    it('rejects a blank string field, as the flags do', () => {
        write(
            'sfn-diagram.config.json',
            JSON.stringify({ diagramTitle: '  ' }),
        );
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/diagramTitle/);
    });

    it('ignores keys it does not know, including $schema', () => {
        // A typo'd key doing nothing is unfortunate, but rejecting unknown keys would
        // break `$schema` and any future additive field, so unknown keys are dropped.
        const path = write(
            'sfn-diagram.config.json',
            JSON.stringify({
                $schema: 'https://example.invalid/s.json',
                theme: 'dark',
                widht: 100,
            }),
        );
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { theme: 'dark' },
            path,
        });
    });

    it('accepts collapse as true', () => {
        write('sfn-diagram.config.json', JSON.stringify({ collapse: true }));
        expect(
            loadCliConfig({ explicitPath: null, startDir: root })?.config,
        ).toEqual({ collapse: true });
    });

    it('accepts collapse as a list of names', () => {
        write(
            'sfn-diagram.config.json',
            JSON.stringify({ collapse: ['Fan', 'Map'] }),
        );
        expect(
            loadCliConfig({ explicitPath: null, startDir: root })?.config,
        ).toEqual({ collapse: ['Fan', 'Map'] });
    });

    it('rejects a collapse list containing a non-string', () => {
        write(
            'sfn-diagram.config.json',
            JSON.stringify({ collapse: ['Fan', 7] }),
        );
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/collapse/);
    });

    it('names the file in every error, so the reader knows which one to fix', () => {
        const path = write(
            'sfn-diagram.config.json',
            JSON.stringify({ theme: 'neon' }),
        );
        let message = '';
        try {
            loadCliConfig({ explicitPath: null, startDir: root });
            expect.unreachable('an invalid theme should throw');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain(path);
    });

    it('accepts a custom theme object, not just a built-in name', () => {
        const path = write(
            'sfn-diagram.config.json',
            JSON.stringify({ theme: { base: 'dark', background: '#101014' } }),
        );
        expect(loadCliConfig({ explicitPath: null, startDir: root })).toEqual({
            config: { theme: { background: '#101014', base: 'dark' } },
            path,
        });
    });

    it('rejects a theme that is an array', () => {
        write('sfn-diagram.config.json', JSON.stringify({ theme: ['dark'] }));
        expect(() =>
            loadCliConfig({ explicitPath: null, startDir: root }),
        ).toThrowError(/theme/);
    });
});
