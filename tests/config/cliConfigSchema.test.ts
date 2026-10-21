import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import {
    CONFIG_FIELDS,
    loadCommentGitlabConfig,
    validateCliConfig,
} from '../../src/cliConfig';
import { buildCliConfigSchema } from '../../src/cliConfigSchema';

const schema = buildCliConfigSchema();
// Compiled once: Ajv refuses a second schema with the same $id.
const validateSchema = new Ajv({ strict: true }).compile(schema);

/** Every string any `enum` in the schema allows, so each enum value is probed. */
function enumStrings(node: unknown): string[] {
    if (Array.isArray(node)) return node.flatMap(enumStrings);
    if (typeof node !== 'object' || node === null) return [];
    const own = Array.isArray((node as { enum?: unknown }).enum)
        ? ((node as { enum: unknown[] }).enum.filter(
              (value) => typeof value === 'string',
          ) as string[])
        : [];
    return [...own, ...Object.values(node).flatMap(enumStrings)];
}

const STYLE_ENTRIES: unknown[] = [
    { fill: '#fff' },
    { fill: '' },
    { fill: ' ' },
    { fill: 'rgb(255 153 0 / 50%)' },
    { fill: 'red;stroke:blue' },
    { fill: 'red\nclick A call x()' },
    { fill: 'red\u2028x' },
    { fill: 'red\u2029x' },
    { fill: 'red\u007fx' },
    { fill: 'red\u0085x' },
    { fill: ' red ' },
    { stroke: '{x}' },
    { stroke: '#000' },
    { shape: 'circle' },
    { shape: 'hexagon' },
    { strokeWidth: 0 },
    { strokeWidth: -1 },
    { strokeOpacity: 1 },
    { strokeOpacity: 1.5 },
    {},
    { fil: '#fff' },
    { fill: '#fff', shape: 'rect' },
    'red',
    null,
    [],
];

const STYLE_KEYS = ['Task', 'task', 'Only', 'A->B', 'A->B#choice#1', ''];

const PROBES: unknown[] = [
    null,
    true,
    false,
    0,
    0.5,
    1,
    2,
    10,
    10.5,
    -1,
    '',
    '  ',
    'x',
    '#fff',
    ...new Set(enumStrings(schema)),
    [],
    ['A'],
    [''],
    ['  A'],
    [1],
    {},
    { base: 'dark' },
    { backgroundColor: '#111' },
    { fontSize: 'big' },
    ...STYLE_KEYS.flatMap((key) =>
        STYLE_ENTRIES.map((entry) => ({ [key]: entry })),
    ),
];

const validatorAccepts = (raw: Record<string, unknown>): boolean => {
    try {
        validateCliConfig({ path: 'probe', raw });
        return true;
    } catch {
        return false;
    }
};

describe('config JSON Schema', () => {
    it('matches the committed config.schema.json', () => {
        const committed: unknown = JSON.parse(
            readFileSync('config.schema.json', 'utf-8'),
        );
        expect(
            committed,
            'config.schema.json is stale: run `pnpm run build:config-schema`',
        ).toEqual(schema);
    });

    it('declares every config field, each with a description', () => {
        const properties = schema.properties ?? {};
        expect(Object.keys(properties).sort()).toEqual(
            ['$schema', 'commentGitlab', ...Object.keys(CONFIG_FIELDS)].sort(),
        );
        for (const [name, property] of Object.entries(properties)) {
            expect(
                typeof property === 'object' && property.description,
                `${name} has no description`,
            ).toBeTruthy();
        }
    });

    it('accepts exactly the values the CLI validator accepts', () => {
        const disagreements: string[] = [];
        for (const field of Object.keys(CONFIG_FIELDS)) {
            for (const probe of PROBES) {
                const raw = { [field]: probe };
                const bySchema = validateSchema(raw);
                const byValidator = validatorAccepts(raw);
                if (bySchema !== byValidator) {
                    disagreements.push(
                        `${field} = ${JSON.stringify(probe)}: schema ${bySchema}, validator ${byValidator}`,
                    );
                }
            }
        }
        expect(disagreements).toEqual([]);
    });

    it('accepts exactly the commentGitlab blocks the CLI accepts', () => {
        const root = mkdtempSync(join(tmpdir(), 'sfn-config-schema-'));
        try {
            const explicitPath = join(root, 'sfn-diagram.config.json');
            const disagreements: string[] = [];
            for (const probe of [
                null,
                {},
                { theme: 'dark' },
                { layout: 'XX' },
                { format: 'svg' },
                { nodeOverrides: { Only: { fill: '#fff' } } },
                'x',
                [],
            ]) {
                writeFileSync(explicitPath, JSON.stringify({ commentGitlab: probe }));
                let byLoader = true;
                try {
                    loadCommentGitlabConfig({ explicitPath, startDir: root });
                } catch {
                    byLoader = false;
                }
                const bySchema = validateSchema({ commentGitlab: probe });
                if (bySchema !== byLoader) {
                    disagreements.push(
                        `commentGitlab = ${JSON.stringify(probe)}: schema ${bySchema}, loader ${byLoader}`,
                    );
                }
            }
            expect(disagreements).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('allows $schema, and flags an unknown key the CLI itself ignores', () => {
        // Deliberate: editors flag a typo, while the CLI drops unknown keys so a field
        // from a later release does not fail an older CLI.
        expect(validateSchema({ $schema: 'x' })).toBe(true);
        expect(validatorAccepts({ $schema: 'x' })).toBe(true);
        expect(validateSchema({ widht: 1 })).toBe(false);
        expect(validatorAccepts({ widht: 1 })).toBe(true);
    });

    it('lists every config field in the CLI guide\'s "What it can set" table', () => {
        const lines = readFileSync(
            'site/src/content/docs/guides/cli.mdx',
            'utf-8',
        ).split(/\r?\n/);
        const start = lines.indexOf('### What it can set');
        const end = lines.findIndex(
            (line, index) => index > start && line.startsWith('### '),
        );
        const names = new Set(
            lines
                .slice(start, end)
                .filter((line) => line.startsWith('|'))
                .flatMap((row) =>
                    [...(row.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map(
                        (match) => match[1],
                    ),
                ),
        );
        // Guards against a broken slice passing with nothing to compare.
        expect(names.size).toBeGreaterThan(20);
        expect(
            Object.keys(CONFIG_FIELDS).filter((field) => !names.has(field)),
        ).toEqual([]);
    });
});
