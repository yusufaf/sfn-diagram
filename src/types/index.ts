import type { DescribeStateMachineCommandOutput } from '@aws-sdk/client-sfn';

// ASL Definition Types
export type StateType =
    | 'Pass'
    | 'Task'
    | 'Choice'
    | 'Wait'
    | 'Succeed'
    | 'Fail'
    | 'Parallel'
    | 'Map';

export interface CatchBlock {
    ErrorEquals: string[];
    Next?: string;
    ResultPath?: string;
}

export interface RetryBlock {
    BackoffRate?: number;
    ErrorEquals: string[];
    IntervalSeconds?: number;
    MaxAttempts?: number;
}

export interface ChoiceRule {
    BooleanEquals?: boolean;
    Next: string;
    NumericEquals?: number;
    StringEquals?: string;
    Variable?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // AWS ASL spec allows arbitrary condition types
}

export interface AslState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Assign?: Record<string, any>; // AWS ASL spec - arbitrary JSON values
    Branches?: AslDefinition[]; // Parallel/Map-specific
    Catch?: CatchBlock[]; // Task-specific
    Cause?: string; // Fail-specific
    Choices?: ChoiceRule[]; // Choice-specific
    Comment?: string;
    Default?: string; // Choice-specific
    End?: boolean;
    Error?: string; // Fail-specific
    Iterator?: AslDefinition; // Parallel/Map-specific
    Next?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Output?: any; // AWS ASL spec - arbitrary JSON values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Parameters?: Record<string, any>; // AWS ASL spec - arbitrary JSON values
    Resource?: string; // Task-specific
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Result?: any; // AWS ASL spec - arbitrary JSON values
    ResultPath?: string; // Task-specific
    Retry?: RetryBlock[]; // Task-specific
    Seconds?: number | string; // Wait-specific; Can be JSONata expression
    SecondsPath?: string; // Wait-specific
    Timestamp?: string; // Wait-specific
    TimestampPath?: string; // Wait-specific
    Type: StateType;
}

export interface AslDefinition {
    Comment?: string;
    QueryLanguage?: 'JSONata' | 'JSONPath';
    StartAt: string;
    States: Record<string, AslState>;
    TimeoutSeconds?: number;
    Version?: string;
}

// Internal Graph Types
export interface StateNode {
    /** Child node IDs (for container nodes like Parallel/Map) */
    children?: string[];
    height?: number;
    /** URL to AWS service icon (CDN path for Task states) */
    iconUrl?: string;
    id: string;
    /** Whether this node is a container (Parallel or Map state) */
    isContainer?: boolean;
    label: string;
    /** Parent node ID (for nodes inside Parallel/Map containers) */
    parent?: string;
    /** AWS service identifier for Task states (e.g., 'lambda', 's3') */
    serviceType?: string;
    style?: NodeStyle;
    type: string;
    width?: number;
    x?: number;
    y?: number;
}

/** Edge types for state transitions */
export type EdgeType = 'normal' | 'error' | 'choice' | 'default';

export interface GraphEdge {
    condition?: string;
    from: string;
    label?: string;
    to: string;
    type?: EdgeType;
    visualOnly?: boolean; // If true, edge is for rendering only and doesn't participate in layout
}

/** Node shape types for rendering state nodes */
export type NodeShape = 'rect' | 'diamond' | 'circle';

export interface NodeStyle {
    fill: string;
    stroke: string;
    strokeWidth: number;
    shape: NodeShape;
}

// Theme Types
export interface CustomTheme {
    background: string;
    edgeColors: {
        choice: string;
        default: string;
        error: string;
        normal: string;
    };
    fontFamily: string;
    fontSize: number;
    nodeColors: Record<StateType, { fill: string; stroke: string }>;
    textColor: string;
}

// Diagram Configuration Union Types
/** Supported output formats for diagram generation */
export type DiagramFormat = 'svg' | 'mermaid' | 'png';

/** Theme options: built-in themes or custom theme object */
export type ThemeOption = 'light' | 'dark' | CustomTheme;

/** Graph layout direction */
export type LayoutDirection = 'TB' | 'LR' | 'RL' | 'BT';

/** Edge path rendering style */
export type EdgePathStyle = 'straight' | 'curved' | 'orthogonal';

/** Catch/Retry label display style */
export type CatchLabelStyle = 'error-type' | 'catch-number';

