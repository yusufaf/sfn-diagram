import type { AslDefinition, StateNode, GraphEdge, AslState, ChoiceRule, CatchBlock, DiagramOptions } from './types';
import { getNodeStyle } from './styles/NodeStyles';
import { EDGE_LABELS, getCatchLabel, getRetryLabel } from './constants';
import { detectService } from './services';

/**
 * Error thrown when ASL validation fails
 */
export class AslValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AslValidationError';
    }
}

/**
 * Result of parsing an ASL definition into a graph structure
 */
export interface ParseResult {
    /** All edges (transitions) between states */
    edges: GraphEdge[];
    /** All state nodes including start/end markers */
    nodes: StateNode[];
}

/** Valid ASL state types */
const VALID_STATE_TYPES = ['Pass', 'Task', 'Choice', 'Wait', 'Succeed', 'Fail', 'Parallel', 'Map'] as const;

interface ValidateAslParams {
    /** The ASL definition to validate */
    definition: unknown;
}

/**
 * Validates an ASL definition and returns helpful error messages
 *
 * @param params - Validation parameters
 * @throws {AslValidationError} When the ASL definition is invalid
 */
export function validateAsl(params: ValidateAslParams): void {
    const { definition } = params;

    // Check basic structure
    if (!definition || typeof definition !== 'object') {
        throw new AslValidationError('ASL definition must be a non-null object');
    }

    const asl = definition as Record<string, unknown>;

    // Check for StartAt
    if (!('StartAt' in asl)) {
        throw new AslValidationError('ASL definition missing required field: StartAt');
    }

    if (typeof asl.StartAt !== 'string' || asl.StartAt.trim() === '') {
        throw new AslValidationError('StartAt must be a non-empty string');
    }

    // Check for States
    if (!('States' in asl)) {
        throw new AslValidationError('ASL definition missing required field: States');
    }

    if (!asl.States || typeof asl.States !== 'object') {
        throw new AslValidationError('States must be a non-null object');
    }

    const states = asl.States as Record<string, unknown>;
    const stateNames = Object.keys(states);

    if (stateNames.length === 0) {
        throw new AslValidationError('States object cannot be empty');
    }

    // Set for O(1) reference checks. Every state validates its Next/Default/Choices/Catch
    // targets, so scanning the name array per state made validation O(n^2).
    const stateNameSet = new Set(stateNames);

    // Check that StartAt references an existing state
    if (!stateNameSet.has(asl.StartAt as string)) {
        throw new AslValidationError(
            `StartAt references non-existent state: "${asl.StartAt}". Available states: ${stateNames.join(', ')}`
        );
    }

    // Validate each state
    for (const [stateName, stateValue] of Object.entries(states)) {
        validateState({ stateName, stateNames: stateNameSet, stateValue });
    }
}

interface ValidateStateParams {
    /** Name of the state being validated */
    stateName: string;
    /** All valid state names, as a set for O(1) reference checking */
    stateNames: ReadonlySet<string>;
    /** The state object to validate */
    stateValue: unknown;
}

/**
 * Validates an individual state within an ASL definition
 */
