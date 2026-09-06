import type { AslDefinition, StateNode, GraphEdge, AslState, ChoiceRule, CatchBlock, DiagramOptions } from './types';
import { getNodeStyle } from './styles/NodeStyles';
import {
    EDGE_LABELS,
    getCatchLabel,
    getItemBatchingLabel,
    getRetryLabel,
    getToleratedFailureLabel,
    getWaitDurationLabel,
} from './constants';
import { detectService, detectServiceFromResource } from './services';
import {
    assignEdgeIds,
    branchEndMarkerId,
    buildIdResolver,
    getMapProcessor,
    ITEM_READER_ID_SUFFIX,
    iteratorEndMarkerId,
    RESULT_WRITER_ID_SUFFIX,
} from './graph';
import type { RawEdge, IdResolver, ScopePath } from './graph';

// Re-exported from its home in `graph/containers`: it was defined here, and both
// the viewer's state collection and the id resolver import it from this module.
export { getMapProcessor };
import { stripJsonataDelimiters } from './utils/jsonata';

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

interface ValidateScopeParams {
    /** The definition for this scope: the machine root, a Parallel branch, or a Map processor. */
    definition: unknown;
    /**
     * How to name this scope in an error message. Empty at the machine root, where
     * messages read as they always have; otherwise something like
     * `Parallel state "Fanout" branch 1`. Nested state names are only unique within
     * their own States block, so an unqualified name is not enough to locate a fault.
     */
    scope: string;
}

/**
 * Validates one `States` block and every scope nested inside it.
 *
 * Each scope is checked against its own set of state names, because ASL scopes
 * transitions: a `Next` inside a Parallel branch may only target a state in that
 * same branch. Validating nested scopes against the root's names would both miss
 * real dangling transitions and reject valid ones.
 */
function validateScope(params: ValidateScopeParams): void {
    const { definition, scope } = params;
    const isRoot = scope === '';
    // Root messages are preserved verbatim; nested ones are qualified by their scope.
    const subject = isRoot ? 'ASL definition' : scope;
    const qualify = (text: string): string => (isRoot ? text : `${scope}: ${text}`);
    // Scope labels compose, so a fault two levels down says which branch it is in.
    // A Map named "Each" inside each of two Parallel branches would otherwise produce
    // the same message for both - the exact ambiguity the qualifier exists to remove.
    const nest = (label: string): string => (isRoot ? label : `${scope} > ${label}`);

    // Check basic structure
    if (!definition || typeof definition !== 'object') {
        throw new AslValidationError(`${subject} must be a non-null object`);
    }

    const asl = definition as Record<string, unknown>;

    // Check for StartAt
    if (!('StartAt' in asl)) {
        throw new AslValidationError(`${subject} missing required field: StartAt`);
    }

    if (typeof asl.StartAt !== 'string' || asl.StartAt.trim() === '') {
        throw new AslValidationError(qualify('StartAt must be a non-empty string'));
    }

    // Check for States
    if (!('States' in asl)) {
        throw new AslValidationError(`${subject} missing required field: States`);
    }

    if (!asl.States || typeof asl.States !== 'object') {
        throw new AslValidationError(qualify('States must be a non-null object'));
    }

    const states = asl.States as Record<string, unknown>;
    const stateNames = Object.keys(states);

    if (stateNames.length === 0) {
        throw new AslValidationError(qualify('States object cannot be empty'));
    }

    // Set for O(1) reference checks. Every state validates its Next/Default/Choices/Catch
    // targets, so scanning the name array per state made validation O(n^2).
    const stateNameSet = new Set(stateNames);

    // Check that StartAt references an existing state
    if (!stateNameSet.has(asl.StartAt)) {
        throw new AslValidationError(
            qualify(
                `StartAt references non-existent state: "${asl.StartAt}". Available states: ${stateNames.join(', ')}`
            )
        );
    }

    // Validate each state
    for (const [stateName, stateValue] of Object.entries(states)) {
        validateState({ scope, stateName, stateNames: stateNameSet, stateValue });
    }

    // Recurse into every nested scope. Doing this after the current scope is fully
    // checked keeps the reported fault the outermost one, which is the useful one.
    for (const [stateName, stateValue] of Object.entries(states)) {
        const state = stateValue as AslState;

        if (state.Type === 'Parallel' && state.Branches !== undefined) {
            if (!Array.isArray(state.Branches)) {
                throw new AslValidationError(
                    qualify(`State "${stateName}": Branches must be an array`)
                );
            }
            state.Branches.forEach((branch, index) => {
                validateScope({
                    definition: branch,
                    scope: nest(`Parallel state "${stateName}" branch ${index + 1}`),
                });
            });
        }

        if (state.Type === 'Map') {
            const processor = getMapProcessor(state);
            if (processor !== undefined) {
                validateScope({
                    definition: processor,
                    scope: nest(`Map state "${stateName}" processor`),
                });
            }
        }
    }
}

