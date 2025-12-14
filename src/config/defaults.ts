import type { DiagramOptions } from '../types';

/**
 * Default diagram options - used when options not provided
 */
export const DEFAULT_DIAGRAM_OPTIONS: Required<
    Omit<DiagramOptions, 'width' | 'height' | 'customColors' | 'iconResolver'>
> & {
    width: number | undefined;
    height: number | undefined;
    customColors: DiagramOptions['customColors'];
    iconResolver: DiagramOptions['iconResolver'];
} = {
    // Output format
    format: 'svg',

    // Theming
    theme: 'light',
    customColors: undefined,

    // Layout
    layout: 'TB',
    rankSeparation: 50,
    nodeSeparation: 50,

    // Dimensions (auto-calculate if not provided)
    width: undefined,
    height: undefined,
    nodeWidth: 120,
    nodeHeight: 60,
    padding: 20,

    // Content options
    includeComments: true,
    showStateTypes: false,
    edgeStyle: 'curved',
    catchLabelStyle: 'error-type',
    stylePreset: 'aws-standard',

    // Icon options
    iconPosition: 'left' as const,
    iconResolver: undefined,
    iconSize: 24,
    showIcons: false,

    // PNG-specific
    pngQuality: 90,
    backgroundColor: 'transparent',
};

/**
 * Merge user-provided options with defaults
 */
export function mergeOptions(options: DiagramOptions = {}): typeof DEFAULT_DIAGRAM_OPTIONS {
    return {
        ...DEFAULT_DIAGRAM_OPTIONS,
        ...options,
    };
}
