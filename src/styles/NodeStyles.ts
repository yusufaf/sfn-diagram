import type { NodeStyle, StateType, StylePreset, CustomTheme } from '../types';
import { AWS_LIGHT_THEME } from '../config/themes';

interface GetNodeStyleParams {
    customColors?: Partial<Record<StateType, NodeStyle>>;
    stateType: StateType;
    stylePreset?: StylePreset;
    theme?: CustomTheme;
}

/**
 * Get node style for a given state type
 */
export function getNodeStyle(params: GetNodeStyleParams): NodeStyle {
    const { stateType, theme = AWS_LIGHT_THEME, customColors, stylePreset = 'aws-standard' } = params;

    // Check for custom override first
    if (customColors?.[stateType]) {
        return customColors[stateType];
    }

    // Use theme colors
    const themeColor = theme.nodeColors[stateType];
    if (themeColor) {
        return {
            fill: themeColor.fill,
            shape: getShapeForStateType({ stateType, stylePreset }),
            stroke: themeColor.stroke,
            strokeWidth: getStrokeWidthForType(stateType),
        };
    }

    // Fallback to Task style
    return {
        fill: theme.nodeColors.Task.fill,
        shape: 'rect',
        stroke: theme.nodeColors.Task.stroke,
        strokeWidth: 2,
    };
}

interface GetShapeForStateTypeParams {
    stateType: StateType;
    stylePreset: StylePreset;
}

/**
 * Get the shape for a state type based on the style preset
 */
function getShapeForStateType(params: GetShapeForStateTypeParams): 'rect' | 'diamond' | 'circle' {
    const { stateType, stylePreset } = params;

    // AWS Standard: rectangles for all states (AWS Console parity)
    if (stylePreset === 'aws-standard') {
        return 'rect';
    }

    // Enhanced: use shapes for visual distinction
    switch (stateType) {
        case 'Choice':
            return 'diamond';
        case 'Succeed':
        case 'Fail':
            return 'circle';
        default:
            return 'rect';
    }
}

/**
 * Get stroke width for a state type
 */
function getStrokeWidthForType(stateType: StateType): number {
    switch (stateType) {
        case 'Succeed':
        case 'Fail':
            return 3; // Terminal states have thicker borders
        default:
            return 2;
    }
}
