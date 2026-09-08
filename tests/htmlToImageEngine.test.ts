import { describe, it, expect, vi } from 'vitest';

const nodeHtmlToImage = vi.fn(async () => Buffer.from('fake-png'));
vi.mock('node-html-to-image', () => ({ default: nodeHtmlToImage }));

import { renderHtmlToImagePng } from '../src/exporters/htmlToImageEngine';

describe('renderHtmlToImagePng', () => {
    it('calls node-html-to-image with type png and no Chromium sandbox', async () => {
        await renderHtmlToImagePng({ svg: '<svg></svg>', width: 200, height: 100 });

        expect(nodeHtmlToImage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'png' })
        );
    });

    it('renders opaque when backgroundColor is omitted, matching the historical default', async () => {
        await renderHtmlToImagePng({ svg: '<svg></svg>', width: 200, height: 100 });

        expect(nodeHtmlToImage).toHaveBeenCalledWith(expect.objectContaining({ transparent: false }));
    });

    it('marks the render transparent when backgroundColor is transparent', async () => {
        await renderHtmlToImagePng({
            svg: '<svg></svg>',
            width: 200,
            height: 100,
            backgroundColor: 'transparent',
        });

        expect(nodeHtmlToImage).toHaveBeenCalledWith(expect.objectContaining({ transparent: true }));
    });

    it('embeds the SVG and requested dimensions in the wrapper HTML', async () => {
        await renderHtmlToImagePng({ svg: '<svg data-marker="x"></svg>', width: 321, height: 654 });

        const html = nodeHtmlToImage.mock.calls.at(-1)?.[0].html as string;
        expect(html).toContain('data-marker="x"');
        expect(html).toContain('width: 321px');
        expect(html).toContain('height: 654px');
    });
});