function validateState(params: ValidateStateParams): void {
    const { stateName, stateNames, stateValue } = params;

    if (!stateValue || typeof stateValue !== 'object') {
        throw new AslValidationError(`State "${stateName}" must be a non-null object`);
    }

    const state = stateValue as Record<string, unknown>;

    // Check for Type
    if (!('Type' in state)) {
        throw new AslValidationError(`State "${stateName}" missing required field: Type`);
    }

    const stateType = state.Type;
    if (typeof stateType !== 'string' || !VALID_STATE_TYPES.includes(stateType as typeof VALID_STATE_TYPES[number])) {
        throw new AslValidationError(
            `State "${stateName}" has invalid Type: "${stateType}". Valid types: ${VALID_STATE_TYPES.join(', ')}`
        );
    }

    // Check Next references valid states (if present)
    if ('Next' in state && state.Next !== undefined) {
        if (typeof state.Next !== 'string') {
            throw new AslValidationError(`State "${stateName}": Next must be a string`);
        }
        if (!stateNames.has(state.Next)) {
            throw new AslValidationError(
                `State "${stateName}": Next references non-existent state "${state.Next}"`
            );
        }
    }

    // Check Default references valid state (for Choice)
    if ('Default' in state && state.Default !== undefined) {
        if (typeof state.Default !== 'string') {
            throw new AslValidationError(`State "${stateName}": Default must be a string`);
        }
        if (!stateNames.has(state.Default)) {
            throw new AslValidationError(
                `State "${stateName}": Default references non-existent state "${state.Default}"`
            );
        }
    }

    // Check Choices reference valid states
    if ('Choices' in state && Array.isArray(state.Choices)) {
        for (const [index, choice] of (state.Choices as unknown[]).entries()) {
            if (choice && typeof choice === 'object' && 'Next' in choice) {
                const choiceNext = (choice as Record<string, unknown>).Next;
                if (typeof choiceNext === 'string' && !stateNames.has(choiceNext)) {
                    throw new AslValidationError(
                        `State "${stateName}": Choices[${index}].Next references non-existent state "${choiceNext}"`
                    );
                }
            }
        }
    }

    // Check Catch references valid states
    if ('Catch' in state && Array.isArray(state.Catch)) {
        for (const [index, catchBlock] of (state.Catch as unknown[]).entries()) {
            if (catchBlock && typeof catchBlock === 'object' && 'Next' in catchBlock) {
                const catchNext = (catchBlock as Record<string, unknown>).Next;
                if (typeof catchNext === 'string' && !stateNames.has(catchNext)) {
                    throw new AslValidationError(
                        `State "${stateName}": Catch[${index}].Next references non-existent state "${catchNext}"`
                    );
                }
            }
        }
    }

    // Validate that non-terminal states have either Next or End
    const terminalTypes = ['Succeed', 'Fail'];
    if (!terminalTypes.includes(stateType as string) && stateType !== 'Choice') {
        const hasNext = 'Next' in state;
        const hasEnd = 'End' in state && state.End === true;
        if (!hasNext && !hasEnd) {
            throw new AslValidationError(
                `State "${stateName}" (Type: ${stateType}) must have either "Next" or "End: true"`
            );
        }
    }
}

/**
 * Parameters for creating a state node from an ASL state
 */
interface CreateStateNodeParams {
    /** Unique identifier/name for the state */
    name: string;
    /** Diagram generation options */
    options?: DiagramOptions;
    /** The ASL state definition */
    state: AslState;
    /** Style preset for node rendering */
    stylePreset?: DiagramOptions['stylePreset'];
}

/**
 * Parameters for extracting graph edges from a state
 */
interface ExtractEdgesFromStateParams {
    /** How to label catch/error edges */
    catchLabelStyle: DiagramOptions['catchLabelStyle'];
    /** The ASL state to extract edges from */
    state: AslState;
    /** Name of the state (used as edge source) */
    stateName: string;
}

/**
 * Parameters for parsing an ASL definition into a graph
 */
interface ParseAslParams {
    /** The ASL definition to parse */
    definition: AslDefinition;
    /** Optional diagram generation options */
    options?: DiagramOptions;
}

export function parseAsl(params: ParseAslParams): ParseResult {
    const { definition, options } = params;
    const nodes: StateNode[] = [];
    const edges: GraphEdge[] = [];

    // Validate ASL definition before parsing
    validateAsl({ definition });

    // Index of node id -> node for O(1) lookups during recursive extraction.
    // Avoids O(n^2) `nodes.find()` scans on large/deeply-nested state machines.
    const nodeIndex = new Map<string, StateNode>();

    // Extract all states as nodes (including nested states)
    extractStatesRecursively({ definition, nodeIndex, nodes, options });

    // Extract transitions as edges
    for (const [stateName, state] of Object.entries(definition.States)) {
        const stateEdges = extractEdgesFromState({
            catchLabelStyle: options?.catchLabelStyle,
            state,
            stateName,
        });
        edges.push(...stateEdges);
    }

    // Extract edges from nested states (Parallel branches, Map iterators)
    extractNestedEdges({ definition, edges, options });

    return { edges, nodes };
}

