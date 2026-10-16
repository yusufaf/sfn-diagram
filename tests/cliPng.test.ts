import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A pass-through spy, so a test can read the options the CLI handed to exportPng while
// every other test in this file still renders a real PNG. Kept out of cli.test.ts so
// the module mock cannot leak into its other suites.
vi.mock('../src/png', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/png')>();
    return { ...actual, exportPng: vi.fn(actual.exportPng) };
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli';
import { exportPng } from '../src/png';
import { decodePng } from './decodePng';
import { REAL_PNG_EXPORT_TIMEOUT_MS } from './pngExportTimeout';

const simpleFixture = join(__dirname, 'fixtures', 'simple.asl.json');

/** Skips the real render where only the options passed to exportPng matter. */
const STUB_PNG = {
    buffer: Buffer.from(''),
    height: 1,
    metadata: { format: 'png' as const },
    width: 1,
};

describe('run: --format png options', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;
    let stderrData: string;
    let tempDir: string;

    beforeEach(() => {
        stderrData = '';
        stdout = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => true);
        stderr = vi
            .spyOn(process.stderr, 'write')
            .mockImplementation((chunk) => {
                stderrData += chunk.toString();
                return true;
            });
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cli-png-'));
        writeFileSync(join(tempDir, '.git'), '');
    });

    afterEach(() => {
        stdout.mockRestore();
        stderr.mockRestore();
        vi.unstubAllEnvs();
        // mockReset, not mockClear: mockClear leaves an unconsumed
        // mockResolvedValueOnce queued for the next test's real render.
        vi.mocked(exportPng).mockReset();
        rmSync(tempDir, { recursive: true, force: true });
    });

    const write = (name: string, contents: string): string => {
        const path = join(tempDir, name);
        writeFileSync(path, contents);
        return path;
    };

    const lastCallParams = (): Record<string, unknown> =>
        vi.mocked(exportPng).mock.lastCall?.[0] as unknown as Record<
            string,
            unknown
        >;

    it(
        'doubles the pixel dimensions with --scale 2',
        async () => {
            const scaled = join(tempDir, 'a.png');
            const plain = join(tempDir, 'b.png');
            expect(
                await run([
                    simpleFixture,
                    '--format',
                    'png',
                    '--scale',
                    '2',
                    '-o',
                    scaled,
                ]),
            ).toBe(0);
            expect(
                await run([simpleFixture, '--format', 'png', '-o', plain]),
            ).toBe(0);
            const big = decodePng(readFileSync(scaled));
            const small = decodePng(readFileSync(plain));
            expect(big.width).toBe(small.width * 2);
            expect(big.height).toBe(small.height * 2);
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );

    it(
        'takes scale from the config, and lets --scale beat it',
        async () => {
            const config = write('c.json', JSON.stringify({ scale: 2 }));
            const fromConfig = join(tempDir, 'config.png');
            const fromFlag = join(tempDir, 'flag.png');
            const plain = join(tempDir, 'plain.png');
            expect(
                await run([simpleFixture, '--format', 'png', '-o', plain]),
            ).toBe(0);
            expect(
                await run([
                    simpleFixture,
                    '--format',
                    'png',
                    '--config',
                    config,
                    '-o',
                    fromConfig,
                ]),
            ).toBe(0);
            expect(
                await run([
                    simpleFixture,
                    '--format',
                    'png',
                    '--config',
                    config,
                    '--scale',
                    '1',
                    '-o',
                    fromFlag,
                ]),
            ).toBe(0);
            const baseWidth = decodePng(readFileSync(plain)).width;
            expect(decodePng(readFileSync(fromConfig)).width).toBe(baseWidth * 2);
            expect(decodePng(readFileSync(fromFlag)).width).toBe(baseWidth);
        },
        REAL_PNG_EXPORT_TIMEOUT_MS,
    );

    it.each([
        ['--load-system-fonts', true],
        ['--no-load-system-fonts', false],
    ])('passes %s to exportPng', async (flag, expected) => {
        vi.mocked(exportPng).mockResolvedValueOnce(STUB_PNG);
        expect(
            await run([
                simpleFixture,
                '--format',
                'png',
                flag,
                '-o',
                join(tempDir, 'o.png'),
            ]),
        ).toBe(0);
        expect(lastCallParams()).toMatchObject({ loadSystemFonts: expected });
    });

    it('leaves both options out when neither flag nor config sets them', async () => {
        // An absent key, not an explicit undefined: the library reads the env var only
        // when loadSystemFonts is missing.
        vi.mocked(exportPng).mockResolvedValueOnce(STUB_PNG);
        expect(
            await run([
                simpleFixture,
                '--format',
                'png',
                '-o',
                join(tempDir, 'o.png'),
            ]),
        ).toBe(0);
        expect(lastCallParams()).not.toHaveProperty('loadSystemFonts');
        expect(lastCallParams()).not.toHaveProperty('scale');
    });

    describe('against SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS', () => {
        // An invalid value makes the library throw, but only if it reads the env var at
        // all, so exit 0 proves the flag or config value was used instead.
        beforeEach(() => {
            vi.stubEnv('SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS', 'flase');
        });

        it(
            'lets --load-system-fonts win, so the env var is never read',
            async () => {
                expect(
                    await run([
                        simpleFixture,
                        '--format',
                        'png',
                        '--load-system-fonts',
                        '-o',
                        join(tempDir, 'x.png'),
                    ]),
                ).toBe(0);
            },
            REAL_PNG_EXPORT_TIMEOUT_MS,
        );

        it(
            'falls back to the env var with no flag and no config',
            async () => {
                expect(
                    await run([
                        simpleFixture,
                        '--format',
                        'png',
                        '-o',
                        join(tempDir, 'x.png'),
                    ]),
                ).toBe(1);
                expect(stderrData).toContain('must be one of');
            },
            REAL_PNG_EXPORT_TIMEOUT_MS,
        );

        it(
            'lets a config loadSystemFonts win too',
            async () => {
                const config = write(
                    'c.json',
                    JSON.stringify({ loadSystemFonts: true }),
                );
                expect(
                    await run([
                        simpleFixture,
                        '--format',
                        'png',
                        '--config',
                        config,
                        '-o',
                        join(tempDir, 'x.png'),
                    ]),
                ).toBe(0);
            },
            REAL_PNG_EXPORT_TIMEOUT_MS,
        );
    });
});
