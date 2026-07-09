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
    /**
     * Render nodes and edges to Mermaid syntax
     */
    render(params: RenderMermaidParams): MermaidOutput {
        const { asl, edges, executionClasses, nodeAnnotations, nodes, stateClasses } =
            params;
        const lines: string[] = [];

        // Header
        lines.push('stateDiagram-v2');
        lines.push('');

        // Find start state from ASL or edges
        const startState = this.findStartState({ asl, edges, nodes });
        if (startState) {
            lines.push(`    [*] --> ${this.sanitizeId(startState)}`);
        }

        // Define states with labels
        const stateDefinitions = new Set<string>();
        nodes.forEach((node) => {
            const id = this.sanitizeId(node.id);
            if (stateDefinitions.has(id)) return;

            // Append any execution annotation (duration / retries) to the label.
            const annotation = nodeAnnotations?.[node.id];
            const displayLabel = annotation ? `${node.label} (${annotation})` : node.label;

            // Add a label line when it differs from the ID (or an annotation was added).
            if (displayLabel !== node.id) {
                lines.push(`    ${id}: ${this.escapeLabel(displayLabel)}`);
                stateDefinitions.add(id);
            }
        });

        if (stateDefinitions.size > 0) {
            lines.push('');
        }

        // Define transitions
        edges.forEach((edge) => {
            const from = this.sanitizeId(edge.from);
            const to = this.sanitizeId(edge.to);

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
                const id = this.sanitizeId(node.id);
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
            const id = this.sanitizeId(node.id);

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
     * Sanitize state ID for Mermaid (no spaces, special chars)
     */
    private sanitizeId(id: string): string {
        return id.replace(/[^a-zA-Z0-9_]/g, '_');
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
