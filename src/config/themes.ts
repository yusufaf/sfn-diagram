import type { CustomTheme, StateType } from '../types';
import { mergeRecordOptions } from './defaults';

/**
 * AWS Light Theme - matches the AWS Step Functions console light mode
 */
export const AWS_LIGHT_THEME: CustomTheme = {
    background: '#ffffff',
    nodeColors: {
        Pass: { fill: '#e1f5fe', stroke: '#0277bd' },
        Task: { fill: '#fff3e0', stroke: '#ef6c00' },
        Choice: { fill: '#f3e5f5', stroke: '#7b1fa2' },
        Wait: { fill: '#e8f5e8', stroke: '#388e3c' },
        Succeed: { fill: '#e8f5e8', stroke: '#4caf50' },
        Fail: { fill: '#ffebee', stroke: '#f44336' },
        Parallel: { fill: '#fce4ec', stroke: '#c2185b' },
        Map: { fill: '#f1f8e9', stroke: '#689f38' },
    },
    edgeColors: {
        choice: '#7b1fa2',
        default: '#9c27b0',
        error: '#f44336',
        normal: '#546e7a',
        retry: '#f9a825',
    },
    textColor: '#212121',
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
};

/**
 * AWS Dark Theme - matches the AWS Step Functions console dark mode
 */
export const AWS_DARK_THEME: CustomTheme = {
    background: '#1e1e1e',
    nodeColors: {
        Pass: { fill: '#01579b', stroke: '#4fc3f7' },
        Task: { fill: '#e65100', stroke: '#ffb74d' },
        Choice: { fill: '#4a148c', stroke: '#ce93d8' },
        Wait: { fill: '#1b5e20', stroke: '#81c784' },
        Succeed: { fill: '#2e7d32', stroke: '#a5d6a7' },
        Fail: { fill: '#b71c1c', stroke: '#ef5350' },
        Parallel: { fill: '#880e4f', stroke: '#f48fb1' },
        Map: { fill: '#33691e', stroke: '#aed581' },
    },
    edgeColors: {
        choice: '#ce93d8',
        default: '#ba68c8',
        error: '#ef5350',
        normal: '#90a4ae',
        retry: '#ffca28',
    },
    textColor: '#e0e0e0',
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
};

/**
 * Get theme object from theme name or custom theme
 */
export function getTheme(
    theme?: 'light' | 'dark' | CustomTheme,
    customColors?: Partial<Record<StateType, { fill: string; stroke: string }>>
): CustomTheme {
    let baseTheme: CustomTheme;

    if (!theme || theme === 'light') {
        baseTheme = AWS_LIGHT_THEME;
    } else if (theme === 'dark') {
        baseTheme = AWS_DARK_THEME;
    } else {
        baseTheme = theme;
    }

    // Apply custom color overrides if provided
    if (customColors) {
        return {
            ...baseTheme,
            nodeColors: mergeRecordOptions(baseTheme.nodeColors, customColors),
        };
    }

    return baseTheme;
}
