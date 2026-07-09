import { describe, it } from 'vitest';
import {
    generateSvg,
    generateMermaid,
    embedIcons,
    generateExecution,
    generateMermaidExecution,
} from '../src';
import { exportPng } from '../src/png';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const OUTPUT_DIR = join(__dirname, '..', 'examples', 'outputs');

// Create output directory if it doesn't exist
if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

describe('Visual outputs (generates sample files)', () => {
    // Get all .asl.json files from fixtures
    const fixtureFiles = readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.asl.json'));

    fixtureFiles.forEach((file) => {
        const baseName = file.replace('.asl.json', '');
        const isServicesFixture = baseName === 'services';

        describe(`${baseName} fixture`, () => {
            let aslDefinition: AslDefinition;

            it('should load fixture', () => {
                const aslPath = join(FIXTURES_DIR, file);
                aslDefinition = JSON.parse(readFileSync(aslPath, 'utf-8'));
            });

            it('should generate SVG (light theme)', async () => {
                const options = isServicesFixture
                    ? {
                          aslDefinition,
                          nodeHeight: 70,
                          nodeSeparation: 80,
                          nodeWidth: 240,
                          rankSeparation: 80,
                          showIcons: true,
                          theme: 'light' as const,
                      }
                    : { aslDefinition, theme: 'light' as const };
                const result = generateSvg(options);

                // Embed icons for services fixture to support standalone viewing
                const svg = isServicesFixture ? await embedIcons({ svg: result.svg }) : result.svg;

                const outputPath = join(OUTPUT_DIR, `${baseName}-light.svg`);
                writeFileSync(outputPath, svg);
                console.log(`  ✓ Generated ${baseName}-light.svg (${result.width}x${result.height}px)`);
            });

            it('should generate SVG (dark theme)', async () => {
                const options = isServicesFixture
                    ? {
                          aslDefinition,
                          nodeHeight: 70,
                          nodeSeparation: 80,
                          nodeWidth: 240,
                          rankSeparation: 80,
                          showIcons: true,
                          theme: 'dark' as const,
                      }
                    : { aslDefinition, theme: 'dark' as const };
                const result = generateSvg(options);

                // Embed icons for services fixture to support standalone viewing
                const svg = isServicesFixture ? await embedIcons({ svg: result.svg }) : result.svg;

                const outputPath = join(OUTPUT_DIR, `${baseName}-dark.svg`);
                writeFileSync(outputPath, svg);
                console.log(`  ✓ Generated ${baseName}-dark.svg (${result.width}x${result.height}px)`);
            });

            it('should generate Mermaid', () => {
                const result = generateMermaid({ aslDefinition });
                const outputPath = join(OUTPUT_DIR, `${baseName}.mmd`);
                writeFileSync(outputPath, result.code);
                console.log(`  ✓ Generated ${baseName}.mmd (${result.metadata.stateCount} states)`);
            });

            it('should generate PNG', async () => {
                // For services fixture with icons, we need to embed icons for PNG export
                if (isServicesFixture) {
                    const svgResult = generateSvg({
                        aslDefinition,
                        nodeHeight: 70,
                        nodeSeparation: 80,
                        nodeWidth: 240,
                        rankSeparation: 80,
                        showIcons: true,
                        theme: 'light' as const,
                    });

                    // Embed icons as data URIs so they work in PNG export
                    const svgWithEmbeddedIcons = await embedIcons({ svg: svgResult.svg });

                    // Import PngExporter to use directly with embedded SVG
                    const { PngExporter } = await import('../src/exporters');
                    const exporter = new PngExporter({ backgroundColor: 'white', theme: 'light' });
                    const result = await exporter.convert({
                        svg: svgWithEmbeddedIcons,
                        width: svgResult.width,
                        height: svgResult.height,
                    });

                    const outputPath = join(OUTPUT_DIR, `${baseName}.png`);
                    writeFileSync(outputPath, result.buffer);
                    console.log(`  ✓ Generated ${baseName}.png (${result.width}x${result.height}px)`);
                } else {
                    const result = await exportPng({
                        aslDefinition,
                        backgroundColor: 'white',
                        theme: 'light',
                    });
                    const outputPath = join(OUTPUT_DIR, `${baseName}.png`);
                    writeFileSync(outputPath, result.buffer);
                    console.log(`  ✓ Generated ${baseName}.png (${result.width}x${result.height}px)`);
                }
            }, 15000);
        });
    });

    // Execution overlays pair an ASL definition with a run's history.
    const executionCases = [
        { asl: 'error-handling', history: 'execution-caught', name: 'execution-caught' },
        { asl: 'simple', history: 'execution-failed', name: 'execution-failed' },
        { asl: 'retry', history: 'execution-retry-success', name: 'execution-retry' },
    ];

    executionCases.forEach(({ asl, history, name }) => {
        describe(`${name} overlay`, () => {
            const aslDefinition: AslDefinition = JSON.parse(
                readFileSync(join(FIXTURES_DIR, `${asl}.asl.json`), 'utf-8'),
            );
            const historyJson = readFileSync(join(FIXTURES_DIR, `${history}.json`), 'utf-8');

            it('should generate SVG overlay', () => {
                const result = generateExecution({
                    aslDefinition,
                    history: historyJson,
                    layout: 'LR',
                });
                writeFileSync(join(OUTPUT_DIR, `${name}.svg`), result.svg);
                console.log(
                    `  ✓ Generated ${name}.svg (status: ${result.metadata.executionStatus})`,
                );
            });

            it('should generate Mermaid overlay', () => {
                const result = generateMermaidExecution({ aslDefinition, history: historyJson });
                writeFileSync(join(OUTPUT_DIR, `${name}.mmd`), result.code);
                console.log(`  ✓ Generated ${name}.mmd`);
            });
        });
    });
});