function createStateNode(params: CreateStateNodeParams): StateNode {
    const { name, options, state, stylePreset } = params;
    const isContainer = state.Type === 'Parallel' || state.Type === 'Map';

    // When includeComments is enabled (the default), a state's Comment is used as its
    // display label; otherwise the state name is always used. Setting it to false lets
    // callers keep the canonical state names in the diagram.
    const includeComments = options?.includeComments !== false;
    const label = includeComments ? state.Comment || name : name;

    const baseNode: StateNode = {
        id: name,
        isContainer,
        label,
        style: getNodeStyle({ stateType: state.Type, stylePreset }),
        type: state.Type,
    };

    // For container nodes, we'll populate children later
    if (isContainer) {
        baseNode.children = [];
    }

    // Detect AWS service for Task states if icons enabled
    if (options?.showIcons && state.Type === 'Task') {
        const serviceInfo = detectService({
            iconResolver: options.iconResolver,
            state,
        });
        if (serviceInfo) {
            baseNode.serviceType = serviceInfo.serviceName;
            baseNode.iconUrl = serviceInfo.iconUrl || undefined;
        }
    }

    return baseNode;
}

function extractEdgesFromState(params: ExtractEdgesFromStateParams): GraphEdge[] {
    const { catchLabelStyle, state, stateName } = params;
    const edges: GraphEdge[] = [];

    switch (state.Type) {
        case 'Choice':
            // Handle choice branches
            if (state.Choices) {
                state.Choices.forEach((choice: ChoiceRule) => {
                    const condition = extractConditionLabel(choice);
                    edges.push({
                        condition,
                        from: stateName,
                        label: condition, // Use condition as label for display
                        to: choice.Next,
                        type: 'choice',
                    });
                });
            }

            // Handle default branch (skip if it goes to same target as any choice)
            if (state.Default) {
                const choiceTargets = state.Choices?.map((choice) => choice.Next) || [];
                const isRedundant = choiceTargets.includes(state.Default);

                if (!isRedundant) {
                    edges.push({
                        from: stateName,
                        label: EDGE_LABELS.DEFAULT,
                        to: state.Default,
                        type: 'default',
                    });
                }
            }
            break;

        case 'Parallel':
            // NOTE: Edges from branch end markers to Next state are created in extractNestedEdges
            // We don't create edges from the Parallel container node because it's not in the dagre layout
            break;

        case 'Map':
            // NOTE: Edges from iterator end marker to Next state are created in extractNestedEdges
            // We don't create edges from the Map container node because it's not in the dagre layout
            break;

        default:
            // Handle simple Next transitions
            if (state.Next) {
                edges.push({
                    from: stateName,
                    to: state.Next,
                    type: 'normal',
                });
            }
            break;
    }

    // Handle retry policies as a self-loop edge (Retry). Marked visual-only so it does
    // not participate in dagre ranking; it is routed manually as a loop on the node.
    if (state.Retry && state.Retry.length > 0) {
        edges.push({
            from: stateName,
            label: getRetryLabel(state.Retry),
            to: stateName,
            type: 'retry',
            visualOnly: true,
        });
    }

    // Handle error transitions (Catch)
    if (state.Catch) {
        state.Catch.forEach((catchBlock: CatchBlock, index: number) => {
            if (catchBlock.Next) {
                edges.push({
                    from: stateName,
                    label: getCatchLabel({
                        catchLabelStyle,
                        errorTypes: catchBlock.ErrorEquals,
                        index,
                    }),
                    to: catchBlock.Next,
                    type: 'error',
                });
            }
        });
    }

    return edges;
}

/** ASL data-type prefixes for typed comparison operators */
const COMPARISON_TYPE_PREFIXES = ['String', 'Numeric', 'Boolean', 'Timestamp'] as const;

