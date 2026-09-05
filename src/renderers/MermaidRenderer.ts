import { getAssignedVariablesLabel, getNodeSubLabel } from '../constants/labels';
import type {
    StateNode,
    GraphEdge,
    MermaidOutput,
    AslDefinition,
    DiffStatus,
    ExecutionStateStatus,
} from '../types';

/** Mermaid classDef declarations for diff highlighting, keyed by diff status. */
const DIFF_CLASS_DEFS: Record<DiffStatus, string> = {
    added: 'classDef diffAdded fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px',
    modified: 'classDef diffModified fill:#fff9c4,stroke:#f57f17,stroke-width:2px',
    removed: 'classDef diffRemoved fill:#ffcdd2,stroke:#c62828,stroke-width:2px',
};

/** Mermaid class name applied to a state for a given diff status. */
const DIFF_CLASS_NAMES: Record<DiffStatus, string> = {
    added: 'diffAdded',
    modified: 'diffModified',
    removed: 'diffRemoved',
};

/** Mermaid classDef declarations for execution highlighting, keyed by status. */
const EXECUTION_CLASS_DEFS: Record<ExecutionStateStatus, string> = {
    caught: 'classDef execCaught fill:#ffe0b2,stroke:#e65100,stroke-width:2px',
    failed: 'classDef execFailed fill:#ffcdd2,stroke:#c62828,stroke-width:3px',
    notReached: 'classDef execNotReached fill:#f5f5f5,stroke:#bdbdbd,stroke-width:1px',
    running: 'classDef execRunning fill:#bbdefb,stroke:#1565c0,stroke-width:2px',
    succeeded: 'classDef execSucceeded fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px',
};

/** Mermaid class name applied to a state for a given execution status. */
const EXECUTION_CLASS_NAMES: Record<ExecutionStateStatus, string> = {
    caught: 'execCaught',
    failed: 'execFailed',
    notReached: 'execNotReached',
    running: 'execRunning',
    succeeded: 'execSucceeded',
};

// Internal parameter types for methods
interface RenderMermaidParams {
    asl?: AslDefinition;
    edges: GraphEdge[];
    /** Optional per-state execution status used to colour states by run outcome */
    executionClasses?: Record<string, ExecutionStateStatus>;
    /** Optional extra text appended to a state's label (e.g. execution duration) */
    nodeAnnotations?: Record<string, string>;
    nodes: StateNode[];
    /**
     * Whether to append assigned ASL variables to state labels.
     * @default true
     */
    showVariables?: boolean;
    /** Optional per-state diff status used to colour added/modified/removed states */
    stateClasses?: Record<string, DiffStatus>;
}

interface FindStartStateParams {
    asl: AslDefinition | undefined;
    edges: GraphEdge[];
    nodes: StateNode[];
}

/**
 * MermaidRenderer - Generates Mermaid state diagram syntax from ASL
 */
export class MermaidRenderer {
    /** Maps an original state id to its allocated, collision-safe Mermaid id. */
    private idMap = new Map<string, string>();
    /** Set of Mermaid ids already handed out in the current render pass. */
    private usedIds = new Set<string>();

