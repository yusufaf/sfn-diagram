import { getMapProcessor } from '../../AslParser';
import { serializeForScriptBlock } from './scriptJson';
import type { AslDefinition, AslState } from '../../types';

/** Parameters for {@link collectStateData}. */
export interface CollectStateDataParams {
    /** The ASL definition to walk, including nested Parallel branches and Map processors. */
    definition: AslDefinition;
}

/** Parameters for {@link serializeStateData}. */
export interface SerializeStateDataParams {
    /** Raw ASL for each state, keyed by state name. */
    stateData: Record<string, AslState>;
}

/**
 * Collect the raw ASL of every state in a definition, keyed by state name.
 *
 * Recurses into Parallel `Branches` and a Map's processor (`ItemProcessor`, or the
 * legacy `Iterator`), producing the same flat keyspace the parser uses for node ids
 * — so a lookup by a node's `data-state-id` resolves directly against this record.
 *
 * @param params - Parameters for state collection
 * @param params.definition - ASL definition to walk
 * @returns Record mapping each state name to its raw ASL state object
 *
 * @example
 * ```typescript
 * const stateData = collectStateData({ definition: asl });
 * stateData['ProcessOrder']; // => { Type: 'Task', Resource: 'arn:aws:...' }
 * ```
 *
 * @remarks
 * ASL requires state names to be unique only within a single `States` block, so a
 * name reused inside a Parallel branch collapses onto the outer entry. This mirrors
 * the parser's own node-id behaviour, keeping the viewer consistent with the diagram.
 */
export function collectStateData(params: CollectStateDataParams): Record<string, AslState> {
    const { definition } = params;
    const stateData: Record<string, AslState> = {};

    const visit = (current: AslDefinition): void => {
        for (const [stateName, state] of Object.entries(current.States)) {
            stateData[stateName] = state;

            if (state.Type === 'Parallel' && state.Branches) {
                state.Branches.forEach((branch) => visit(branch));
            }

            if (state.Type === 'Map') {
                const processor = getMapProcessor(state);
                if (processor) {
                    visit(processor);
                }
            }
        }
    };

    visit(definition);
    return stateData;
}

/**
 * Serialize collected state data for embedding in an inline `<script>` block.
 *
 * Escapes every character that could break out of the script element, so a state
 * whose name or `Comment` contains `</script>` cannot terminate the document early.
 *
 * @param params - Parameters for serialization
 * @param params.stateData - Raw ASL for each state, keyed by state name
 * @returns JSON string safe to embed between `<script>` and `</script>` tags
 *
 * @example
 * ```typescript
 * const json = serializeStateData({ stateData: collectStateData({ definition: asl }) });
 * const html = `<script type="application/json" id="sfn-state-data">${json}</script>`;
 * ```
 */
export function serializeStateData(params: SerializeStateDataParams): string {
    return serializeForScriptBlock({ value: params.stateData });
}
