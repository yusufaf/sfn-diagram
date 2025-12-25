import { describe, it, expect } from 'vitest';
import { PngExporter } from '../src/exporters';

describe('PngExporter', () => {
    const createTestSvg = (): string => `
        <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="180" height="80" fill="#fff" stroke="#000" />
            <text x="100" y="55" text-anchor="middle">Test</text>
        </svg>
    `;

    describe('PNG conversion', () => {
        it('should convert SVG to PNG buffer', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
            expect(result.buffer).toBeInstanceOf(Buffer);
            expect(result.buffer.length).toBeGreaterThan(0);
        }, 10000);

        it('should preserve dimensions', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.width).toBe(200);
            expect(result.height).toBe(100);
        }, 10000);

        it('should include metadata with format', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.metadata).toBeDefined();
            expect(result.metadata.format).toBe('png');
        }, 10000);
    });

    describe('Quality settings', () => {
        it('should support custom quality', async () => {
            const exporter = new PngExporter({ pngQuality: 50 });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
            expect(result.buffer).toBeInstanceOf(Buffer);
        }, 10000);

        it('should use default quality when not specified', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        }, 10000);
    });

    describe('Background color', () => {
        it('should support transparent background', async () => {
            const exporter = new PngExporter({ backgroundColor: 'transparent' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        }, 10000);

        it('should support custom background color', async () => {
            const exporter = new PngExporter({ backgroundColor: 'white' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        }, 10000);

        it('should support hex color backgrounds', async () => {
            const exporter = new PngExporter({ backgroundColor: '#f0f0f0' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        }, 10000);
    });

    describe('Edge cases', () => {
        it('should handle empty SVG', async () => {
            const exporter = new PngExporter({});
            const svg = '<svg></svg>';

            const result = await exporter.convert({ svg, width: 100, height: 100 });

            expect(result.buffer).toBeDefined();
        }, 10000);

        it('should handle large SVGs', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 2000, height: 1000 });

            expect(result.buffer).toBeDefined();
            expect(result.width).toBe(2000);
            expect(result.height).toBe(1000);
        }, 10000); // Increase timeout for large PNG generation
    });
});
