import { describe, it, expect } from 'vitest';
import {
    generateSvg,
    generateMermaid,
    generateDiagram,
    generateFromAwsResponse,
    SfnDiagramGenerator,
    AslValidationError,
} from '../src';
import { exportPng } from '../src/png';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AslDefinition } from '../src/types';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

describe('Integration Tests', () => {
    describe('generateSvg', () => {
        it('should generate SVG from ASL definition object', () => {
            const aslDefinition = loadFixture('simple');
            const result = generateSvg({ aslDefinition });

            expect(result.svg).toBeDefined();
            expect(result.svg).toContain('<svg');
            expect(result.width).toBeGreaterThan(0);
            expect(result.height).toBeGreaterThan(0);
        });

        it('should generate SVG from JSON string', () => {
            const aslString = JSON.stringify(loadFixture('simple'));
            const result = generateSvg({ aslDefinition: aslString });

            expect(result.svg).toBeDefined();
            expect(result.svg).toContain('<svg');
        });

        it('should apply theme option', () => {
            const aslDefinition = loadFixture('simple');
            const lightResult = generateSvg({ aslDefinition, theme: 'light' });
            const darkResult = generateSvg({ aslDefinition, theme: 'dark' });

            expect(lightResult.svg).toBeDefined();
            expect(darkResult.svg).toBeDefined();
            // Light and dark should produce different output
            expect(lightResult.svg).not.toBe(darkResult.svg);
        });

        it('should apply layout option', () => {
            const aslDefinition = loadFixture('simple');
            const tbResult = generateSvg({ aslDefinition, layout: 'TB' });
            const lrResult = generateSvg({ aslDefinition, layout: 'LR' });

            expect(tbResult.svg).toBeDefined();
            expect(lrResult.svg).toBeDefined();
            // Different layouts should produce different dimensions
            expect(tbResult.width !== lrResult.width || tbResult.height !== lrResult.height).toBe(
                true
            );
        });

        it('should handle complex state machines', () => {
            const aslDefinition = loadFixture('choice');
            const result = generateSvg({ aslDefinition });

            expect(result.svg).toContain('CheckValue');
            expect(result.metadata.nodeCount).toBeGreaterThan(1);
        });
    });

    describe('generateMermaid', () => {
        it('should generate Mermaid code from ASL definition', () => {
            const aslDefinition = loadFixture('simple');
            const result = generateMermaid({ aslDefinition });

            expect(result.code).toBeDefined();
            expect(result.code).toContain('stateDiagram-v2');
            expect(result.metadata.stateCount).toBe(3);
        });

        it('should generate Mermaid from JSON string', () => {
            const aslString = JSON.stringify(loadFixture('simple'));
            const result = generateMermaid({ aslDefinition: aslString });

            expect(result.code).toBeDefined();
            expect(result.code).toContain('stateDiagram-v2');
        });

        it('should handle complex state machines', () => {
            const aslDefinition = loadFixture('parallel');
            const result = generateMermaid({ aslDefinition });

            expect(result.code).toContain('ParallelExecution');
            expect(result.code).toContain('Branch1');
            expect(result.code).toContain('Branch2');
        });
    });

    describe('generateDiagram', () => {
        it('should default to SVG format', () => {
            const aslDefinition = loadFixture('simple');
            const result = generateDiagram({ aslDefinition });

            expect('svg' in result).toBe(true);
            expect('code' in result).toBe(false);
        });

        it('should generate SVG when format is specified', () => {
            const aslDefinition = loadFixture('simple');
            const result = generateDiagram({ aslDefinition, format: 'svg' });

            expect('svg' in result).toBe(true);
        });

        it('should generate Mermaid when format is specified', () => {
            const aslDefinition = loadFixture('simple');
            const result = generateDiagram({ aslDefinition, format: 'mermaid' });

            expect('code' in result).toBe(true);
        });
    });

    describe('exportPng', () => {
        it('should export PNG from ASL definition', async () => {
            const aslDefinition = loadFixture('simple');
            const result = await exportPng({ aslDefinition });

            expect(result.buffer).toBeDefined();
            expect(result.buffer).toBeInstanceOf(Buffer);
            expect(result.width).toBeGreaterThan(0);
            expect(result.height).toBeGreaterThan(0);
            expect(result.metadata).toBeDefined();
            expect(result.metadata.format).toBe('png');
        });

        it('should apply PNG quality option', async () => {
            const aslDefinition = loadFixture('simple');
            const result = await exportPng({ aslDefinition, pngQuality: 50 });

            expect(result.buffer).toBeDefined();
        });

        it('should apply background color option', async () => {
            const aslDefinition = loadFixture('simple');
            const result = await exportPng({ aslDefinition, backgroundColor: 'white' });

            expect(result.buffer).toBeDefined();
        });
    }, 15000); // Increase timeout for PNG tests

    describe('generateFromAwsResponse', () => {
        it('should generate diagram from AWS SDK response', () => {
            const aslDefinition = loadFixture('simple');
            const mockResponse = {
                definition: JSON.stringify(aslDefinition),
                stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
            };

            const result = generateFromAwsResponse({ response: mockResponse });

            expect('svg' in result).toBe(true);
        });

        it('should support format option', () => {
            const aslDefinition = loadFixture('simple');
            const mockResponse = {
                definition: JSON.stringify(aslDefinition),
            };

            const result = generateFromAwsResponse({ response: mockResponse, format: 'mermaid' });

            expect('code' in result).toBe(true);
        });

        it('should throw error if definition is missing', () => {
            const mockResponse = {};

            expect(() => generateFromAwsResponse({ response: mockResponse })).toThrow(
                'No definition found in AWS response'
            );
        });
    });

    describe('SfnDiagramGenerator class', () => {
        it('should create instance with default options', () => {
            const generator = new SfnDiagramGenerator();
            const aslDefinition = loadFixture('simple');
            const result = generator.generate({ aslDefinition });

            expect('svg' in result).toBe(true);
        });

        it('should create instance with custom options', () => {
            const generator = new SfnDiagramGenerator({ theme: 'dark', layout: 'LR' });
            const aslDefinition = loadFixture('simple');
            const result = generator.generateSvg({ aslDefinition });

            expect(result.svg).toBeDefined();
        });

        it('should support generateSvg method', () => {
            const generator = new SfnDiagramGenerator();
            const aslDefinition = loadFixture('simple');
            const result = generator.generateSvg({ aslDefinition });

            expect(result.svg).toBeDefined();
        });

        it('should support generateMermaid method', () => {
            const generator = new SfnDiagramGenerator();
            const aslDefinition = loadFixture('simple');
            const result = generator.generateMermaid({ aslDefinition });

            expect(result.code).toBeDefined();
        });

        it('should support exportPng via png sub-path', async () => {
            const aslDefinition = loadFixture('simple');
            const result = await exportPng({ aslDefinition });

            expect(result.buffer).toBeDefined();
        });

        it('should support setOptions fluent interface', () => {
            const generator = new SfnDiagramGenerator();
            const result = generator.setOptions({ theme: 'dark' }).setOptions({ layout: 'LR' });

            expect(result).toBe(generator); // Should return this for chaining
        });

        it('should apply updated options', () => {
            const generator = new SfnDiagramGenerator({ theme: 'light' });
            const aslDefinition = loadFixture('simple');

            const lightResult = generator.generateSvg({ aslDefinition });
            generator.setOptions({ theme: 'dark' });
            const darkResult = generator.generateSvg({ aslDefinition });

            expect(lightResult.svg).not.toBe(darkResult.svg);
        });
    });

    describe('Error handling', () => {
        it('should throw on invalid JSON string', () => {
            expect(() => generateSvg({ aslDefinition: 'invalid json' })).toThrow();
        });

        it('should throw validation error for empty states', () => {
            const aslDefinition: AslDefinition = {
                StartAt: 'NonExistent',
                States: {},
            };

            // Should throw validation error for empty states
            expect(() => generateSvg({ aslDefinition })).toThrow(AslValidationError);
            expect(() => generateSvg({ aslDefinition })).toThrow('States object cannot be empty');
        });
    });

    describe('Real-world example', () => {
        it.skip('should handle HelloWorld state machine', () => {
            const path = join(__dirname, '..', 'HelloWorldStateMachine.asl.json');
            const aslDefinition: AslDefinition = JSON.parse(readFileSync(path, 'utf-8'));

            const svgResult = generateSvg({ aslDefinition, theme: 'light', layout: 'TB' });
            expect(svgResult.svg).toBeDefined();
            expect(svgResult.metadata.nodeCount).toBeGreaterThan(5);

            const mermaidResult = generateMermaid({ aslDefinition });
            expect(mermaidResult.code).toBeDefined();
            expect(mermaidResult.code).toContain('stateDiagram-v2');
        });
    });

    describe('Snapshot tests', () => {
        const fixtures = ['simple', 'choice', 'parallel', 'error-handling', 'wait-fail'];

        describe('SVG snapshots', () => {
            fixtures.forEach((fixtureName) => {
                it(`should match SVG snapshot for ${fixtureName}`, () => {
                    const aslDefinition = loadFixture(fixtureName);
                    const result = generateSvg({ aslDefinition, theme: 'light', layout: 'TB' });

                    // Snapshot the entire SVG output
                    expect(result.svg).toMatchSnapshot();

                    // Also snapshot metadata for structural verification
                    expect(result.metadata).toMatchSnapshot();
                });
            });
        });

        describe('Mermaid snapshots', () => {
            fixtures.forEach((fixtureName) => {
                it(`should match Mermaid snapshot for ${fixtureName}`, () => {
                    const aslDefinition = loadFixture(fixtureName);
                    const result = generateMermaid({ aslDefinition });

                    // Snapshot the Mermaid code
                    expect(result.code).toMatchSnapshot();

                    // Also snapshot metadata
                    expect(result.metadata).toMatchSnapshot();
                });
            });
        });

        describe('Theme consistency', () => {
            it('should produce consistent output for light theme', () => {
                const aslDefinition = loadFixture('simple');
                const result = generateSvg({ aslDefinition, theme: 'light' });

                expect(result.svg).toMatchSnapshot();
            });

            it('should produce consistent output for dark theme', () => {
                const aslDefinition = loadFixture('simple');
                const result = generateSvg({ aslDefinition, theme: 'dark' });

                expect(result.svg).toMatchSnapshot();
            });
        });

        describe('Layout consistency', () => {
            const layouts = ['TB', 'LR', 'RL', 'BT'] as const;

            layouts.forEach((layout) => {
                it(`should produce consistent output for ${layout} layout`, () => {
                    const aslDefinition = loadFixture('simple');
                    const result = generateSvg({ aslDefinition, layout });

                    expect(result.svg).toMatchSnapshot();
                });
            });
        });
    });
});
