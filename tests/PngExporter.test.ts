import { describe, it, expect, vi } from 'vitest';

vi.mock('node-html-to-image', () => {
    throw new Error('node-html-to-image must not be loaded by the default engine');
});

import { PngExporter } from '../src/png';

describe('PngExporter', { timeout: 15000 }, () => {
    const createTestSvg = (): string => `
        <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="180" height="80" fill="#fff" stroke="#000" />
            <text x="100" y="55" text-anchor="middle">Test</text>
        </svg>
    `;

    describe('PNG conversion', () => {
        it('should convert SVG to PNG buffer without loading a browser', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
            expect(result.buffer).toBeInstanceOf(Buffer);
            expect(result.buffer.length).toBeGreaterThan(0);
        });

        it('should preserve dimensions', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.width).toBe(200);
            expect(result.height).toBe(100);
        });

        it('should include metadata with format', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.metadata).toBeDefined();
            expect(result.metadata.format).toBe('png');
        });
    });

    describe('Quality settings', () => {
        it('should treat pngQuality as a no-op on the resvg engine', async () => {
            const svg = createTestSvg();

            const low = await new PngExporter({ pngQuality: 10 }).convert({ svg, width: 200, height: 100 });
            const high = await new PngExporter({ pngQuality: 90 }).convert({ svg, width: 200, height: 100 });

            expect(low.buffer.equals(high.buffer)).toBe(true);
        });
    });

    describe('Background color', () => {
        it('should support transparent background', async () => {
            const exporter = new PngExporter({ backgroundColor: 'transparent' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        });

        it('should support custom background color', async () => {
            const exporter = new PngExporter({ backgroundColor: 'white' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        });

        it('should support hex color backgrounds', async () => {
            const exporter = new PngExporter({ backgroundColor: '#f0f0f0' });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.buffer).toBeDefined();
        });
    });

    describe('Scale', () => {
        it('should double output dimensions at scale 2', async () => {
            const exporter = new PngExporter({ scale: 2 });
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 200, height: 100 });

            expect(result.width).toBe(400);
            expect(result.height).toBe(200);
        });
    });

    describe('Edge cases', () => {
        it('should handle empty SVG', async () => {
            const exporter = new PngExporter({});
            const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

            const result = await exporter.convert({ svg, width: 100, height: 100 });

            expect(result.buffer).toBeDefined();
        });

        it('should scale a small SVG up to the requested width', async () => {
            const exporter = new PngExporter({});
            const svg = createTestSvg();

            const result = await exporter.convert({ svg, width: 2000, height: 1000 });

            expect(result.buffer).toBeDefined();
            expect(result.width).toBe(2000);
            expect(result.height).toBe(1000);
        });
    });
});
