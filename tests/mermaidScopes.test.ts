import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { computeStateDiff } from '../src/diff';
import { buildMermaidScopes } from '../src/renderers/mermaidScopes';
import type { AslDefinition } from '../src/types';

const loadFixture = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'));

const scopesOf = (definition: AslDefinition) => {
    const { edges, nodes } = parseAsl({ definition });
    return buildMermaidScopes({ edges, nodes });
};

describe('buildMermaidScopes', () => {
    it('splits a Parallel into one region per branch and leaves the rest at root', () => {
        const scopes = scopesOf(loadFixture('parallel'));
        const regions = scopes.regionsByContainer.get('ParallelExecution');

        expect(regions?.map((region) => region.entryId)).toEqual(['Branch1', 'Branch2']);
        expect(regions?.map((region) => region.memberIds)).toEqual([['Branch1'], ['Branch2']]);
        expect(scopes.root.memberIds).toEqual(['ParallelExecution', 'FinalState']);
        expect(scopes.nodes.some((node) => node.id.includes('__end'))).toBe(false);
    });

    it('gives a Map exactly one region', () => {
        const regions = scopesOf(loadFixture('map')).regionsByContainer.get('ProcessItems');

        expect(regions).toHaveLength(1);
    });

    it('ignores container children that were removed from the graph', () => {
        const { edges, nodes } = parseAsl({ definition: loadFixture('parallel') });
        const pruned = nodes.filter((node) => node.id !== 'Branch2');
        const scopes = buildMermaidScopes({ edges, nodes: pruned });
        const memberIds = scopes.regionsByContainer.get('ParallelExecution')?.flatMap((region) => region.memberIds);

        expect(memberIds).toEqual(['Branch1']);
    });

    it('keeps a branch state that is unreachable from StartAt in its own branch', () => {
        const before = loadFixture('diff-nested-before');
        const after = loadFixture('diff-nested-after');
        const scopes = scopesOf(computeStateDiff(before, after).mergedAsl);
        const regions = scopes.regionsByContainer.get('FanOut');

        expect(regions?.[0].memberIds).toContain('Archive');
        expect(regions?.[1].memberIds).toEqual(['Notify']);
    });
});
