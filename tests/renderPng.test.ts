import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPng } from '../src/exporters/renderPng';
import { generateSvg } from '../src/index';
import { exportPng } from '../src/png';
import type { AslDefinition, ExportPngParams } from '../src/types';
import { REAL_PNG_EXPORT_TIMEOUT_MS } from './pngExportTimeout';

const simple = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'simple.asl.json'), 'utf-8'),
) as AslDefinition;
const size = generateSvg({ aslDefinition: simple });
const width = Math.ceil(size.width);
const height = Math.ceil(size.height);

describe('renderPng pixel ceiling', () => {
    it('refuses an image one pixel over the ceiling', async () => {
        await expect(renderPng({ aslDefinition: simple, maxPixels: width * height - 1 })).rejects.toThrow(
            `PNG would be ${width} x ${height} pixels, above the limit of`,
        );
    });

    it('measures the image after scale', async () => {
        await expect(renderPng({ aslDefinition: simple, maxPixels: width * height, scale: 2 })).rejects.toThrow(
            `${Math.ceil(size.width * 2)} x ${Math.ceil(size.height * 2)} pixels`,
        );
    });

    it(
        'renders an image exactly at the ceiling',
        async () => {
            const png = await renderPng({ aslDefinition: simple, maxPixels: width * height });
            expect(png.width).toBe(width);
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );

    it(
        'is what exportPng renders when no ceiling is set',
        async () => {
            const [exported, rendered] = await Promise.all([
                exportPng({ aslDefinition: simple }),
                renderPng({ aslDefinition: simple }),
            ]);
            expect(Buffer.from(exported.buffer).equals(Buffer.from(rendered.buffer))).toBe(true);
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );

    it(
        'exportPng ignores a maxPixels key from an untyped caller',
        async () => {
            const untyped = { aslDefinition: simple, maxPixels: 1 } as unknown as ExportPngParams;
            await expect(exportPng(untyped)).resolves.toMatchObject({ width });
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );
});
