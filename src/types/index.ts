import type {
    DescribeStateMachineCommandOutput,
    GetExecutionHistoryCommandOutput,
    HistoryEvent,
} from '@aws-sdk/client-sfn';

// ASL Definition Types
/** The set of Amazon States Language state types a state machine can contain. */
export type StateType =
    | 'Pass'
    | 'Task'
    | 'Choice'
    | 'Wait'
    | 'Succeed'
    | 'Fail'
    | 'Parallel'
    | 'Map';

/** An ASL `Catch` handler: routes matching errors to a fallback state. */
export interface CatchBlock {
    ErrorEquals: string[];
    Next?: string;
    ResultPath?: string;
}

/** An ASL `Retry` policy: re-attempts a state on matching errors with backoff. */
export interface RetryBlock {
    BackoffRate?: number;
    ErrorEquals: string[];
    IntervalSeconds?: number;
    MaxAttempts?: number;
}

/** A single rule in a Choice state: a condition plus the `Next` state to take when it matches. */
export interface ChoiceRule {
    BooleanEquals?: boolean;
    Next: string;
    NumericEquals?: number;
    StringEquals?: string;
    Variable?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // AWS ASL spec allows arbitrary condition types
}

/**
 * A Map state's `ProcessorConfig`, which selects between the inline and
 * distributed execution modes. `Mode: 'DISTRIBUTED'` marks a Distributed Map —
 * a separate child execution per batch, with its own concurrency and failure
 * tolerance semantics.
 */
export interface ProcessorConfig {
    ExecutionType?: 'EXPRESS' | 'STANDARD';
    Mode?: 'DISTRIBUTED' | 'INLINE';
}

/**
 * A Distributed Map `ItemReader` (dataset source) or `ResultWriter` (result sink).
 * Both point at an AWS resource — typically S3, or Athena for `ItemReader` — via
 * the same `Resource` ARN shape used by Task states.
 */
export interface ItemIo {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Parameters?: Record<string, any>; // AWS ASL spec - arbitrary JSON values
    ReaderConfig?: {
        InputType?: string;
        MaxItems?: number;
    };
    Resource?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WriterConfig?: Record<string, any>; // AWS ASL spec - arbitrary JSON values
}

/** A single state within an ASL definition, covering fields for every state type. */
export interface AslState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Arguments?: Record<string, any>; // JSONata-mode counterpart to Parameters
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ItemBatcher?: Record<string, any>; // Distributed Map-specific; batching config
    ItemProcessor?: AslDefinition; // Map-specific; modern replacement for Iterator (incl. Distributed Map)
    ItemReader?: ItemIo; // Distributed Map-specific; dataset source (S3, Athena)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ItemSelector?: Record<string, any>; // Map-specific; per-item input shaping
    Iterator?: AslDefinition; // Map-specific; legacy (pre-2022) inline map processor
    Label?: string; // Distributed Map-specific; prefix for child execution names
    MaxConcurrency?: number | string; // Map-specific; can be a JSONata expression
    Next?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Output?: any; // AWS ASL spec - arbitrary JSON values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Parameters?: Record<string, any>; // AWS ASL spec - arbitrary JSON values
    QueryLanguage?: 'JSONata' | 'JSONPath'; // Per-state override of the top-level query language
    Resource?: string; // Task-specific
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Result?: any; // AWS ASL spec - arbitrary JSON values
    ResultPath?: string; // Task-specific
    ResultWriter?: ItemIo; // Distributed Map-specific; result sink (S3)
    Retry?: RetryBlock[]; // Task-specific
    Seconds?: number | string; // Wait-specific; Can be JSONata expression
    SecondsPath?: string; // Wait-specific
    Timestamp?: string; // Wait-specific
    TimestampPath?: string; // Wait-specific
    ToleratedFailureCount?: number; // Distributed Map-specific
    ToleratedFailurePercentage?: number; // Distributed Map-specific
    Type: StateType;
}

/** A complete Amazon States Language state machine definition. */
export interface AslDefinition {
    Comment?: string;
    /**
     * Map-specific, and only valid on an `ItemProcessor` sub-definition rather
     * than on the Map state itself — this is where the ASL spec places it.
     * Selects inline vs distributed execution.
     */
    ProcessorConfig?: ProcessorConfig;
    QueryLanguage?: 'JSONata' | 'JSONPath';
    StartAt: string;
    States: Record<string, AslState>;
    TimeoutSeconds?: number;
    Version?: string;
}