/**
 * Validates an ASL definition and returns helpful error messages
 *
 * Recurses into Parallel `Branches` and a Map's `ItemProcessor` (or the legacy
 * `Iterator`), so a dangling transition or a malformed `States` block inside a
 * branch is reported as an {@link AslValidationError} rather than surfacing later
 * as a silently broken graph or a raw `TypeError` from the extractor.
 *
 * @param params - Validation parameters
 * @throws {AslValidationError} When the ASL definition is invalid
 */
export function validateAsl(params: ValidateAslParams): void {
    validateScope({ definition: params.definition, scope: '' });
}

interface ValidateStateParams {
    /** Scope label for error messages; empty at the machine root. See {@link validateScope}. */
    scope: string;
    /** Name of the state being validated */
    stateName: string;
    /** All valid state names *in this scope*, as a set for O(1) reference checking */
    stateNames: ReadonlySet<string>;
    /** The state object to validate */
    stateValue: unknown;
}

/**
 * Validates an individual state within an ASL definition
 */
function validateState(params: ValidateStateParams): void {
    const { scope, stateName, stateNames, stateValue } = params;
    // Nested state names repeat across scopes, so an unqualified message cannot say
    // which "Validate" is at fault. Root messages are left exactly as they were.
    // Explicitly typed: TypeScript only treats a call as never-returning for
    // control-flow narrowing when the const carries its own type annotation.
    const fail: (text: string) => never = (text) => {
        throw new AslValidationError(scope === '' ? text : `${scope}: ${text}`);
    };

    if (!stateValue || typeof stateValue !== 'object') {
        fail(`State "${stateName}" must be a non-null object`);
    }

    const state = stateValue as Record<string, unknown>;

    // Check for Type
    if (!('Type' in state)) {
        fail(`State "${stateName}" missing required field: Type`);
    }

    const stateType = state.Type;
    if (typeof stateType !== 'string' || !VALID_STATE_TYPES.includes(stateType as typeof VALID_STATE_TYPES[number])) {
        fail(
            `State "${stateName}" has invalid Type: "${stateType}". Valid types: ${VALID_STATE_TYPES.join(', ')}`
        );
    }

    // Check Next references valid states (if present)
    if ('Next' in state && state.Next !== undefined) {
        if (typeof state.Next !== 'string') {
            fail(`State "${stateName}": Next must be a string`);
        }
        if (!stateNames.has(state.Next)) {
            fail(
                `State "${stateName}": Next references non-existent state "${state.Next}"`
            );
        }
    }

    // Check Default references valid state (for Choice)
    if ('Default' in state && state.Default !== undefined) {
        if (typeof state.Default !== 'string') {
            fail(`State "${stateName}": Default must be a string`);
        }
        if (!stateNames.has(state.Default)) {
            fail(
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
                    fail(
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
                    fail(
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
            fail(
                `State "${stateName}" (Type: ${stateType}) must have either "Next" or "End: true"`
            );
        }
    }
}

/**
 * Parameters for creating a state node from an ASL state
 */
interface CreateStateNodeParams {
    /** Graph node id, scoped by nesting. May differ from `name` when the name repeats. */
    id: string;
    /** The state's own name within its `States` block, used as its display label. */
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
    /**
     * Turns a state name into its graph node id, bound to the scope this state lives
     * in. Every endpoint goes through it: ASL scopes transitions, so a branch-local
     * `Next: 'Validate'` means *that branch's* Validate, not a same-named state
     * elsewhere in the machine.
     */
    resolveId: (name: string) => string;
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
    const edges: RawEdge[] = [];

    // Validate ASL definition before parsing
    validateAsl({ definition });

    // Index of node id -> node for O(1) lookups during recursive extraction.
    // Avoids O(n^2) `nodes.find()` scans on large/deeply-nested state machines.
    const nodeIndex = new Map<string, StateNode>();

    // Node ids are scoped by nesting, because ASL only requires a state name to be
    // unique within its own States block. Both traversals below - one building nodes,
    // one building edges - resolve through this same instance, or an edge would land
    // on a different node than the one the name refers to in its own scope.
    const resolver = buildIdResolver({ definition });

    // Extract all states as nodes (including nested states)
    extractStatesRecursively({ definition, nodeIndex, nodes, options, resolver, scope: '' });

    // Extract transitions as edges
    for (const [stateName, state] of Object.entries(definition.States)) {
        const stateEdges = extractEdgesFromState({
            catchLabelStyle: options?.catchLabelStyle,
            resolveId: (name) => resolver.resolve('', name),
            state,
            stateName,
        });
        edges.push(...stateEdges);
    }

    // Extract edges from nested states (Parallel branches, Map iterators)
    extractNestedEdges({ definition, edges, options, resolver, scope: '' });

    return { edges: assignEdgeIds({ edges }), nodes };
}

function createStateNode(params: CreateStateNodeParams): StateNode {
    const { id, name, options, state, stylePreset } = params;
    const isContainer = state.Type === 'Parallel' || state.Type === 'Map';

    // When includeComments is enabled (the default), a state's Comment is used as its
    // display label; otherwise the state name is always used. Setting it to false lets
    // callers keep the canonical state names in the diagram.
    const includeComments = options?.includeComments !== false;
    const label = includeComments ? state.Comment || name : name;

    const baseNode: StateNode = {
        id,
        isContainer,
        label,
        style: getNodeStyle({ stateType: state.Type, stylePreset }),
        type: state.Type,
    };

    // ASL Variables: record which variables the state assigns so renderers can
    // surface them. Assignment is otherwise invisible in the diagram.
    const assignedVariables = Object.keys(state.Assign ?? {});
    if (assignedVariables.length > 0) {
        baseNode.assignedVariables = assignedVariables;
    }

    // A Wait state's duration is otherwise invisible: two Wait states render
    // identically whether one pauses five seconds and the other until a timestamp
    // resolved from the execution input.
    if (state.Type === 'Wait') {
        const waitDuration = getWaitDurationLabel(state);
        if (waitDuration !== '') {
            baseNode.waitDuration = waitDuration;
        }
    }

    // For container nodes, we'll populate children later
    if (isContainer) {
        baseNode.children = [];

        // A Distributed Map has materially different runtime semantics from an
        // inline Map (child executions, its own concurrency and failure
        // tolerance), so it is marked for distinct rendering. Note that
        // ProcessorConfig sits on the ItemProcessor sub-definition, not on the
        // Map state itself.
        if (state.Type === 'Map') {
            if (getMapProcessor(state)?.ProcessorConfig?.Mode === 'DISTRIBUTED') {
                baseNode.isDistributedMap = true;
            }
            if (state.MaxConcurrency !== undefined) {
                baseNode.maxConcurrency = state.MaxConcurrency;
            }

            const toleratedFailure = getToleratedFailureLabel(state);
            if (toleratedFailure !== '') {
                baseNode.toleratedFailure = toleratedFailure;
            }

            const itemBatching = getItemBatchingLabel(state);
            if (itemBatching !== '') {
                baseNode.itemBatching = itemBatching;
            }
        }
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

function extractEdgesFromState(params: ExtractEdgesFromStateParams): RawEdge[] {
    const { catchLabelStyle, resolveId, state, stateName } = params;
    const edges: RawEdge[] = [];
    const stateId = resolveId(stateName);

    // Connect Distributed Map I/O satellites: the ItemReader feeds the Map, and
    // the Map feeds the ResultWriter.
    if (state.Type === 'Map') {
        for (const io of ITEM_IO_ROLES) {
            if (!state[io.field]?.Resource) {
                continue;
            }

            const satelliteId = `${stateId}${io.idSuffix}`;
            edges.push(
                io.edgeDirection === 'in'
                    ? { from: satelliteId, label: io.label, to: stateId }
                    : { from: stateId, label: io.label, to: satelliteId }
            );
        }
    }

    switch (state.Type) {
        case 'Choice':
            // Handle choice branches
            if (state.Choices) {
                state.Choices.forEach((choice: ChoiceRule) => {
                    const condition = extractConditionLabel(choice);
                    edges.push({
                        condition,
                        from: stateId,
                        label: condition, // Use condition as label for display
                        to: resolveId(choice.Next),
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
                        from: stateId,
                        label: EDGE_LABELS.DEFAULT,
                        to: resolveId(state.Default),
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
                    from: stateId,
                    to: resolveId(state.Next),
                    type: 'normal',
                });
            }
            break;
    }

    // Handle retry policies as a self-loop edge (Retry). Marked visual-only so it does
    // not participate in dagre ranking; it is routed manually as a loop on the node.
    if (state.Retry && state.Retry.length > 0) {
        edges.push({
            from: stateId,
            label: getRetryLabel(state.Retry),
            to: stateId,
            type: 'retry',
            visualOnly: true,
        });
    }

    // Handle error transitions (Catch)
    if (state.Catch) {
        state.Catch.forEach((catchBlock: CatchBlock, index: number) => {
            if (catchBlock.Next) {
                edges.push({
                    from: stateId,
                    label: getCatchLabel({
                        catchLabelStyle,
                        errorTypes: catchBlock.ErrorEquals,
                        index,
                    }),
                    to: resolveId(catchBlock.Next),
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
            ? stripJsonataDelimiters(rule.Condition)
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
    /** Resolver turning a state name in `scope` into its graph node id. */
    resolver: IdResolver;
    /** The `States` block being walked. Empty at the machine root. */
    scope: ScopePath;
}


/**
 * The two Distributed Map I/O roles, rendered as satellite nodes beside the Map
 * container. `ItemReader` feeds the dataset in; `ResultWriter` receives results.
 */
const ITEM_IO_ROLES = [
    {
        edgeDirection: 'in',
        field: 'ItemReader',
        idSuffix: ITEM_READER_ID_SUFFIX,
        label: 'ItemReader',
        nodeType: 'ItemReader',
    },
    {
        edgeDirection: 'out',
        field: 'ResultWriter',
        idSuffix: RESULT_WRITER_ID_SUFFIX,
        label: 'ResultWriter',
        nodeType: 'ResultWriter',
    },
] as const satisfies ReadonlyArray<{
    edgeDirection: 'in' | 'out';
    field: 'ItemReader' | 'ResultWriter';
    idSuffix: string;
    label: string;
    nodeType: string;
}>;

/**
 * Recursively extract all states including those nested in Parallel branches and Map iterators
 */
function extractStatesRecursively(params: ExtractStatesRecursivelyParams): void {
    const { definition, nodeIndex, nodes, options, resolver, scope } = params;

    // Extract states from current level
    for (const [stateName, state] of Object.entries(definition.States)) {
        const stateNode = createStateNode({
            id: resolver.resolve(scope, stateName),
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
                const branchScope = resolver.branchScope(scope, stateName, index);

                // Extract branch states
                extractStatesRecursively({
                    definition: branch,
                    nodeIndex,
                    nodes,
                    options,
                    resolver,
                    scope: branchScope,
                });

                // Track children for bounding box calculation
                const branchStartId = resolver.resolve(branchScope, branch.StartAt);
                const branchStartState = nodeIndex.get(branchStartId);
                if (branchStartState) {
                    stateNode.children?.push(branchStartId);
                }

                // Create virtual end node for this branch
                const endNodeId = branchEndMarkerId(stateNode.id, index);
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
                markBranchStatesAsChildren({
                    branch,
                    containerNode: stateNode,
                    nodeIndex,
                    resolver,
                    scope: branchScope,
                });
            });
        }

        // Recursively extract states from Map processor (ItemProcessor or legacy Iterator)
        const mapProcessor = state.Type === 'Map' ? getMapProcessor(state) : undefined;
        if (state.Type === 'Map' && mapProcessor) {
            const iterator = mapProcessor;
            const processorScope = resolver.processorScope(scope, stateName);
            extractStatesRecursively({
                definition: iterator,
                nodeIndex,
                nodes,
                options,
                resolver,
                scope: processorScope,
            });

            // Track children for bounding box calculation
            const iteratorStartId = resolver.resolve(processorScope, iterator.StartAt);
            const iteratorStartState = nodeIndex.get(iteratorStartId);
            if (iteratorStartState) {
                stateNode.children?.push(iteratorStartId);
            }

            // Create virtual end node for iterator
            const endNodeId = iteratorEndMarkerId(stateNode.id);
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
            markBranchStatesAsChildren({
                branch: iterator,
                containerNode: stateNode,
                nodeIndex,
                resolver,
                scope: processorScope,
            });
        }

        // A Distributed Map reads its dataset from an ItemReader and writes
        // results to a ResultWriter. Both are real AWS resources (S3, Athena) that
        // the diagram would otherwise omit entirely, so surface each as a satellite
        // node beside the container rather than inside it.
        if (state.Type === 'Map') {
            for (const io of ITEM_IO_ROLES) {
                const resource = state[io.field]?.Resource;
                if (!resource) {
                    continue;
                }

                const service = detectServiceFromResource({
                    iconResolver: options?.iconResolver,
                    resource,
                });

                const satelliteId = `${stateNode.id}${io.idSuffix}`;
                const satelliteNode: StateNode = {
                    id: satelliteId,
                    isContainer: false,
                    label: service ? `${io.label} (${service.serviceName})` : io.label,
                    style: {
                        fill: '#eceff1',
                        shape: 'rect',
                        stroke: '#607d8b',
                        strokeWidth: 2,
                    },
                    type: io.nodeType,
                };

                if (options?.showIcons && service?.iconUrl) {
                    satelliteNode.iconUrl = service.iconUrl;
                    satelliteNode.serviceType = service.serviceName;
                }

                nodes.push(satelliteNode);
                nodeIndex.set(satelliteId, satelliteNode);
            }
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
    /** Resolver turning a state name in `scope` into its graph node id. */
    resolver: IdResolver;
    /** The branch's own scope. */
    scope: ScopePath;
}

/**
 * Mark all states in a branch as children of the container for bounding box calculation
 */
function markBranchStatesAsChildren(params: MarkBranchStatesAsChildrenParams): void {
    const { branch, containerNode, nodeIndex, resolver, scope } = params;
    const children = containerNode.children;
    if (!children) {
        return;
    }

    // Set of existing children for O(1) membership checks instead of repeated Array.includes
    const existingChildren = new Set(children);

    for (const stateName of Object.keys(branch.States)) {
        const id = resolver.resolve(scope, stateName);
        if (nodeIndex.has(id) && !existingChildren.has(id)) {
            children.push(id);
            existingChildren.add(id);
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
    edges: RawEdge[];
    /** Diagram generation options */
    options?: DiagramOptions;
    /** Resolver turning a state name in `scope` into its graph node id. */
    resolver: IdResolver;
    /** The `States` block being walked. Empty at the machine root. */
    scope: ScopePath;
}

/**
 * Extract edges from nested state machines (Parallel branches and Map iterators)
 */
function extractNestedEdges(params: ExtractNestedEdgesParams): void {
    const { definition, edges, options, resolver, scope } = params;

    for (const [stateName, state] of Object.entries(definition.States)) {
        // Extract edges from Parallel branches
        if (state.Type === 'Parallel' && state.Branches) {
            state.Branches.forEach((branch: AslDefinition, index: number) => {
                const containerId = resolver.resolve(scope, stateName);
                const branchScope = resolver.branchScope(scope, stateName, index);
                const endNodeId = branchEndMarkerId(containerId, index);

                // Add visual edge from container to branch start
                edges.push({
                    from: containerId,
                    to: resolver.resolve(branchScope, branch.StartAt),
                    type: 'normal',
                    visualOnly: true,
                });

                // Extract edges within each branch
                for (const [branchStateName, branchState] of Object.entries(branch.States)) {
                    const branchEdges = extractEdgesFromState({
                        catchLabelStyle: options?.catchLabelStyle,
                        resolveId: (name) => resolver.resolve(branchScope, name),
                        state: branchState,
                        stateName: branchStateName,
                    });
                    edges.push(...branchEdges);

                    // If this is a terminal state in the branch (End=true or no Next), connect to end marker
                    if (branchState.End || (!branchState.Next && branchState.Type !== 'Choice')) {
                        edges.push({
                            from: resolver.resolve(branchScope, branchStateName),
                            to: endNodeId,
                            type: 'normal',
                        });
                    }
                }

                // Create edge from each branch end marker to Next state for layout positioning
                // This ensures Next is centered below all branches. `Next` belongs to the
                // container's own scope, not the branch's - a branch cannot target it.
                if (state.Next) {
                    edges.push({
                        from: endNodeId,
                        to: resolver.resolve(scope, state.Next),
                        type: 'normal',
                    });
                }

                // Also create visual-only edge from container to Next for rendering
                if (state.Branches && index === state.Branches.length - 1 && state.Next) {
                    edges.push({
                        from: containerId,
                        to: resolver.resolve(scope, state.Next),
                        type: 'normal',
                        visualOnly: true,
                    });
                }

                // Recursively handle nested Parallel/Map states
                extractNestedEdges({
                    definition: branch,
                    edges,
                    options,
                    resolver,
                    scope: branchScope,
                });
            });
        }

        // Extract edges from Map processor (ItemProcessor or legacy Iterator)
        const mapProcessor = state.Type === 'Map' ? getMapProcessor(state) : undefined;
        if (state.Type === 'Map' && mapProcessor) {
            const containerId = resolver.resolve(scope, stateName);
            const processorScope = resolver.processorScope(scope, stateName);
            const endNodeId = iteratorEndMarkerId(containerId);

            // Add visual edge from container to iterator start
            edges.push({
                from: containerId,
                to: resolver.resolve(processorScope, mapProcessor.StartAt),
                type: 'normal',
                visualOnly: true,
            });

            for (const [iteratorStateName, iteratorState] of Object.entries(mapProcessor.States)) {
                const iteratorEdges = extractEdgesFromState({
                    catchLabelStyle: options?.catchLabelStyle,
                    resolveId: (name) => resolver.resolve(processorScope, name),
                    state: iteratorState,
                    stateName: iteratorStateName,
                });
                edges.push(...iteratorEdges);

                // If this is a terminal state in the iterator, connect to end marker
                if (iteratorState.End || (!iteratorState.Next && iteratorState.Type !== 'Choice')) {
                    edges.push({
                        from: resolver.resolve(processorScope, iteratorStateName),
                        to: endNodeId,
                        type: 'normal',
                    });
                }
            }

            // Create edge from iterator end marker to Next state for layout positioning.
            // `Next` belongs to the Map's own scope, not the processor's.
            if (state.Next) {
                edges.push({
                    from: endNodeId,
                    to: resolver.resolve(scope, state.Next),
                    type: 'normal',
                });

                // Also create visual-only edge from container to Next for rendering
                edges.push({
                    from: containerId,
                    to: resolver.resolve(scope, state.Next),
                    type: 'normal',
                    visualOnly: true,
                });
            }

            // Recursively handle nested Parallel/Map states
            extractNestedEdges({
                definition: mapProcessor,
                edges,
                options,
                resolver,
                scope: processorScope,
            });
        }
    }
}
