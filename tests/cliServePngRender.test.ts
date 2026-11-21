import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Pass-through spies counting how often each render stage runs per request. Kept out of
// cliServe.test.ts so the module mocks cannot leak into its other suites.
vi.mock('../src/cfn', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/cfn')>();
    return { ...actual, extractAslFromTemplate: vi.fn(actual.extractAslFromTemplate) };
});
vi.mock('../src/index', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/index')>();
    return { ...actual, generateSvg: vi.fn(actual.generateSvg) };
});
vi.mock('../src/exporters/resvgEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/exporters/resvgEngine')>();
    return { ...actual, renderResvgPng: vi.fn(actual.renderResvgPng) };
});
// A stub rather than a pass-through, so no test here can fetch an icon.
vi.mock('../src/utils/iconEmbedder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/utils/iconEmbedder')>();
    return { ...actual, embedIcons: vi.fn(async ({ svg }: { svg: string }) => svg) };
});

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { extractAslFromTemplate } from '../src/cfn';
import { parseServeQuery } from '../src/cli';
import { createServeServer } from '../src/cliServe';
import { renderResvgPng } from '../src/exporters/resvgEngine';
import { generateSvg } from '../src/index';
import { createLayoutCache } from '../src/layout';
import { embedIcons } from '../src/utils/iconEmbedder';
import { REAL_PNG_EXPORT_TIMEOUT_MS } from './pngExportTimeout';

const fixtures = join(__dirname, 'fixtures');
const simpleText = readFileSync(join(fixtures, 'simple.asl.json'), 'utf-8');
const cdkSynthText = readFileSync(join(fixtures, 'cfn', 'cdk-synth.json'), 'utf-8');

describe('sfn-diagram serve renders a png request once', () => {
    let base: string;
    let server: Server;

    beforeAll(async () => {
        server = createServeServer({
            cache: createLayoutCache(),
            config: null,
            parseQuery: parseServeQuery,
            standalone: false,
            version: 'test',
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        vi.mocked(extractAslFromTemplate).mockClear();
        vi.mocked(generateSvg).mockClear();
        vi.mocked(renderResvgPng).mockClear();
        vi.mocked(embedIcons).mockClear();
    });

    const post = (path: string, body: string): Promise<Response> =>
        fetch(`${base}${path}`, { body, method: 'POST' });

    it(
        'extracts and renders the definition once per png request',
        async () => {
            const response = await post('/render?format=png', cdkSynthText);
            expect(response.status).toBe(200);
            expect(vi.mocked(extractAslFromTemplate)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(generateSvg)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(renderResvgPng)).toHaveBeenCalledTimes(1);
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );

    it('refuses an oversized png before fetching icons or rasterizing', async () => {
        // 6520 x 6680 pixels: just over the 40 million limit.
        const response = await post('/render?format=png&padding=3200&show-icons', simpleText);
        expect(response.status).toBe(422);
        expect(vi.mocked(generateSvg)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(embedIcons)).not.toHaveBeenCalled();
        expect(vi.mocked(renderResvgPng)).not.toHaveBeenCalled();
    });
});