/** Operator suffixes mapped to display symbols (longest suffixes first for matching) */
const COMPARISON_OPERATORS: ReadonlyArray<readonly [string, string]> = [
    ['LessThanEquals', '<='],
    ['GreaterThanEquals', '>='],
    ['LessThan', '<'],
    ['GreaterThan', '>'],
    ['Equals', '=='],
    ['Matches', 'matches'],
];

/** Unary presence/type checks mapped to display phrases */
const IS_CHECKS: Record<string, string> = {
    IsBoolean: 'is boolean',
    IsNull: 'is null',
    IsNumeric: 'is numeric',
    IsPresent: 'is present',
    IsString: 'is string',
    IsTimestamp: 'is timestamp',
};

/** Strip JSONata delimiters (`{% ... %}`) from a condition expression. */
function cleanJsonataExpression(expression: string): string {
    return expression.replace(/^\{%\s*/, '').replace(/\s*%\}$/, '').trim();
}

/**
 * Format a single comparison operator on a Choice rule into a readable label,
 * or return null if the key is not a recognized comparison operator.
 */
function formatComparison(variable: string, operatorKey: string, value: unknown): string | null {
    const isCheckPhrase = IS_CHECKS[operatorKey];
    if (isCheckPhrase) {
        return value === false
            ? `${variable} ${isCheckPhrase.replace('is ', 'is not ')}`
            : `${variable} ${isCheckPhrase}`;
    }

    const isPath = operatorKey.endsWith('Path');
    const baseKey = isPath ? operatorKey.slice(0, -'Path'.length) : operatorKey;

    const prefix = COMPARISON_TYPE_PREFIXES.find((typePrefix) => baseKey.startsWith(typePrefix));
    if (!prefix) {
        return null;
    }

    const suffix = baseKey.slice(prefix.length);
    const operator = COMPARISON_OPERATORS.find(([name]) => name === suffix);
    if (!operator) {
        return null;
    }

    const shouldQuote = !isPath && (prefix === 'String' || prefix === 'Timestamp');
    const formattedValue = shouldQuote ? JSON.stringify(value) : String(value);
    return `${variable} ${operator[1]} ${formattedValue}`;
}

/**
 * Recursively describe a Choice rule, handling And/Or/Not combinators,
 * the full set of typed comparison operators, presence checks, and JSONata conditions.
 */
function describeChoiceRule(rule: ChoiceRule): string {
    // JSONata conditions carry the full expression in a `Condition` field. It is
    // usually a `{% ... %}` string, but may also be a boolean/number catch-all.
    if (rule.Condition !== undefined) {
        return typeof rule.Condition === 'string'
            ? cleanJsonataExpression(rule.Condition)
            : String(rule.Condition);
    }

    if (Array.isArray(rule.And)) {
        const parts = rule.And.map(describeChoiceRule).filter(Boolean);
        return parts.length > 0 ? parts.join(' AND ') : '';
    }
    if (Array.isArray(rule.Or)) {
        const parts = rule.Or.map(describeChoiceRule).filter(Boolean);
        return parts.length > 0 ? parts.join(' OR ') : '';
    }
    if (rule.Not && typeof rule.Not === 'object') {
        const inner = describeChoiceRule(rule.Not as ChoiceRule);
        return inner ? `NOT (${inner})` : '';
    }

    const variable = rule.Variable || '';
    for (const [operatorKey, value] of Object.entries(rule)) {
        const formatted = formatComparison(variable, operatorKey, value);
        if (formatted) {
            return formatted;
        }
    }

    return '';
}

function extractConditionLabel(choice: ChoiceRule): string {
    return describeChoiceRule(choice) || EDGE_LABELS.CONDITION_FALLBACK;
}

/**
 * Parameters for recursive state extraction
 */
interface ExtractStatesRecursivelyParams {
    /** ASL definition containing states to extract */
    definition: AslDefinition;
    /** Index of node id -> node for O(1) lookups */
    nodeIndex: Map<string, StateNode>;
    /** Array to accumulate extracted nodes into */
    nodes: StateNode[];
    /** Diagram generation options */
    options?: DiagramOptions;
}

