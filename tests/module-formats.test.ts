import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AslDefinition } from '../src/types';

describe('Module Format Compatibility', () => {
    describe('ESM imports', () => {
        it(
            'should import named exports from main entry (no PNG)',
            async () => {
                const { generateSvg, generateMermaid, generateDiagram, SfnDiagramGenerator } =
                    await import('../src/index');

                expect(generateSvg).toBeDefined();
                expect(generateMermaid).toBeDefined();
                expect(generateDiagram).toBeDefined();
                expect(SfnDiagramGenerator).toBeDefined();
            },
            15000
        );

        it('should import exportPng from png sub-path', async () => {
            const { exportPng, PngExporter } = await import('../src/png');

            expect(exportPng).toBeDefined();
            expect(typeof exportPng).toBe('function');
            expect(PngExporter).toBeDefined();
        }, 15000);

        it('should import fetchExecutionHistory from aws sub-path', async () => {
            const { fetchExecutionHistory } = await import('../src/aws');

            expect(fetchExecutionHistory).toBeDefined();
            expect(typeof fetchExecutionHistory).toBe('function');
        }, 15000);

        it('should import runGitlabComment from ci sub-path', async () => {
            const { runGitlabComment, buildAslFileSection } = await import('../src/ci');

            expect(runGitlabComment).toBeDefined();
            expect(typeof runGitlabComment).toBe('function');
            expect(buildAslFileSection).toBeDefined();
            expect(typeof buildAslFileSection).toBe('function');
        }, 15000);

        it('should work with ESM import for generating SVG', async () => {
            const { generateSvg } = await import('../src/index');

            const asl: AslDefinition = {
                StartAt: 'Test',
                States: {
                    Test: { End: true, Type: 'Pass' },
                },
            };

            const result = generateSvg({ aslDefinition: asl });

            expect(result.svg).toBeDefined();
            expect(result.svg).toContain('<svg');
            expect(result.metadata.nodeCount).toBeGreaterThan(0);
        });

        it('should work with ESM default import fallback', async () => {
            const mod = await import('../src/index');

            expect(mod.generateSvg).toBeDefined();
            expect(mod.SfnDiagramGenerator).toBeDefined();
        });
    });

    describe('Type definitions', () => {
        it('should have correct TypeScript types for ESM', async () => {
            const { generateSvg } = await import('../src/index');

            const asl: AslDefinition = {
                StartAt: 'Test',
                States: {
                    Test: { End: true, Type: 'Pass' },
                },
            };

            const result = generateSvg({
                aslDefinition: asl,
                edgeStyle: 'curved',
                layout: 'TB',
                nodeHeight: 60,
                nodeWidth: 120,
                theme: 'light',
            });

            expect(result).toHaveProperty('svg');
            expect(result).toHaveProperty('height');
            expect(result).toHaveProperty('metadata');
            expect(result).toHaveProperty('width');
            expect(result.metadata).toHaveProperty('nodeCount');
            expect(result.metadata).toHaveProperty('edgeCount');
        });
    });

    describe('Class-based API', () => {
        it('should instantiate SfnDiagramGenerator from ESM', async () => {
            const { SfnDiagramGenerator } = await import('../src/index');

            const asl: AslDefinition = {
                StartAt: 'Test',
                States: {
                    Test: { End: true, Type: 'Pass' },
                },
            };

            const generator = new SfnDiagramGenerator({ theme: 'dark' });
            expect(generator).toBeDefined();
            expect(generator.generateSvg).toBeDefined();

            const result = generator.generateSvg({ aslDefinition: asl });
            expect(result.svg).toBeDefined();
            expect(result.svg).toContain('<svg');
        });
    });
});

describe('Published export maps', () => {
    const repoRoot = join(__dirname, '..');
    const readManifest = (name: string): { exports: Record<string, unknown>; version: string } =>
        JSON.parse(readFileSync(join(repoRoot, name), 'utf8'));

    /**
     * npm entry points with no JSR analogue. JSR maps every export to a `.ts` module and
     * publishes neither of these files (`jsr.json` is its manifest, and the schema is not
     * in `publish.include`), so both JSON subpaths are npm-only by design.
     */
    const NPM_ONLY_EXPORTS: readonly string[] = ['./config.schema.json', './package.json'];

    it('offers the same entry points on npm and on JSR', () => {
        // `./ci` shipped on npm for a release without ever reaching jsr.json, so JSR
        // consumers could not import what npm consumers could, with nothing failing the
        // build. Every new entry point has to be added to both manifests.
        const npm = Object.keys(readManifest('package.json').exports)
            .filter((entry) => !NPM_ONLY_EXPORTS.includes(entry))
            .sort();
        const jsr = Object.keys(readManifest('jsr.json').exports).sort();

        expect(jsr).toEqual(npm);
    });

    it('resolves sfn-diagram/package.json through the exports map', () => {
        const requireFromTests = createRequire(__filename);

        expect(requireFromTests.resolve('sfn-diagram/package.json')).toBe(
            join(repoRoot, 'package.json')
        );
        expect((requireFromTests('sfn-diagram/package.json') as { version: string }).version).toBe(
            readManifest('package.json').version
        );
    });

    it('resolves sfn-diagram/config.schema.json through the exports map', () => {
        const requireFromTests = createRequire(__filename);

        expect(requireFromTests.resolve('sfn-diagram/config.schema.json')).toBe(
            join(repoRoot, 'config.schema.json')
        );
        expect(requireFromTests('sfn-diagram/config.schema.json')).toEqual(
            JSON.parse(readFileSync(join(repoRoot, 'config.schema.json'), 'utf8'))
        );
    });

    it('imports both JSON subpaths from ESM with an import attribute', () => {
        // A child process, so Node's own resolver handles the import rather than Vite's.
        const script =
            "import schema from 'sfn-diagram/config.schema.json' with { type: 'json' };" +
            "import manifest from 'sfn-diagram/package.json' with { type: 'json' };" +
            'process.stdout.write(JSON.stringify({ id: schema.$id, version: manifest.version }));';
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: repoRoot,
            encoding: 'utf8',
        });

        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            id: 'https://sfn.yusufaf.dev/config.schema.json',
            version: readManifest('package.json').version,
        });
    }, 15000);
});
