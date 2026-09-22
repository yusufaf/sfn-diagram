import { describe, expect, it } from 'vitest';
import { AWS_DARK_THEME, AWS_LIGHT_THEME, getTheme } from '../../src/config/themes';
import { generateSvg, resolveViewerTheme } from '../../src/index';
import type { AslDefinition, CustomTheme } from '../../src/types';

const asl: AslDefinition = {
    StartAt: 'Go',
    States: { Go: { End: true, Resource: 'arn:go', Type: 'Task' } },
};

describe('getTheme with a partial CustomTheme (issue #182)', () => {
    it('resolves a fontSize-only theme onto the light base', () => {
        const theme = getTheme({ fontSize: 18 });

        expect(theme.fontSize).toBe(18);
        expect({ ...theme, fontSize: 14 }).toEqual(AWS_LIGHT_THEME);
    });

    it('merges one node colour pair per channel, keeping the base stroke', () => {
        const theme = getTheme({ nodeColors: { Task: { fill: '#eeeeee' } } });

        expect(theme.nodeColors.Task).toEqual({ fill: '#eeeeee', stroke: AWS_LIGHT_THEME.nodeColors.Task.stroke });
        expect(theme.nodeColors.Pass).toEqual(AWS_LIGHT_THEME.nodeColors.Pass);
    });

    it('merges one edge colour, keeping the rest', () => {
        const theme = getTheme({ edgeColors: { error: '#ff0000' } });

        expect(theme.edgeColors).toEqual({ ...AWS_LIGHT_THEME.edgeColors, error: '#ff0000' });
    });

    it('takes omitted fields from the dark theme when base is dark', () => {
        const theme = getTheme({ base: 'dark', fontSize: 18 });

        expect(theme.fontSize).toBe(18);
        expect(theme.background).toBe(AWS_DARK_THEME.background);
        expect(theme.nodeColors).toEqual(AWS_DARK_THEME.nodeColors);
        expect(theme.edgeColors).toEqual(AWS_DARK_THEME.edgeColors);
    });

    it('resolves a fully specified theme to itself', () => {
        const full: CustomTheme = {
            ...AWS_DARK_THEME,
            background: '#101010',
            edgeColors: { ...AWS_DARK_THEME.edgeColors, retry: '#ffee58' },
        };

        expect(getTheme(full)).toEqual(full);
    });

    it('ignores an explicit undefined instead of blanking the base value', () => {
        const theme = getTheme({ background: undefined, edgeColors: { normal: undefined } });

        expect(theme.background).toBe(AWS_LIGHT_THEME.background);
        expect(theme.edgeColors.normal).toBe(AWS_LIGHT_THEME.edgeColors.normal);
    });

    it('ignores an undefined state-type entry in nodeColors and customColors', () => {
        const theme = getTheme({ nodeColors: { Task: undefined } }, { Pass: undefined });

        expect(theme.nodeColors).toEqual(AWS_LIGHT_THEME.nodeColors);
    });

    it('applies customColors on top of the resolved theme', () => {
        const theme = getTheme({ nodeColors: { Task: { fill: '#111111' } } }, { Task: { stroke: '#222222' } });

        expect(theme.nodeColors.Task).toEqual({ fill: '#111111', stroke: '#222222' });
    });

    it('returns the built-in themes untouched for the named options', () => {
        expect(getTheme()).toBe(AWS_LIGHT_THEME);
        expect(getTheme('light')).toBe(AWS_LIGHT_THEME);
        expect(getTheme('dark')).toBe(AWS_DARK_THEME);
    });

    it('renders with a partial theme', () => {
        const { svg } = generateSvg({
            aslDefinition: asl,
            theme: { base: 'dark', fontSize: 20, nodeColors: { Task: { fill: '#123456' } } },
        });

        expect(svg).toContain('font-size="20"');
        expect(svg).toContain('fill="#123456"');
        expect(svg).toContain(`fill="${AWS_DARK_THEME.background}"`);
    });

    it('classifies viewer chrome from the base when a partial theme has no background', () => {
        expect(resolveViewerTheme({ theme: { base: 'dark', fontSize: 16 } })).toBe('dark');
        expect(resolveViewerTheme({ theme: { fontSize: 16 } })).toBe('light');
    });
});