    /**
     * Render nodes and edges to Mermaid syntax
     */
    render(params: RenderMermaidParams): MermaidOutput {
        const {
            asl,
            edges,
            executionClasses,
            nodeAnnotations,
            nodes,
            showVariables,
            stateClasses,
        } = params;
        const lines: string[] = [];

        // Reset per-render id allocation, then pre-allocate ids for every node in
        // order. Distinct state names that sanitize to the same base (e.g.
        // 'Check X' and 'Check-X' both -> 'Check_X') get suffixed unique ids, and
        // edges resolve to the same ids because allocation is cached per original id.
        this.idMap = new Map();
        this.usedIds = new Set();
        nodes.forEach((node) => this.mermaidId(node.id));

        // Header
        lines.push('stateDiagram-v2');
        lines.push('');

        // Find start state from ASL or edges
        const startState = this.findStartState({ asl, edges, nodes });
        if (startState) {
            lines.push(`    [*] --> ${this.mermaidId(startState)}`);
        }

        // Define states with labels
        const stateDefinitions = new Set<string>();
        nodes.forEach((node) => {
            const id = this.mermaidId(node.id);
            if (stateDefinitions.has(id)) return;

            // Append any execution annotation (duration / retries), the container's
            // Distributed/MaxConcurrency summary, and assigned ASL variables to the
            // label. All are collapsed into one parenthesised, `·`-separated group.
            const suffixParts = [
                nodeAnnotations?.[node.id],
                getNodeSubLabel({ node, showStateType: false }),
                showVariables === false
                    ? ''
                    : getAssignedVariablesLabel(node.assignedVariables ?? []),
            ].filter((part): part is string => Boolean(part));

            const displayLabel =
                suffixParts.length > 0
                    ? `${node.label} (${suffixParts.join(' · ')})`
                    : node.label;

            // Add a label line when the human label differs from the emitted id
            // (covers sanitized/suffixed ids and annotations), so the readable
            // name survives even when the id was rewritten for Mermaid.
            if (displayLabel !== id) {
                lines.push(`    ${id}: ${this.escapeLabel(displayLabel)}`);
                stateDefinitions.add(id);
            }
        });

        if (stateDefinitions.size > 0) {
            lines.push('');
        }

        // Define transitions
        edges.forEach((edge) => {
            const from = this.mermaidId(edge.from);
            const to = this.mermaidId(edge.to);

            if (edge.label || edge.condition) {
                const label = this.escapeLabel(
                    edge.condition || edge.label || '',
                );
                lines.push(`    ${from} --> ${to}: ${label}`);
            } else {
                lines.push(`    ${from} --> ${to}`);
            }
        });

        // Add end states (Succeed/Fail)
        const endStates = nodes.filter(
            (node) => node.type === 'Succeed' || node.type === 'Fail',
        );
        if (endStates.length > 0) {
            lines.push('');
            endStates.forEach((node) => {
                const id = this.mermaidId(node.id);
                lines.push(`    ${id} --> [*]`);
            });
        }

        // Add styling classes
        lines.push('');
        lines.push(
            '    classDef successState fill:#e8f5e8,stroke:#4caf50,stroke-width:3px',
        );
        lines.push(
            '    classDef failState fill:#ffebee,stroke:#f44336,stroke-width:3px',
        );
        lines.push(
            '    classDef choiceState fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px',
        );
        lines.push(
            '    classDef taskState fill:#fff3e0,stroke:#ef6c00,stroke-width:2px',
        );

        // Diff highlighting classes (only emitted when a diff map is supplied)
        const hasDiff = stateClasses && Object.keys(stateClasses).length > 0;
        if (hasDiff) {
            for (const status of Object.keys(DIFF_CLASS_DEFS) as DiffStatus[]) {
                lines.push(`    ${DIFF_CLASS_DEFS[status]}`);
            }
        }

        // Execution highlighting classes (only emitted when an execution map is supplied)
        const hasExecution =
            executionClasses && Object.keys(executionClasses).length > 0;
        if (hasExecution) {
            for (const status of Object.keys(EXECUTION_CLASS_DEFS) as ExecutionStateStatus[]) {
                lines.push(`    ${EXECUTION_CLASS_DEFS[status]}`);
            }
        }

        // Apply classes to states. An execution or diff status, when present, wins
        // over the state-type colour so the run outcome / change stands out.
        lines.push('');
        nodes.forEach((node) => {
            const id = this.mermaidId(node.id);

            const executionStatus = executionClasses?.[node.id];
            if (executionStatus) {
                lines.push(`    class ${id} ${EXECUTION_CLASS_NAMES[executionStatus]}`);
                return;
            }

            const diffStatus = stateClasses?.[node.id];
            if (diffStatus) {
                lines.push(`    class ${id} ${DIFF_CLASS_NAMES[diffStatus]}`);
                return;
            }

            switch (node.type) {
                case 'Succeed':
                    lines.push(`    class ${id} successState`);
                    break;
                case 'Fail':
                    lines.push(`    class ${id} failState`);
                    break;
                case 'Choice':
                    lines.push(`    class ${id} choiceState`);
                    break;
                case 'Task':
                    lines.push(`    class ${id} taskState`);
                    break;
            }
        });

        return {
            code: lines.join('\n'),
            metadata: {
                stateCount: nodes.length,
                edgeCount: edges.length,
            },
        };
    }

    /**
     * Resolve an original state id to a collision-safe Mermaid id.
     *
     * Sanitizes the id (non-`[a-zA-Z0-9_]` chars become `_`) and guarantees
     * uniqueness within a render: if the sanitized base is already taken by a
     * different original id, a numeric suffix (`_2`, `_3`, …) is appended.
     * Results are cached per original id so every reference (node definition,
     * edge endpoint, class assignment) resolves to the same id.
     */
    private mermaidId(originalId: string): string {
        const cached = this.idMap.get(originalId);
        if (cached) return cached;

        const base = originalId.replace(/[^a-zA-Z0-9_]/g, '_') || 'state';
        let candidate = base;
        let counter = 2;
        while (this.usedIds.has(candidate)) {
            candidate = `${base}_${counter++}`;
        }

        this.usedIds.add(candidate);
        this.idMap.set(originalId, candidate);
        return candidate;
    }

    /**
     * Escape label text for Mermaid
     */
    private escapeLabel(label: string): string {
        // Remove or escape characters that might break Mermaid syntax
        return label.replace(/"/g, "'").replace(/\n/g, ' ');
    }

    /**
     * Find the start state from ASL definition or by analyzing edges
     */
    private findStartState(params: FindStartStateParams): string | null {
        const { asl, edges, nodes } = params;

        // If ASL definition provided, use StartAt
        if (asl?.StartAt) {
            return asl.StartAt;
        }

        // Otherwise, find node that has no incoming edges
        const targetNodes = new Set(edges.map((edge) => edge.to));
        const startNode = nodes.find((node) => !targetNodes.has(node.id));
        return startNode?.id || nodes[0]?.id || null;
    }
}
