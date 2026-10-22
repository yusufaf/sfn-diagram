import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { AslDefinition } from '../src/types';

const nodeHtmlToImage = vi.fn(async () => Buffer.from('fake-png'));
vi.mock('node-html-to-image', () => ({ default: nodeHtmlToImage }));

const DEPRECATION_CODE = 'SFN_DIAGRAM_DEP_HTML_TO_IMAGE';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const CONVERT_PARAMS = { svg: SVG, width: 200, height: 100 };
const aslDefinition = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'simple.asl.json'), 'utf-8')
) as AslDefinition;

describe('html-to-image engine deprecation', { timeout: 15000 }, () => {
    let emitWarning: MockInstance<typeof process.emitWarning>;

    const deprecationCalls = () =>
        emitWarning.mock.calls.filter(
            ([, options]) => typeof options === 'object' && options?.code === DEPRECATION_CODE
        );

    beforeEach(() => {
        vi.resetModules();
        nodeHtmlToImage.mockClear();
        emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('warns once, as a DeprecationWarning pointing at resvg, when html-to-image is used', async () => {
        const { PngExporter } = await import('../src/png');

        await new PngExporter({ engine: 'html-to-image' }).convert(CONVERT_PARAMS);

        expect(deprecationCalls()).toEqual([
            [
                expect.stringMatching(/'html-to-image' PNG engine is deprecated.*2\.0.*'resvg'/s),
                { code: DEPRECATION_CODE, type: 'DeprecationWarning' },
            ],
        ]);
    });

    it('warns only once per process across calls, instances and exportPng', async () => {
        const { PngExporter, exportPng } = await import('../src/png');

        const first = new PngExporter({ engine: 'html-to-image' });
        await first.convert(CONVERT_PARAMS);
        await first.convert(CONVERT_PARAMS);
        await new PngExporter({ engine: 'html-to-image' }).convert(CONVERT_PARAMS);
        await exportPng({ aslDefinition, engine: 'html-to-image' });

        expect(deprecationCalls()).toHaveLength(1);
        expect(nodeHtmlToImage).toHaveBeenCalledTimes(4);
    });

    it('does not warn on the resvg engine', async () => {
        const { PngExporter, exportPng } = await import('../src/png');

        await new PngExporter({ engine: 'resvg' }).convert(CONVERT_PARAMS);
        await new PngExporter({}).convert(CONVERT_PARAMS);
        await exportPng({ aslDefinition });

        expect(deprecationCalls()).toHaveLength(0);
        expect(nodeHtmlToImage).not.toHaveBeenCalled();
    });
});
