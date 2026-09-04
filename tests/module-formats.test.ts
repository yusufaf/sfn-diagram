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
