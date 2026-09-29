import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CEM_ARGS, MANIFEST_FILE, manifestsMatch } from '../../scripts/check-manifest.mjs';

const repoRoot = resolve(__dirname, '../..');

describe('manifestsMatch', () => {
    it('ignores a difference in real line endings', () => {
        expect(
            manifestsMatch({ committed: '{\r\n  "a": 1\r\n}\r\n', regenerated: '{\n  "a": 1\n}\n' })
        ).toBe(true);
    });

    it('ignores CRLF escaped inside a JSON string, which is the churn this file shows', () => {
        // The committed file carries `\r\n` *inside* description values, where git's
        // own eol normalization cannot reach it, while the analyzer emits `\n`. This
        // is a real difference between the committed bytes and a fresh run on any
        // platform - not a Windows-only nicety.
        expect(
            manifestsMatch({
                committed: '{"description":"first\\r\\nsecond"}\r\n',
                regenerated: '{"description":"first\\nsecond"}\n',
            })
        ).toBe(true);
    });

    it('ignores a missing trailing newline', () => {
        expect(manifestsMatch({ committed: '{"a":1}\n', regenerated: '{"a":1}' })).toBe(true);
    });

    it('fails on a real content difference', () => {
        expect(manifestsMatch({ committed: '{"a":1}', regenerated: '{"a":2}' })).toBe(false);
    });

    it('fails when a description gained a word, which is what stale docs look like', () => {
        expect(
            manifestsMatch({
                committed: '{"description":"Register it."}',
                regenerated: '{"description":"Register it. PROBE."}',
            })
        ).toBe(false);
    });
});

describe('the check and build:manifest analyze the same thing', () => {
    it('uses the globs package.json#build:manifest uses', () => {
        const packageJson = JSON.parse(
            readFileSync(join(repoRoot, 'package.json'), 'utf-8')
        ) as { scripts: Record<string, string> };
        const buildManifest = packageJson.scripts['build:manifest'];

        // Drifting globs would make the check compare against a manifest describing a
        // different set of files, which passes while the committed file is stale.
        for (const argument of CEM_ARGS) {
            expect(buildManifest).toContain(argument);
        }
        expect(buildManifest).toContain('cem');
    });

    it('checks the file package.json points editors at', () => {
        const packageJson = JSON.parse(
            readFileSync(join(repoRoot, 'package.json'), 'utf-8')
        ) as { customElements?: string };

        expect(packageJson.customElements).toBe(MANIFEST_FILE);
    });
});
