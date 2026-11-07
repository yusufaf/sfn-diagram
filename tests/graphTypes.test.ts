import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAsl } from '../src/AslParser';
import type { AslDefinition } from '../src/types';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__graphTypes.snippet.ts');

const NODE_TYPES = new Set([
    'BranchEnd',
    'Choice',
    'Fail',
    'ItemReader',
    'IteratorEnd',
    'Map',
    'Parallel',
    'Pass',
    'ResultWriter',
    'Succeed',
    'Task',
    'Wait',
]);

function loadFixture(name: string): AslDefinition {
    return JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures', `${name}.asl.json`), 'utf8')) as AslDefinition;
}

describe('graph types (2.0)', () => {
    it(
        'StateNode.type rejects a value outside NodeType',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import type { StateNode } from '../src/index';\nexport const node: StateNode = { id: 'a', label: 'a', type: 'Bogus' };",
                })
            ).toEqual([expect.stringContaining(`'"Bogus"' is not assignable to type 'NodeType'`)]);
        },
        COMPILE_TIMEOUT_MS
    );

    it(
        'GraphEdge.type is required',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText:
                        "import type { GraphEdge } from '../src/index';\nexport const edge: GraphEdge = { from: 'a', id: 'a->b#normal#0', to: 'b' };",
                })
            ).toEqual([expect.stringContaining("Property 'type' is missing")]);
        },
        COMPILE_TIMEOUT_MS
    );

    // Control for the two cases above: every synthetic node type and a typed
    // edge compile cleanly, so their errors are the only diagnostics.
    it(
        'synthetic node types and a typed edge compile cleanly (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: [
                        "import type { GraphEdge, NodeType, StateNode } from '../src/index';",
                        'export const nodes: StateNode[] = [',
                        "    { id: 'a', label: 'a', type: 'Task' },",
                        "    { id: 'b', label: 'b', type: 'BranchEnd' },",
                        "    { id: 'c', label: 'c', type: 'IteratorEnd' },",
                        "    { id: 'd', label: 'd', type: 'ItemReader' },",
                        "    { id: 'e', label: 'e', type: 'ResultWriter' },",
                        '];',
                        "export const kind: NodeType = 'Map';",
                        "export const edge: GraphEdge = { from: 'a', id: 'a->b#normal#0', to: 'b', type: 'normal' };",
                    ].join('\n'),
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it.each(['distributed-map', 'parallel', 'map'])('every edge parsed from %s has a type', (fixture) => {
        const { edges } = parseAsl({ definition: loadFixture(fixture) });

        expect(edges.filter((edge) => edge.type === undefined)).toEqual([]);
    });

    it.each(['distributed-map', 'parallel', 'map'])('every node parsed from %s has a NodeType', (fixture) => {
        const { nodes } = parseAsl({ definition: loadFixture(fixture) });

        expect(nodes.filter((node) => !NODE_TYPES.has(node.type))).toEqual([]);
    });

    it('the fixtures cover every synthetic node type', () => {
        const seen = new Set(
            ['distributed-map', 'parallel', 'map'].flatMap((fixture) =>
                parseAsl({ definition: loadFixture(fixture) }).nodes.map((node) => node.type)
            )
        );

        expect([...seen].filter((type) => ['BranchEnd', 'IteratorEnd', 'ItemReader', 'ResultWriter'].includes(type)).sort()).toEqual([
            'BranchEnd',
            'ItemReader',
            'IteratorEnd',
            'ResultWriter',
        ]);
    });
});
