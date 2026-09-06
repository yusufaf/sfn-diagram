import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../../src/AslParser';
import { collectStateData } from '../../src/renderers/viewer';
import { generateExecution } from '../../src/execution';
import type { AslDefinition } from '../../src/types';

/**
 * ASL only requires a state name to be unique within its own `States` block, so two
 * Parallel branches may each contain a `Validate`. Using the bare name as the node id
 * collapsed them onto one node — dagre got an ambiguous graph and every edge to
 * `Validate` an ambiguous target, producing a silently wrong diagram.
 */

const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

/** Node types with no ASL state of their own; their ids derive from a container's. */
const VIRTUAL_NODE_TYPES = new Set(['BranchEnd', 'IteratorEnd', 'ItemReader', 'ResultWriter']);

function loadFixture(name: string): AslDefinition {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.asl.json`), 'utf8')) as AslDefinition;
}

/** Two Parallel branches that both contain `Validate` then `Work`. */
const duplicateBranches: AslDefinition = {
    StartAt: 'Fanout',
    States: {
        Fanout: {
            Type: 'Parallel',
            Next: 'Done',
            Branches: [
                {
                    StartAt: 'Validate',
                    States: {
                        Validate: { Type: 'Pass', Next: 'Work' },
                        Work: { Type: 'Pass', End: true },
                    },
                },
                {
                    StartAt: 'Validate',
                    States: {
                        Validate: { Type: 'Pass', Next: 'Work' },
                        Work: { Type: 'Pass', End: true },
                    },
                },
            ],
        },
        Done: { Type: 'Succeed' },
    },
} as AslDefinition;

describe('duplicate nested state names', () => {
    it('gives each branch its own node instead of collapsing them', () => {
        const { nodes } = parseAsl({ definition: duplicateBranches });

        const validates = nodes.filter((node) => node.label === 'Validate');
        expect(validates).toHaveLength(2);
        expect(new Set(validates.map((node) => node.id)).size).toBe(2);
    });

    it('keeps each branch label the bare state name', () => {
        const { nodes } = parseAsl({ definition: duplicateBranches });

        // The id disambiguates; the diagram still reads "Validate".
        for (const node of nodes.filter((candidate) => candidate.label === 'Validate')) {
            expect(node.id).not.toBe(node.label);
            expect(node.id.endsWith('Validate')).toBe(true);
        }
    });

    it('wires each branch to its own Work, not across branches', () => {
        const { edges, nodes } = parseAsl({ definition: duplicateBranches });
        const byId = new Map(nodes.map((node) => [node.id, node]));

        const validateToWork = edges.filter(
            (edge) => byId.get(edge.from)?.label === 'Validate' && byId.get(edge.to)?.label === 'Work'
        );

        expect(validateToWork).toHaveLength(2);
        // Each edge stays inside one branch: the two sources and the two targets are
        // distinct, so neither branch's Validate points at the other branch's Work.
        expect(new Set(validateToWork.map((edge) => edge.from)).size).toBe(2);
        expect(new Set(validateToWork.map((edge) => edge.to)).size).toBe(2);
    });

    it('gives every node a unique id', () => {
        const { nodes } = parseAsl({ definition: duplicateBranches });
        const ids = nodes.map((node) => node.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('lands every edge endpoint on a real node', () => {
        const { edges, nodes } = parseAsl({ definition: duplicateBranches });
        const ids = new Set(nodes.map((node) => node.id));

        for (const edge of edges) {
            expect(ids, `edge ${edge.id} has a dangling "from"`).toContain(edge.from);
            expect(ids, `edge ${edge.id} has a dangling "to"`).toContain(edge.to);
        }
    });

    it('assigns each duplicate its own container child entry', () => {
        const { nodes } = parseAsl({ definition: duplicateBranches });
        const container = nodes.find((node) => node.id === 'Fanout')!;

        const children = container.children ?? [];
        expect(new Set(children).size).toBe(children.length);
        expect(children.filter((id) => id.endsWith('Validate'))).toHaveLength(2);
    });

    it('keys collected state data by the same ids the parser assigns', () => {
        const { nodes } = parseAsl({ definition: duplicateBranches });
        const stateData = collectStateData({ definition: duplicateBranches });

        // Virtual nodes (branch end markers) have no ASL of their own; every real
        // state must resolve.
        const realNodeIds = nodes
            .filter((node) => !VIRTUAL_NODE_TYPES.has(node.type))
            .map((node) => node.id);

        for (const id of realNodeIds) {
            expect(stateData, `no state data for node "${id}"`).toHaveProperty(id);
        }
    });

    it('separates duplicates inside a Map processor as well', () => {
        const definition: AslDefinition = {
            StartAt: 'Handle',
            States: {
                Handle: { Type: 'Pass', Next: 'Each' },
                Each: {
                    Type: 'Map',
                    End: true,
                    ItemProcessor: {
                        StartAt: 'Handle',
                        States: { Handle: { Type: 'Pass', End: true } },
                    },
                },
            },
        } as AslDefinition;

        const { nodes } = parseAsl({ definition });
        const handles = nodes.filter((node) => node.label === 'Handle');

        expect(handles).toHaveLength(2);
        // The root occurrence keeps the bare name; the nested one is qualified.
        expect(handles.map((node) => node.id)).toContain('Handle');
    });

    describe('execution overlay', () => {
        // An execution history records only stateEnteredEventDetails.name - a bare name
        // with no branch context - while node ids are now scoped. Without re-keying,
        // every duplicated state renders as "not reached" even though it ran, which
        // would be a regression in exactly the definitions this change targets.
        // Event ids matter: takenEdges is derived by walking previousEventId back to
        // the nearest StateExited, so a history without them yields no transitions.
        const history = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: new Date('2026-01-01T00:00:00Z') },
            {
                id: 2,
                previousEventId: 1,
                type: 'ParallelStateEntered',
                timestamp: new Date('2026-01-01T00:00:01Z'),
                stateEnteredEventDetails: { name: 'Fanout' },
            },
            {
                id: 3,
                previousEventId: 2,
                type: 'PassStateEntered',
                timestamp: new Date('2026-01-01T00:00:02Z'),
                stateEnteredEventDetails: { name: 'Validate' },
            },
            {
                id: 4,
                previousEventId: 3,
                type: 'PassStateExited',
                timestamp: new Date('2026-01-01T00:00:03Z'),
                stateExitedEventDetails: { name: 'Validate' },
            },
            {
                id: 5,
                previousEventId: 4,
                type: 'PassStateEntered',
                timestamp: new Date('2026-01-01T00:00:04Z'),
                stateEnteredEventDetails: { name: 'Work' },
            },
            {
                id: 6,
                previousEventId: 5,
                type: 'PassStateExited',
                timestamp: new Date('2026-01-01T00:00:05Z'),
                stateExitedEventDetails: { name: 'Work' },
            },
            { id: 7, previousEventId: 6, type: 'ExecutionSucceeded', timestamp: new Date('2026-01-01T00:00:06Z') },
        ];

        it('highlights every node a run\'s state name can refer to', () => {
            const { svg } = generateExecution({
                aslDefinition: duplicateBranches,
                history: history as never,
            });

            // The succeeded fill, once per Validate node and once per Work node, rather
            // than every branch rendering as not-reached.
            const succeeded = (svg.match(/#c8e6c9/g) ?? []).length;
            expect(succeeded).toBeGreaterThanOrEqual(4);
        });

        it('does not dim the edges of a branch that ran', () => {
            const { svg } = generateExecution({
                aslDefinition: duplicateBranches,
                history: history as never,
            });

            const { edges, nodes } = parseAsl({ definition: duplicateBranches });
            const byId = new Map(nodes.map((node) => [node.id, node]));
            const validateToWork = edges.filter(
                (edge) =>
                    byId.get(edge.from)?.label === 'Validate' && byId.get(edge.to)?.label === 'Work'
            );

            expect(validateToWork.length).toBeGreaterThan(0);
            // Taken edges are drawn at full opacity; untaken ones carry the dim style.
            for (const edge of validateToWork) {
                const escapedId = edge.id.replace(/>/g, '&gt;');
                const path = svg.match(
                    new RegExp(`<path [^>]*data-edge-id="${escapedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)
                );
                expect(path, `no rendered path for ${edge.id}`).not.toBeNull();
                expect(path![0]).not.toContain('stroke-opacity="0.2"');
            }
        });
    });

    describe('compatibility', () => {
        const fixtures = readdirSync(FIXTURES_DIR)
            .filter((file) => file.endsWith('.asl.json'))
            .map((file) => file.replace('.asl.json', ''));

        /** Every state name in a definition, and whether any of them repeats. */
        function surveyNames(definition: AslDefinition): { names: Set<string>; repeats: boolean } {
            const names = new Set<string>();
            let repeats = false;

            const walk = (current: AslDefinition): void => {
                for (const [name, state] of Object.entries(current.States)) {
                    if (names.has(name)) repeats = true;
                    names.add(name);

                    if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
                        state.Branches.forEach(walk);
                    }
                    if (state.Type === 'Map') {
                        const processor = state.ItemProcessor ?? state.Iterator;
                        if (processor) walk(processor);
                    }
                }
            };
            walk(definition);

            return { names, repeats };
        }

        it('leaves ids unqualified for every fixture without duplicate names', () => {
            // The guarantee behind this change: a definition that is not currently
            // rendered wrong keeps the ids its callers already reference in
            // nodeOverrides / nodeAnnotations / edgeOverrides. `label` is no use here —
            // it carries the state's Comment when includeComments is on — so this
            // compares against the names in the definition itself.
            expect(fixtures.length).toBeGreaterThan(0);

            let checked = 0;
            for (const fixture of fixtures) {
                const definition = loadFixture(fixture);
                const { names, repeats } = surveyNames(definition);
                if (repeats) continue;

                checked++;
                for (const node of parseAsl({ definition }).nodes) {
                    // Virtual nodes and Distributed Map satellites derive their ids from
                    // a container's; only real states are subject to the guarantee.
                    // Filtered by node type, not by looking for the scope separator in
                    // the id - every wrongly-qualified id contains that separator, so a
                    // substring filter would skip exactly the failures this is for.
                    if (VIRTUAL_NODE_TYPES.has(node.type)) continue;
                    expect(names, `${fixture}: "${node.id}" is not a bare state name`).toContain(
                        node.id
                    );
                }
            }

            expect(checked).toBeGreaterThan(0);
        });

        it('keeps state-data keys aligned with node ids across every fixture', () => {
            for (const fixture of fixtures) {
                const definition = loadFixture(fixture);
                const { nodes } = parseAsl({ definition });
                const stateData = collectStateData({ definition });

                for (const node of nodes) {
                    if (VIRTUAL_NODE_TYPES.has(node.type)) continue;
                    expect(
                        stateData,
                        `${fixture}: no state data for node "${node.id}"`
                    ).toHaveProperty(node.id);
                }
            }
        });
    });
});