/** Visual style preset for node shapes */
export type StylePreset = 'aws-standard' | 'enhanced';

// Configuration Types
export interface DiagramOptions {
    /**
     * Background color for PNG export
     * @default 'transparent'
     */
    backgroundColor?: string | 'transparent';

    /**
     * Style for Catch block edge labels: 'error-type' shows error names, 'catch-number' shows "Catch #N"
     * @default 'error-type'
     */
    catchLabelStyle?: CatchLabelStyle;

    /** Custom styling overrides for specific state types */
    customColors?: Partial<Record<StateType, NodeStyle>>;

    /**
     * Style of edge paths: straight, curved, or orthogonal
     * @default 'curved'
     */
    edgeStyle?: EdgePathStyle;

    /** Output format for the diagram */
    format?: DiagramFormat;

    /** Overall diagram height in pixels (auto-calculated if not specified) */
    height?: number;

    /**
     * Position of AWS service icons relative to node label
     * @default 'left'
     */
    iconPosition?: 'left' | 'top' | 'right';

    /** Custom function to resolve icon URLs for services */
    iconResolver?: (service: string) => string | null;

    /**
     * Size of AWS service icons in pixels
     * @default 24
     */
    iconSize?: number;

    /**
     * Whether to use state comments as node labels
     * @default true
     */
    includeComments?: boolean;

    /** Graph layout direction: TB (top-bottom), LR (left-right), RL (right-left), BT (bottom-top) */
    layout?: LayoutDirection;

    /**
     * Height of each state node in pixels
     * @default 60
     */
    nodeHeight?: number;

    /**
     * Horizontal separation between nodes in pixels
     * @default 50
     */
    nodeSeparation?: number;

    /**
     * Width of each state node in pixels
     * @default 120
     */
    nodeWidth?: number;

    /**
     * Padding around the diagram in pixels
     * @default 20
     */
    padding?: number;

    /**
     * PNG export quality from 1-100
     * @default 90
     */
    pngQuality?: number;

    /**
     * Vertical separation between ranks in pixels
     * @default 50
     */
    rankSeparation?: number;

    /**
     * Whether to display AWS service icons on Task state nodes
     * @default false
     */
    showIcons?: boolean;

    /**
     * Whether to display state type labels on nodes
     * @default false
     */
    showStateTypes?: boolean;

    /**
     * Visual style preset: 'aws-standard' uses rectangles (AWS parity), 'enhanced' uses shapes for visual distinction
     * @default 'aws-standard'
     */
    stylePreset?: StylePreset;

    /** Color theme: 'light', 'dark', or custom theme object */
    theme?: ThemeOption;

    /** Overall diagram width in pixels (auto-calculated if not specified) */
    width?: number;
}

// Output Types

/** SVG diagram output */
export interface SvgOutput {
    /** Height of the diagram in pixels */
    height: number;

    /** Metadata about the generated diagram */
    metadata: {
        /** Number of edges (transitions) in the diagram */
        edgeCount: number;

        /** Number of state nodes in the diagram */
        nodeCount: number;
    };

    /** Complete SVG markup as a string */
    svg: string;

    /** Width of the diagram in pixels */
    width: number;
}

/** Mermaid diagram code output */
export interface MermaidOutput {
    /** Mermaid state diagram syntax */
    code: string;

    /** Metadata about the generated diagram */
    metadata: {
        /** Number of transitions in the diagram */
        edgeCount: number;

        /** Number of states in the diagram */
        stateCount: number;
    };
}

/** PNG image output */
export interface PngOutput {
    /** PNG image data as a Buffer */
    buffer: Buffer;

    /** Height of the image in pixels */
    height: number;

    /** Metadata about the generated image */
    metadata: {
        /** Image format (always 'png') */
        format: 'png';
    };

    /** Width of the image in pixels */
    width: number;
}

export type DiagramOutput = SvgOutput | MermaidOutput | PngOutput;

// Function Parameter Types (object-based API)
export interface GenerateSvgParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

export interface GenerateMermaidParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

export interface GenerateDiagramParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

export interface ExportPngParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

export interface GenerateFromAwsParams extends DiagramOptions {
    /** AWS SDK DescribeStateMachine command output */
    response: DescribeStateMachineCommandOutput;
}
