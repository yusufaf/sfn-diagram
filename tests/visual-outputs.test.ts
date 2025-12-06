import { describe, it } from 'vitest';
import { generateSvg, generateMermaid, exportPng } from '../src';
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

        describe(`${baseName} fixture`, () => {
            let aslDefinition: AslDefinition;

            it('should load fixture', () => {
                const aslPath = join(FIXTURES_DIR, file);
                aslDefinition = JSON.parse(readFileSync(aslPath, 'utf-8'));
            });

            it('should generate SVG (light theme)', () => {
                const result = generateSvg({ aslDefinition, theme: 'light' });
                const outputPath = join(OUTPUT_DIR, `${baseName}-light.svg`);
                writeFileSync(outputPath, result.svg);
                console.log(`  ✓ Generated ${baseName}-light.svg (${result.width}x${result.height}px)`);
            });

            it('should generate SVG (dark theme)', () => {
                const result = generateSvg({ aslDefinition, theme: 'dark' });
                const outputPath = join(OUTPUT_DIR, `${baseName}-dark.svg`);
                writeFileSync(outputPath, result.svg);
                console.log(`  ✓ Generated ${baseName}-dark.svg (${result.width}x${result.height}px)`);
            });

            it('should generate Mermaid', () => {
                const result = generateMermaid({ aslDefinition });
                const outputPath = join(OUTPUT_DIR, `${baseName}.mmd`);
                writeFileSync(outputPath, result.code);
                console.log(`  ✓ Generated ${baseName}.mmd (${result.metadata.stateCount} states)`);
            });

            it('should generate PNG', async () => {
                const result = await exportPng({
                    aslDefinition,
                    theme: 'light',
                    backgroundColor: 'white',
                });
                const outputPath = join(OUTPUT_DIR, `${baseName}.png`);
                writeFileSync(outputPath, result.buffer);
                console.log(`  ✓ Generated ${baseName}.png (${result.width}x${result.height}px)`);
            }, 15000); // PNG generation can take time
        });
    });
});
