import { describe, expect, it } from 'vitest';
import { resolveCliOptions } from '../../src/cliOptions';
import type { CliOptionSource } from '../../src/cliOptions';

/** A command line on which no option-bearing flag was given. */
const noFlags: CliOptionSource = {
    backgroundColor: null,
    catchHandling: null,
    catchLabelStyle: null,
    collapse: null,
    diagramDescription: null,
    diagramTitle: null,
    edgeStyle: null,
    format: null,
    iconPosition: null,
    iconSize: null,
    includeComments: null,
    layout: null,
    loadSystemFonts: null,
    nodeHeight: null,
    nodeSeparation: null,
    nodeWidth: null,
    padding: null,
    rankSeparation: null,
    scale: null,
    showIcons: null,
    showStateTypes: null,
    showVariables: null,
    stylePreset: null,
    theme: null,
};

describe('resolveCliOptions', () => {
    it('leaves the PNG options unset with no flag and no config', () => {
        const resolved = resolveCliOptions({ args: noFlags, config: null });
        expect(resolved.loadSystemFonts).toBeNull();
        expect(resolved.scale).toBeNull();
    });

    it('takes the PNG options from the config when no flag is given', () => {
        const resolved = resolveCliOptions({
            args: noFlags,
            config: { loadSystemFonts: true, scale: 3 },
        });
        expect(resolved.loadSystemFonts).toBe(true);
        expect(resolved.scale).toBe(3);
    });

    it('lets a PNG flag beat the config, even a false or a 1', () => {
        const resolved = resolveCliOptions({
            args: { ...noFlags, loadSystemFonts: false, scale: 1 },
            config: { loadSystemFonts: true, scale: 3 },
        });
        expect(resolved.loadSystemFonts).toBe(false);
        expect(resolved.scale).toBe(1);
    });

    it('falls back to the built-in defaults with no flags and no config', () => {
        const resolved = resolveCliOptions({ args: noFlags, config: null });
        expect(resolved).toMatchObject({
            catchHandling: 'show',
            format: 'svg',
            layout: 'TB',
            theme: 'light',
        });
    });

    it('takes a value from the config when the flag is absent', () => {
        const resolved = resolveCliOptions({
            args: noFlags,
            config: { layout: 'LR', padding: 40, theme: 'dark' },
        });
        expect(resolved).toMatchObject({
            layout: 'LR',
            padding: 40,
            theme: 'dark',
        });
    });

    it('lets an explicit flag beat the config', () => {
        const resolved = resolveCliOptions({
            args: { ...noFlags, layout: 'BT' },
            config: { layout: 'LR' },
        });
        expect(resolved.layout).toBe('BT');
    });

    it('lets a flag set to the default value still beat the config', () => {
        // The whole reason parseArgs stopped baking in defaults: `--layout TB` must
        // override a config that says LR, and it can only do that if "absent" and
        // "explicitly TB" are different values here.
        const resolved = resolveCliOptions({
            args: { ...noFlags, layout: 'TB' },
            config: { layout: 'LR' },
        });
        expect(resolved.layout).toBe('TB');
    });

    it('lets --format svg beat a config that asks for mermaid', () => {
        const resolved = resolveCliOptions({
            args: { ...noFlags, format: 'svg' },
            config: { format: 'mermaid' },
        });
        expect(resolved.format).toBe('svg');
    });

    it.each([
        ['catchHandling', 'hide', 'show'],
        ['includeComments', false, true],
        ['showIcons', true, false],
        ['showStateTypes', true, false],
        ['showVariables', false, true],
    ] as const)(
        'lets a negation flag turn off a config-set %s',
        (field, configValue, flagValue) => {
            const resolved = resolveCliOptions({
                args: { ...noFlags, [field]: flagValue },
                config: { [field]: configValue },
            });
            expect(resolved[field]).toBe(flagValue);
        },
    );

    it('keeps a config value of false rather than treating it as absent', () => {
        const resolved = resolveCliOptions({
            args: noFlags,
            config: { includeComments: false, showVariables: false },
        });
        expect(resolved.includeComments).toBe(false);
        expect(resolved.showVariables).toBe(false);
    });

    it('keeps a config value of 0 rather than treating it as absent', () => {
        const resolved = resolveCliOptions({
            args: noFlags,
            config: { nodeSeparation: 0, padding: 0, rankSeparation: 0 },
        });
        expect(resolved.padding).toBe(0);
        expect(resolved.nodeSeparation).toBe(0);
        expect(resolved.rankSeparation).toBe(0);
    });

    it('keeps a flag value of 0 rather than treating it as absent', () => {
        const resolved = resolveCliOptions({
            args: { ...noFlags, padding: 0 },
            config: { padding: 40 },
        });
        expect(resolved.padding).toBe(0);
    });

    it('carries a custom theme object through from the config', () => {
        const theme = { background: '#101014', base: 'dark' as const };
        expect(
            resolveCliOptions({ args: noFlags, config: { theme } }).theme,
        ).toEqual(theme);
    });

    it('lets --theme light beat a config custom theme', () => {
        const resolved = resolveCliOptions({
            args: { ...noFlags, theme: 'light' },
            config: { theme: { background: '#101014' } },
        });
        expect(resolved.theme).toBe('light');
    });

    it('resolves collapse from the config', () => {
        expect(
            resolveCliOptions({ args: noFlags, config: { collapse: true } })
                .collapse,
        ).toBe(true);
    });

    it('lets a --collapse name list beat a config that collapses everything', () => {
        expect(
            resolveCliOptions({
                args: { ...noFlags, collapse: ['Fan'] },
                config: { collapse: true },
            }).collapse,
        ).toEqual(['Fan']);
    });

    it('leaves an option unset when neither side supplies one', () => {
        const resolved = resolveCliOptions({ args: noFlags, config: null });
        expect(resolved.diagramTitle).toBeNull();
        expect(resolved.backgroundColor).toBeNull();
        expect(resolved.collapse).toBeNull();
        expect(resolved.catchLabelStyle).toBeNull();
        expect(resolved.edgeStyle).toBeNull();
        expect(resolved.stylePreset).toBeNull();
    });

    it('resolves every field the config can set', () => {
        // A field present in CliConfig but forgotten in the merge would silently do
        // nothing, so assert the whole surface at once rather than field by field.
        const resolved = resolveCliOptions({
            args: noFlags,
            config: {
                backgroundColor: '#ff0000',
                catchHandling: 'hide',
                catchLabelStyle: 'catch-number',
                collapse: ['Fan'],
                diagramDescription: 'a description',
                diagramTitle: 'a title',
                edgeStyle: 'straight',
                format: 'mermaid',
                iconPosition: 'top',
                iconSize: 32,
                includeComments: false,
                layout: 'RL',
                loadSystemFonts: false,
                nodeHeight: 90,
                nodeSeparation: 120,
                nodeWidth: 200,
                padding: 64,
                rankSeparation: 140,
                scale: 2,
                showIcons: true,
                showStateTypes: true,
                showVariables: false,
                stylePreset: 'enhanced',
                theme: 'dark',
            },
        });
        expect(resolved).toEqual({
            backgroundColor: '#ff0000',
            catchHandling: 'hide',
            catchLabelStyle: 'catch-number',
            collapse: ['Fan'],
            diagramDescription: 'a description',
            diagramTitle: 'a title',
            edgeStyle: 'straight',
            format: 'mermaid',
            iconPosition: 'top',
            iconSize: 32,
            includeComments: false,
            layout: 'RL',
            loadSystemFonts: false,
            nodeHeight: 90,
            nodeSeparation: 120,
            nodeWidth: 200,
            padding: 64,
            rankSeparation: 140,
            scale: 2,
            showIcons: true,
            showStateTypes: true,
            showVariables: false,
            stylePreset: 'enhanced',
            theme: 'dark',
        });
    });
});