// Internal Graph Types
/** A positioned graph node in the internal diagram model, produced from an ASL state. */
export interface StateNode {
    /**
     * Names of the variables a state assigns via ASL `Assign`, in declaration
     * order. Empty/absent when the state assigns nothing.
     */
    assignedVariables?: string[];
    /** Child node IDs (for container nodes like Parallel/Map) */
    children?: string[];
    /** Whether this container node is a collapse placeholder (its subgraph was removed). */
    collapsed?: boolean;
    /** Number of real descendant states hidden behind a collapsed container placeholder. */
    collapsedCount?: number;
    height?: number;
    /** URL to AWS service icon (CDN path for Task states) */
    iconUrl?: string;
    id: string;
    /** Whether this node is a container (Parallel or Map state) */
    isContainer?: boolean;
    /** Whether this Map state runs in distributed mode (`ProcessorConfig.Mode: 'DISTRIBUTED'`) */
    isDistributedMap?: boolean;
    label: string;
    /** A Map state's `MaxConcurrency`, when set. Displayed on the container header. */
    maxConcurrency?: number | string;
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
export type EdgeType = 'normal' | 'error' | 'choice' | 'default' | 'retry';

/** Diff status of a state between two ASL definitions */
export type DiffStatus = 'added' | 'modified' | 'removed';

/** A directed transition between two graph nodes in the internal diagram model. */
export interface GraphEdge {
    condition?: string;
    from: string;
    /**
     * Stable identity for this edge, unique across the whole graph:
     * `${from}->${to}#${type}#${ordinal}` — e.g. `Route->Work#choice#1`.
     * Assigned once by `parseAsl` and never renumbered, so it stays valid as a
     * `DiagramOptions.edgeOverrides` key even after a collapse removes sibling edges.
     */
    id: string;
    label?: string;
    to: string;
    type?: EdgeType;
    visualOnly?: boolean; // If true, edge is for rendering only and doesn't participate in layout
}

/** Node shape types for rendering state nodes */
export type NodeShape = 'rect' | 'diamond' | 'circle';

/** Visual styling (fill, stroke, shape) applied to a rendered state node. */
export interface NodeStyle {
    fill: string;
    stroke: string;
    strokeWidth: number;
    shape: NodeShape;
}

/**
 * Per-edge visual override applied on top of an edge's computed style.
 * Used by the execution overlay to emphasize taken transitions and dim untaken ones.
 * All fields are optional — only specified fields are overridden.
 */
export interface EdgeStyleOverride {
    /** Stroke colour for the edge path and arrowhead */
    stroke?: string;
    /** Stroke opacity (0-1); used to dim transitions the run did not take */
    strokeOpacity?: number;
    /** Stroke width in pixels */
    strokeWidth?: number;
}

// Theme Types
/** A fully-specified colour/typography theme for diagram rendering. */
export interface CustomTheme {
    background: string;
    edgeColors: {
        choice: string;
        default: string;
        error: string;
        normal: string;
        /** Colour for Retry self-loops; falls back to the error colour when omitted */
        retry?: string;
    };
    fontFamily: string;
    fontSize: number;
    nodeColors: Record<StateType, { fill: string; stroke: string }>;
    textColor: string;
}

// Diagram Configuration Union Types
/** Supported output formats for diagram generation */
export type DiagramFormat = 'html' | 'mermaid' | 'png' | 'svg';

/** Theme options: built-in themes or custom theme object */
export type ThemeOption = 'light' | 'dark' | CustomTheme;

/** Graph layout direction */
export type LayoutDirection = 'TB' | 'LR' | 'RL' | 'BT';

/** Edge path rendering style */
export type EdgePathStyle = 'straight' | 'curved' | 'orthogonal';

/** Catch/Retry label display style */
export type CatchLabelStyle = 'error-type' | 'catch-number';

/** How per-state Catch (error-handler) branches are treated in the diagram. */
export type CatchHandling = 'hide' | 'show';

/** Visual style preset for node shapes */
export type StylePreset = 'aws-standard' | 'enhanced';

// Configuration Types
/** Shared configuration options accepted by every diagram-generation function. */
export interface DiagramOptions {
    /**
     * Background color for PNG export
     * @default 'transparent'
     */
    backgroundColor?: string | 'transparent';

    /**
     * How to treat per-state Catch (error-handler) branches.
     * 'show' (default) renders them; 'hide' drops error edges and handler-only
     * nodes so the happy path reads clearly on large machines.
     * @default 'show'
     */
    catchHandling?: CatchHandling;

    /**
     * Style for Catch block edge labels: 'error-type' shows error names, 'catch-number' shows "Catch #N"
     * @default 'error-type'
     */
    catchLabelStyle?: CatchLabelStyle;

    /**
     * Collapse Parallel/Map containers into a placeholder node so dagre lays out a
     * smaller graph — hiding a container's children shrinks the diagram instead of
     * leaving an empty bounding box behind. `true` collapses every container; a
     * string array collapses only the named containers (names that don't resolve to
     * an existing container are ignored).
     * @default undefined (no collapsing)
     */
    collapse?: string[] | boolean;

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
     * Whether to annotate nodes with the variables they assign via ASL `Assign`.
     * Shown as `$var1, $var2` beneath the node label. States that assign nothing
     * are unaffected.
     * @default true
     */
    showVariables?: boolean;

