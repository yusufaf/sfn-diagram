import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');
const SNIPPET_FILE = join(repoRoot, 'tests', '__layoutEngineTypes.snippet.ts');

// The dist case reads the bundled declarations, where a comment on a re-export
// would be dropped. `pnpm run build` first, or it is skipped.
const hasBuild = existsSync(join(repoRoot, 'dist/index.d.ts'));

const ENGINE_TYPE_NAMES = [
    'LayoutEngineEdge',
    'LayoutEngineEdgeRoute',
    'LayoutEngineInput',
    'LayoutEngineNode',
    'LayoutEngineNodeBox',
    'LayoutEngineOutput',
    'LayoutEnginePadding',
];

/**
 * Maps each `LayoutEngine*` interface in `text` to whether the JSDoc block directly
 * above it carries `@experimental`. The block body stops at the first `*\/`, so an
 * interface can't borrow an earlier block's tag; `export ` is optional because the
 * bundled `.d.ts` declares `interface X {` and exports through a trailing list.
 *
 * @param text - TypeScript source or declaration text.
 * @returns Interface name to tag presence; an interface with no JSDoc directly above it is absent.
 * @example
 * experimentalTagsIn('/** @experimental *\/\ninterface LayoutEngineInput {}'); // Map { 'LayoutEngineInput' => true }
 */
function experimentalTagsIn(text: string): Map<string, boolean> {
    const tags = new Map<string, boolean>();
    for (const match of text.matchAll(/\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*(?:export )?interface (LayoutEngine\w*)/g)) {
        const [, doc = '', name = ''] = match;
        tags.set(name, doc.includes('@experimental'));
    }
    return tags;
}

describe('layout engine types (2.0, experimental)', () => {
    it(
        'every engine type is exported from the root and accepts a full literal (control)',
        () => {
            expect(
                typeErrorsIn({
                    fileName: SNIPPET_FILE,
                    sourceText: [
                        'import type {',
                        '    LayoutEngineEdge,',
                        '    LayoutEngineEdgeRoute,',
                        '    LayoutEngineInput,',
                        '    LayoutEngineNode,',
                        '    LayoutEngineNodeBox,',
                        '    LayoutEngineOutput,',
                        '    LayoutEnginePadding,',
                        "} from '../src/index';",
                        'export const padding: LayoutEnginePadding = { bottom: 10, left: 10, right: 10, top: 30 };',
                        "export const leaf: LayoutEngineNode = { height: 60, id: 'Work', shape: 'rect', width: 120 };",
                        "export const container: LayoutEngineNode = { children: ['Work'], height: 100, id: 'Fan', padding, shape: 'rect', width: 160 };",
                        "export const edge: LayoutEngineEdge = { from: 'Fan', id: 'Fan->Done#normal#0', labelSize: { height: 14, width: 40 }, to: 'Done', type: 'normal' };",
                        'export const input: LayoutEngineInput = {',
                        "    direction: 'TB',",
                        '    edges: [edge],',
                        '    nodeSeparation: 50,',
                        '    nodes: [leaf, container],',
                        '    padding: 20,',
                        '    rankSeparation: 50,',
                        '};',
                        "export const box: LayoutEngineNodeBox = { height: 60, id: 'Work', width: 120, x: 80, y: 50 };",
                        "export const route: LayoutEngineEdgeRoute = { id: 'Fan->Done#normal#0', labelPosition: { x: 1, y: 2 }, points: [{ x: 0, y: 0 }] };",
                        'export const output: LayoutEngineOutput = { edges: [route], nodes: [box] };',
                    ].join('\n'),
                })
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS
    );

    it(
        'render-only fields are not part of the engine contract',
        () => {
            const errors = typeErrorsIn({
                fileName: SNIPPET_FILE,
                sourceText: [
                    "import type { LayoutEngineEdge, LayoutEngineNode } from '../src/index';",
                    "export const styled: LayoutEngineNode = { height: 60, id: 'a', shape: 'rect', style: { fill: 'x', shape: 'rect', stroke: 'x', strokeWidth: 1 }, width: 120 };",
                    "export const iconed: LayoutEngineNode = { height: 60, iconUrl: 'x', id: 'a', shape: 'rect', width: 120 };",
                    "export const labelled: LayoutEngineNode = { height: 60, id: 'a', label: 'x', shape: 'rect', width: 120 };",
                    "export const typed: LayoutEngineNode = { height: 60, id: 'a', shape: 'rect', type: 'Task', width: 120 };",
                    "export const labelledEdge: LayoutEngineEdge = { from: 'a', id: 'a->b#normal#0', label: 'x', to: 'b', type: 'normal' };",
                ].join('\n'),
            });

            expect(errors).toHaveLength(5);
            for (const error of errors) {
                expect(error).toContain('Object literal may only specify known properties');
            }
        },
        COMPILE_TIMEOUT_MS
    );

    it('every engine type is marked @experimental in src', () => {
        const tags = experimentalTagsIn(readFileSync(join(repoRoot, 'src/layout/engine.ts'), 'utf8'));

        expect([...tags.keys()].sort()).toEqual(ENGINE_TYPE_NAMES);
        expect([...tags.values()].every(Boolean)).toBe(true);
    });

    describe.skipIf(!hasBuild)('in the published declarations', () => {
        it('every engine type is marked @experimental in dist/index.d.ts', () => {
            const tags = experimentalTagsIn(readFileSync(join(repoRoot, 'dist/index.d.ts'), 'utf8'));

            expect([...tags.keys()].sort()).toEqual(ENGINE_TYPE_NAMES);
            expect([...tags.values()].every(Boolean)).toBe(true);
        });
    });
});
