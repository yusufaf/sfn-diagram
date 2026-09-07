import { describe, it, expect } from 'vitest';
import { AWS_DARK_THEME, AWS_LIGHT_THEME } from '../../src/config/themes';
import type { CustomTheme, StateType } from '../../src/types';

// WCAG 2.x contrast math (sRGB relative luminance), independent of the Rec. 601
// luma helper in src/renderers/viewer/viewerStyles.ts - that one classifies a
// background as light/dark, this one measures accessibility contrast, and the
// two formulas are not interchangeable.
function hexToRgb(hex: string): [number, number, number] {
    const value = hex.replace('#', '');
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
    const lumA = relativeLuminance(a);
    const lumB = relativeLuminance(b);
    return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

const TEXT_THRESHOLD = 4.5;
const GRAPHICAL_THRESHOLD = 3.0;

describe.each([
    ['AWS_LIGHT_THEME', AWS_LIGHT_THEME],
    ['AWS_DARK_THEME', AWS_DARK_THEME],
])('%s WCAG AA contrast', (_name, theme: CustomTheme) => {
    const stateTypes = Object.keys(theme.nodeColors) as StateType[];

    it.each(stateTypes)('textColor on %s fill clears 4.5:1', (stateType) => {
        const { fill } = theme.nodeColors[stateType];
        expect(contrastRatio(theme.textColor, fill)).toBeGreaterThanOrEqual(TEXT_THRESHOLD);
    });

    it.each(stateTypes)('%s stroke clears 3:1 against its own fill', (stateType) => {
        const { fill, stroke } = theme.nodeColors[stateType];
        expect(contrastRatio(stroke, fill)).toBeGreaterThanOrEqual(GRAPHICAL_THRESHOLD);
    });

    it.each(stateTypes)('%s stroke clears 3:1 against the canvas background', (stateType) => {
        const { stroke } = theme.nodeColors[stateType];
        expect(contrastRatio(stroke, theme.background)).toBeGreaterThanOrEqual(GRAPHICAL_THRESHOLD);
    });

    // Edge labels are drawn at fontSize - 2 (12px with the default fontSize: 14)
    // directly in the edge's own color on the canvas background (SvgRenderer.ts),
    // so every edge color needs the stricter text threshold, not the graphical one.
    it.each(Object.entries(theme.edgeColors))('edge color %s clears 4.5:1 on the background', (_key, color) => {
        expect(contrastRatio(color as string, theme.background)).toBeGreaterThanOrEqual(TEXT_THRESHOLD);
    });
});

// Known gap: sub-labels, execution annotations and assigned-variable lines render
// textColor at opacity 0.7-0.75 (SvgRenderer.ts), which effectively lowers their
// contrast against the node fill below what's asserted above. Not covered here.
