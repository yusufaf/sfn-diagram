import { describe, it, expect, vi } from 'vitest';

// vi.hoisted, because the factory runs while `../src/png` is being imported.
const { rendered } = vi.hoisted(() => ({ rendered: [] as string[] }));
vi.mock('@resvg/resvg-js', () => ({
    Resvg: class {
        height = 100;
        width = 200;
    },
    renderAsync: async (svg: string) => {
        rendered.push(svg);
        return { asPng: () => Buffer.from('fake-png'), height: 100, width: 200 };
    },
}));

import { exportPng } from '../src/png';
import { generateSvg } from '../src';

const asl = { StartAt: 'A', States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } } };

/**
 * resvg ignores `@media` rules, but the html-to-image engine is headless Chromium,
 * which would follow the OS colour scheme. So `'auto'` has to be resolved to light
 * before the SVG is drawn, not left to the rasteriser.
 */
describe("exportPng with theme: 'auto'", () => {
    it('rasterises the light SVG', async () => {
        await exportPng({ aslDefinition: asl, theme: 'auto' });

        expect(rendered.at(-1)).toBe(generateSvg({ aslDefinition: asl, theme: 'light' }).svg);
    });
});