/**
 * Resolve a Map state's inline processor definition.
 * Prefers the modern `ItemProcessor` field (used by inline and Distributed Map)
 * and falls back to the legacy `Iterator` field for pre-2022 definitions.
 */
function getMapProcessor(state: AslState): AslDefinition | undefined {
    return state.ItemProcessor ?? state.Iterator;
}

/**
 * Recursively extract all states including those nested in Parallel branches and Map iterators
 */
function extractStatesRecursively(params: ExtractStatesRecursivelyParams): void {
    const { definition, nodeIndex, nodes, options } = params;

    // Extract states from current level
    for (const [stateName, state] of Object.entries(definition.States)) {
        const stateNode = createStateNode({
            name: stateName,
            options,
            state,
            stylePreset: options?.stylePreset,
        });
        nodes.push(stateNode);
        nodeIndex.set(stateNode.id, stateNode);

        // Recursively extract states from Parallel branches
        if (state.Type === 'Parallel' && state.Branches) {
            state.Branches.forEach((branch: AslDefinition, index: number) => {
                // Extract branch states
                extractStatesRecursively({ definition: branch, nodeIndex, nodes, options });

                // Track children for bounding box calculation
                const branchStartState = nodeIndex.get(branch.StartAt);
                if (branchStartState) {
                    stateNode.children?.push(branch.StartAt);
                }

                // Create virtual end node for this branch
                const endNodeId = `${stateName}__branch${index}__end`;
                const endNode: StateNode = {
                    id: endNodeId,
                    isContainer: false,
                    label: '',
                    style: {
                        fill: '#fff9cc',
                        shape: 'circle',
                        stroke: '#687078',
                        strokeWidth: 0.6,
                    },
                    type: 'BranchEnd',
                };
                nodes.push(endNode);
                nodeIndex.set(endNodeId, endNode);
                stateNode.children?.push(endNodeId);

                // Track all branch states as children for bounding box
                markBranchStatesAsChildren({ branch, containerNode: stateNode, nodeIndex });
            });
        }

        // Recursively extract states from Map processor (ItemProcessor or legacy Iterator)
        const mapProcessor = state.Type === 'Map' ? getMapProcessor(state) : undefined;
        if (state.Type === 'Map' && mapProcessor) {
            const iterator = mapProcessor;
            extractStatesRecursively({ definition: iterator, nodeIndex, nodes, options });

            // Track children for bounding box calculation
            const iteratorStartState = nodeIndex.get(iterator.StartAt);
            if (iteratorStartState) {
                stateNode.children?.push(iterator.StartAt);
            }

            // Create virtual end node for iterator
            const endNodeId = `${stateName}__iterator__end`;
            const endNode: StateNode = {
                id: endNodeId,
                isContainer: false,
                label: '',
                style: {
                    fill: '#fff9cc',
                    shape: 'circle',
                    stroke: '#687078',
                    strokeWidth: 0.6,
                },
                type: 'IteratorEnd',
            };
            nodes.push(endNode);
            nodeIndex.set(endNodeId, endNode);
            stateNode.children?.push(endNodeId);

            // Track all iterator states as children for bounding box
            markBranchStatesAsChildren({ branch: iterator, containerNode: stateNode, nodeIndex });
        }
    }
}

/**
 * Parameters for marking branch states as children of a container
 */
interface MarkBranchStatesAsChildrenParams {
    /** Branch or iterator definition containing child states */
    branch: AslDefinition;
    /** Parent container node (Parallel or Map) */
    containerNode: StateNode;
    /** Index of node id -> node for O(1) lookups */
    nodeIndex: Map<string, StateNode>;
}

/**
 * Mark all states in a branch as children of the container for bounding box calculation
 */
function markBranchStatesAsChildren(params: MarkBranchStatesAsChildrenParams): void {
    const { branch, containerNode, nodeIndex } = params;
    const children = containerNode.children;
    if (!children) {
        return;
    }

    // Set of existing children for O(1) membership checks instead of repeated Array.includes
    const existingChildren = new Set(children);

    for (const stateName of Object.keys(branch.States)) {
        if (nodeIndex.has(stateName) && !existingChildren.has(stateName)) {
            children.push(stateName);
            existingChildren.add(stateName);
        }
    }
}

