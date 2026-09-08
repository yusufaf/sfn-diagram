import { describe, it, expect, vi, beforeEach } from 'vitest';

const nodeHtmlToImage = vi.fn(async () => Buffer.from('fake-png'));
vi.mock('node-html-to-image', () => ({ default: nodeHtmlToImage }));

import { PngExporter } from '../src/png';

describe('PngExporter engine selection', { timeout: 15000 }, () => {
    beforeEach(() => {
        nodeHtmlToImage.mockClear();
    });

    it('uses node-html-to-image when engine is html-to-image', async () => {
        const exporter = new PngExporter({ engine: 'html-to-image' });

        await exporter.convert({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 200, height: 100 });

        expect(nodeHtmlToImage).toHaveBeenCalled();
    });

    it('does not call node-html-to-image when engine is resvg', async () => {
        const exporter = new PngExporter({ engine: 'resvg' });

        await exporter.convert({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 200, height: 100 });

        expect(nodeHtmlToImage).not.toHaveBeenCalled();
    });
});
