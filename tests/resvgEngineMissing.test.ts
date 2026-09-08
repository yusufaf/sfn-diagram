import { describe, it, expect, vi } from 'vitest';

vi.mock('@resvg/resvg-js', () => {
    throw new Error('Cannot find module');
});

describe('renderResvgPng when the optional peer is missing', () => {
    it('rejects with an actionable, install-command-bearing message', async () => {
        const { renderResvgPng } = await import('../src/exporters/resvgEngine');

        await expect(renderResvgPng({ svg: '<svg></svg>', width: 100 })).rejects.toThrow(
            /@resvg\/resvg-js.*npm install @resvg\/resvg-js.*engine: 'html-to-image'/s
        );
    });
});