/**
 * Parameters for extracting edges from nested state machines
 */
interface ExtractNestedEdgesParams {
    /** ASL definition to extract nested edges from */
    definition: AslDefinition;
    /** Array to accumulate extracted edges into */
    edges: GraphEdge[];
    /** Diagram generation options */
    options?: DiagramOptions;
}

/**
 * Extract edges from nested state machines (Parallel branches and Map iterators)
 */
function extractNestedEdges(params: ExtractNestedEdgesParams): void {
    const { definition, edges, options } = params;

    for (const [stateName, state] of Object.entries(definition.States)) {
        // Extract edges from Parallel branches
        if (state.Type === 'Parallel' && state.Branches) {
            state.Branches.forEach((branch: AslDefinition, index: number) => {
                const endNodeId = `${stateName}__branch${index}__end`;

                // Add visual edge from container to branch start
                edges.push({
                    from: stateName,
                    to: branch.StartAt,
                    type: 'normal',
                    visualOnly: true,
                });

                // Extract edges within each branch
                for (const [branchStateName, branchState] of Object.entries(branch.States)) {
                    const branchEdges = extractEdgesFromState({
                        catchLabelStyle: options?.catchLabelStyle,
                        state: branchState,
                        stateName: branchStateName,
                    });
                    edges.push(...branchEdges);

                    // If this is a terminal state in the branch (End=true or no Next), connect to end marker
                    if (branchState.End || (!branchState.Next && branchState.Type !== 'Choice')) {
                        edges.push({
                            from: branchStateName,
                            to: endNodeId,
                            type: 'normal',
                        });
                    }
                }

                // Create edge from each branch end marker to Next state for layout positioning
                // This ensures Next is centered below all branches
                if (state.Next) {
                    edges.push({
                        from: endNodeId,
                        to: state.Next,
                        type: 'normal',
                    });
                }

                // Also create visual-only edge from container to Next for rendering
                if (state.Branches && index === state.Branches.length - 1 && state.Next) {
                    edges.push({
                        from: stateName,
                        to: state.Next,
                        type: 'normal',
                        visualOnly: true,
                    });
                }

                // Recursively handle nested Parallel/Map states
                extractNestedEdges({ definition: branch, edges, options });
            });
        }

        // Extract edges from Map processor (ItemProcessor or legacy Iterator)
        const mapProcessor = state.Type === 'Map' ? getMapProcessor(state) : undefined;
        if (state.Type === 'Map' && mapProcessor) {
            const endNodeId = `${stateName}__iterator__end`;

            // Add visual edge from container to iterator start
            edges.push({
                from: stateName,
                to: mapProcessor.StartAt,
                type: 'normal',
                visualOnly: true,
            });

            for (const [iteratorStateName, iteratorState] of Object.entries(mapProcessor.States)) {
                const iteratorEdges = extractEdgesFromState({
                    catchLabelStyle: options?.catchLabelStyle,
                    state: iteratorState,
                    stateName: iteratorStateName,
                });
                edges.push(...iteratorEdges);

                // If this is a terminal state in the iterator, connect to end marker
                if (iteratorState.End || (!iteratorState.Next && iteratorState.Type !== 'Choice')) {
                    edges.push({
                        from: iteratorStateName,
                        to: endNodeId,
                        type: 'normal',
                    });
                }
            }

            // Create edge from iterator end marker to Next state for layout positioning
            if (state.Next) {
                edges.push({
                    from: endNodeId,
                    to: state.Next,
                    type: 'normal',
                });

                // Also create visual-only edge from container to Next for rendering
                edges.push({
                    from: stateName,
                    to: state.Next,
                    type: 'normal',
                    visualOnly: true,
                });
            }

            // Recursively handle nested Parallel/Map states
            extractNestedEdges({ definition: mapProcessor, edges, options });
        }
    }
}