    /**
     * Visual style preset: 'aws-standard' uses rectangles (AWS parity), 'enhanced' uses shapes for visual distinction
     * @default 'aws-standard'
     */
    stylePreset?: StylePreset;

    /** Color theme: 'light', 'dark', or custom theme object */
    theme?: ThemeOption;

    /** Overall diagram width in pixels (auto-calculated if not specified) */
    width?: number;

    /**
     * Per-node style overrides keyed by state name.
     * Merged on top of the node's computed style — only specified fields are overridden.
     */
    nodeOverrides?: Record<string, Partial<NodeStyle>>;

    /**
     * Per-edge style overrides keyed by `${from}->${to}`.
     * Merged on top of the edge's computed style — only specified fields are overridden.
     * Used by the execution overlay to highlight taken transitions and dim untaken ones.
     */
    edgeOverrides?: Record<string, EdgeStyleOverride>;

    /**
     * Extra annotation text rendered below a node's label, keyed by state name.
     * Used by the execution overlay to show per-state duration and retry counts.
     */
    nodeAnnotations?: Record<string, string>;
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

/** Self-contained interactive HTML diagram output. */
export interface HtmlOutput {
    /** Height of the diagram in pixels. */
    height: number;

    /** Complete, self-contained HTML document with an inline pan/zoom viewer. */
    html: string;

    /** Metadata about the generated diagram. */
    metadata: {
        /** Number of edges (transitions) in the diagram. */
        edgeCount: number;

        /** Number of state nodes in the diagram. */
        nodeCount: number;
    };

    /** Width of the diagram in pixels. */
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

/** Any diagram-generation result: SVG, Mermaid, or PNG output. */
export type DiagramOutput = SvgOutput | MermaidOutput | PngOutput;

// Function Parameter Types (object-based API)
/** Parameters for {@link SvgOutput}-producing `generateSvg`. */
export interface GenerateSvgParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

/** Parameters for `generateMermaid`. */
export interface GenerateMermaidParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

/** Parameters for `generateHtml`. */
export interface GenerateHtmlParams extends DiagramOptions {
    /** ASL definition as object or JSON string. */
    aslDefinition: AslDefinition | string;
}

/** Parameters for the format-dispatching `generateDiagram`. */
export interface GenerateDiagramParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

/** Parameters for `exportPng` (from the `sfn-diagram/png` subpath). */
export interface ExportPngParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
}

/** Parameters for `extractAslFromTemplate` (from the `sfn-diagram/cfn` subpath). */
export interface ExtractAslFromTemplateParams {
    /** Input format. 'auto' (default) sniffs JSON vs YAML. */
    format?: 'auto' | 'json' | 'yaml';
    /** Logical id of the state machine to extract when the template has more than one. */
    resourceId?: string;
    /** Raw template string (JSON or YAML) or an already-parsed template object. */
    template: string | Record<string, unknown>;
}

/** Result of extracting an ASL definition from a CloudFormation/SAM template. */
export interface ExtractAslResult {
    /** The recovered ASL definition, ready for generateSvg/generateMermaid/etc. */
    aslDefinition: AslDefinition;
    /** Logical id of the state machine that was extracted. */
    resourceId: string;
    /** Non-fatal notes (e.g. unresolved intrinsics replaced with placeholders). */
    warnings: string[];
}

/** Parameters for `generateFromAwsResponse`, which accepts a raw AWS SDK response. */
export interface GenerateFromAwsParams extends DiagramOptions {
    /** AWS SDK DescribeStateMachine command output */
    response: DescribeStateMachineCommandOutput;
}

/** Diff diagram output */
export interface DiffOutput {
    /** Height of the diagram in pixels */
    height: number;

    /** Change summary metadata */
    metadata: {
        /** State names present in `after` but not `before` */
        added: string[];

        /** Number of edges in the rendered diagram */
        edgeCount: number;

        /** State names modified between `before` and `after` */
        modified: string[];

        /** Number of nodes in the rendered diagram */
        nodeCount: number;

        /** State names present in `before` but not `after` */
        removed: string[];

        /** State names that did not change */
        unchanged: string[];
    };

    /** Complete SVG markup as a string */
    svg: string;

    /** Width of the diagram in pixels */
    width: number;
}

/** Parameters for `generateDiff`, comparing two ASL definitions into an SVG diff. */
export interface GenerateDiffParams extends DiagramOptions {
    /** The new (head) ASL definition */
    after: AslDefinition | string;

    /** The old (base) ASL definition */
    before: AslDefinition | string;
}

/** Mermaid diff output with added/modified/removed states highlighted */
export interface MermaidDiffOutput {
    /** Mermaid state diagram syntax with diff highlighting classes */
    code: string;

