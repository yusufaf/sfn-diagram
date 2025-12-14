import type { AslDefinition, StateNode, GraphEdge, AslState, ChoiceRule, CatchBlock, DiagramOptions } from './types';
import { getNodeStyle } from './styles/NodeStyles';
import { EDGE_LABELS, getCatchLabel } from './constants';
import { detectService } from './services';

export interface ParseResult {
    edges: GraphEdge[];
    nodes: StateNode[];
}

interface CreateStateNodeParams {
    name: string;
    options?: DiagramOptions;
    state: AslState;
    stylePreset?: DiagramOptions['stylePreset'];
}

interface ExtractEdgesFromStateParams {
    catchLabelStyle: DiagramOptions['catchLabelStyle'];
    state: AslState;
    stateName: string;
}

interface ParseAslParams {
    definition: AslDefinition;
    options?: DiagramOptions;
}

export function parseAsl(params: ParseAslParams): ParseResult {
    const { definition, options } = params;
    const nodes: StateNode[] = [];
    const edges: GraphEdge[] = [];

    // Extract all states as nodes (including nested states)
    extractStatesRecursively({ definition, nodes, options });

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

    const baseNode: StateNode = {
        id: name,
        isContainer,
        label: state.Comment || name,
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
                state.Choices.forEach((choice: ChoiceRule, index: number) => {
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

function extractConditionLabel(choice: ChoiceRule): string {
    // Simplified condition extraction - you could make this more sophisticated
    const conditions = [];
    const variable = choice.Variable || '';

    if (choice.StringEquals !== undefined) {
        conditions.push(`${variable} == "${choice.StringEquals}"`);
    }
    if (choice.NumericEquals !== undefined) {
        conditions.push(`${variable} == ${choice.NumericEquals}`);
    }
    if (choice.BooleanEquals !== undefined) {
        conditions.push(`${variable} == ${choice.BooleanEquals}`);
    }

    return conditions.join(' AND ') || EDGE_LABELS.CONDITION_FALLBACK;
}

interface ExtractStatesRecursivelyParams {
    definition: AslDefinition;
    nodes: StateNode[];
    options?: DiagramOptions;
}

/**
 * Recursively extract all states including those nested in Parallel branches and Map iterators
 */
function extractStatesRecursively(params: ExtractStatesRecursivelyParams): void {
    const { definition, nodes, options } = params;

    // Extract states from current level
    for (const [stateName, state] of Object.entries(definition.States)) {
        const stateNode = createStateNode({
            name: stateName,
            options,
            state,
            stylePreset: options?.stylePreset,
        });
        nodes.push(stateNode);

        // Recursively extract states from Parallel branches
        if (state.Type === 'Parallel' && state.Branches) {
            state.Branches.forEach((branch: AslDefinition, index: number) => {
                // Extract branch states
                extractStatesRecursively({ definition: branch, nodes, options });

                // Track children for bounding box calculation
                const branchStartState = nodes.find((node) => node.id === branch.StartAt);
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
                stateNode.children?.push(endNodeId);

                // Track all branch states as children for bounding box
                markBranchStatesAsChildren({ branch, containerNode: stateNode, nodes });
            });
        }

        // Recursively extract states from Map iterator
        if (state.Type === 'Map' && state.Iterator) {
            const iterator = state.Iterator;
            extractStatesRecursively({ definition: iterator, nodes, options });

            // Track children for bounding box calculation
            const iteratorStartState = nodes.find((node) => node.id === iterator.StartAt);
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
            stateNode.children?.push(endNodeId);

            // Track all iterator states as children for bounding box
            markBranchStatesAsChildren({ branch: iterator, containerNode: stateNode, nodes });
        }
    }
}

interface MarkBranchStatesAsChildrenParams {
    branch: AslDefinition;
    containerNode: StateNode;
    nodes: StateNode[];
}

/**
 * Mark all states in a branch as children of the container for bounding box calculation
 */
function markBranchStatesAsChildren(params: MarkBranchStatesAsChildrenParams): void {
    const { branch, containerNode, nodes } = params;

    for (const stateName of Object.keys(branch.States)) {
        const node = nodes.find((n) => n.id === stateName);
        if (node && !containerNode.children?.includes(stateName)) {
            containerNode.children?.push(stateName);
        }
    }
}

interface ExtractNestedEdgesParams {
    definition: AslDefinition;
    edges: GraphEdge[];
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

        // Extract edges from Map iterator
        if (state.Type === 'Map' && state.Iterator) {
            const endNodeId = `${stateName}__iterator__end`;

            // Add visual edge from container to iterator start
            edges.push({
                from: stateName,
                to: state.Iterator.StartAt,
                type: 'normal',
                visualOnly: true,
            });

            for (const [iteratorStateName, iteratorState] of Object.entries(state.Iterator.States)) {
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
            extractNestedEdges({ definition: state.Iterator, edges, options });
        }
    }
}