    /** Change summary metadata */
    metadata: {
        /** State names present in `after` but not `before` */
        added: string[];

        /** Number of transitions in the diagram */
        edgeCount: number;

        /** State names modified between `before` and `after` */
        modified: string[];

        /** State names present in `before` but not `after` */
        removed: string[];

        /** Number of states in the diagram */
        stateCount: number;

        /** State names that did not change */
        unchanged: string[];
    };
}

/** Parameters for `generateMermaidDiff`, comparing two ASL definitions into a Mermaid diff. */
export interface GenerateMermaidDiffParams {
    /** The new (head) ASL definition */
    after: AslDefinition | string;

    /** The old (base) ASL definition */
    before: AslDefinition | string;
}

// Execution Overlay Types

/**
 * Outcome of a single state within an execution.
 * - `succeeded`  — entered and completed normally (possibly after retries)
 * - `failed`     — errored terminally, or a Fail state that was reached
 * - `caught`     — errored but a Catch handled it and the run continued
 * - `running`    — entered but not yet exited (in-progress execution)
 * - `notReached` — never entered by this execution
 */
export type ExecutionStateStatus =
    | 'caught'
    | 'failed'
    | 'notReached'
    | 'running'
    | 'succeeded';

/** Per-state result derived from an execution's event history. */
export interface ExecutionStateResult {
    /** Number of attempts (1 + retries); always ≥ 1 for states that were entered */
    attempts: number;
    /** Total time spent in the state in milliseconds (summed across re-entries) */
    durationMs?: number;
    /** Error name associated with a failed/caught state */
    error?: string;
    /** Outcome of the state */
    status: ExecutionStateStatus;
}

/** Overall terminal status of an execution. */
export type ExecutionStatus =
    | 'aborted'
    | 'failed'
    | 'running'
    | 'succeeded'
    | 'timedOut';

/** A transition (edge) the execution actually followed. */
export interface TakenEdge {
    from: string;
    to: string;
}

/**
 * The computed execution model produced by {@link parseExecutionHistory}.
 * A pure, render-agnostic summary that any surface can consume.
 */
export interface ExecutionOverlay {
    /** Overall execution status */
    executionStatus: ExecutionStatus;
    /** Name of the state the execution started at, if determinable */
    startState?: string;
    /** Per-state results keyed by state name */
    states: Record<string, ExecutionStateResult>;
    /** Transitions the execution followed, deduplicated */
    takenEdges: TakenEdge[];
}

/**
 * Accepted forms of execution history input:
 * an events array, a raw GetExecutionHistory response, or a JSON string of either.
 */
export type ExecutionHistoryInput =
    | HistoryEvent[]
    | GetExecutionHistoryCommandOutput
    | { events: HistoryEvent[] }
    | string;

/** Parameters for `generateExecution`, overlaying an execution's outcome onto an SVG diagram. */
export interface GenerateExecutionParams extends DiagramOptions {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
    /** Execution history (events array, GetExecutionHistory response, or JSON string) */
    history: ExecutionHistoryInput;
}

/** Parameters for `generateMermaidExecution`, overlaying an execution's outcome onto a Mermaid diagram. */
export interface GenerateMermaidExecutionParams {
    /** ASL definition as object or JSON string */
    aslDefinition: AslDefinition | string;
    /** Execution history (events array, GetExecutionHistory response, or JSON string) */
    history: ExecutionHistoryInput;
}

/** Status summary shared by execution overlay outputs. */
export interface ExecutionMetadataSummary {
    /** State names that were caught */
    caught: string[];
    /** State names that failed */
    failed: string[];
    /** State names never reached */
    notReached: string[];
    /** State names still running */
    running: string[];
    /** State names that succeeded */
    succeeded: string[];
    /** Number of transitions the execution followed */
    takenEdgeCount: number;
}

/** SVG execution overlay output. */
export interface ExecutionOutput {
    /** Height of the diagram in pixels */
    height: number;
    /** Execution summary metadata */
    metadata: ExecutionMetadataSummary & {
        /** Number of edges in the rendered diagram */
        edgeCount: number;
        /** Overall execution status */
        executionStatus: ExecutionStatus;
        /** Number of nodes in the rendered diagram */
        nodeCount: number;
    };
    /** Complete SVG markup as a string */
    svg: string;
    /** Width of the diagram in pixels */
    width: number;
}

/** Mermaid execution overlay output. */
export interface MermaidExecutionOutput {
    /** Mermaid state diagram syntax with execution highlighting */
    code: string;
    /** Execution summary metadata */
    metadata: ExecutionMetadataSummary & {
        /** Number of transitions in the diagram */
        edgeCount: number;
        /** Overall execution status */
        executionStatus: ExecutionStatus;
        /** Number of states in the diagram */
        stateCount: number;
    };
}
