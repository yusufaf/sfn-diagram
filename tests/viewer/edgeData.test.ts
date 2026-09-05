import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectEdgeData, serializeEdgeData } from '../../src/renderers/viewer';
import { parseAsl } from '../../src/AslParser';
import type { AslDefinition } from '../../src/types';

const LINE_SEPARATOR = String.fromCharCode(0x2028);

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, '..', 'fixtures', `${name}.asl.json`), 'utf8'),
    ) as AslDefinition;
}

describe('collectEdgeData', () => {
    it('keys every edge by the id the renderer stamps as data-edge-id', () => {
        const definition = loadFixture('choice');

        const edgeData = collectEdgeData({ definition });
        const { edges } = parseAsl({ definition });

        expect(Object.keys(edgeData).sort()).toEqual(edges.map((edge) => edge.id).sort());
    });

    it('carries the Choice condition that produced a choice edge', () => {
        const edgeData = collectEdgeData({ definition: loadFixture('choice') });

        expect(edgeData['CheckValue->HighValue#choice#0']).toEqual({
            condition: '$.value > 10',
            from: 'CheckValue',
            label: '$.value > 10',
            to: 'HighValue',
            type: 'choice',
        });
    });

    it('normalizes an untyped edge to "normal"', () => {
        const definition: AslDefinition = {
            StartAt: 'First',
            States: { First: { Type: 'Pass', Next: 'Second' }, Second: { Type: 'Succeed' } },
        };

        const edgeData = collectEdgeData({ definition });

        expect(Object.values(edgeData).every((edge) => edge.type !== undefined)).toBe(true);
        expect(edgeData['First->Second#normal#0'].type).toBe('normal');
    });

    it('omits condition and label rather than emitting undefined for them', () => {
        const edgeData = collectEdgeData({ definition: loadFixture('choice') });

        expect(edgeData['HighValue->Done#normal#0']).toEqual({
            from: 'HighValue',
            to: 'Done',
            type: 'normal',
        });
    });

    it('distinguishes two Choice rules that share a Next', () => {
        const edgeData = collectEdgeData({ definition: loadFixture('parallel-edges') });

        expect(edgeData['Route->Work#choice#0']).toBeDefined();
        expect(edgeData['Route->Work#choice#1']).toBeDefined();
        expect(edgeData['Route->Work#choice#0'].condition).not.toBe(
            edgeData['Route->Work#choice#1'].condition,
        );
    });

    it('covers edges inside Parallel branches', () => {
        const definition: AslDefinition = {
            StartAt: 'Fork',
            States: {
                Fork: {
                    Type: 'Parallel',
                    End: true,
                    Branches: [
                        {
                            StartAt: 'BranchA',
                            States: {
                                BranchA: { Type: 'Pass', Next: 'BranchAEnd' },
                                BranchAEnd: { Type: 'Succeed' },
                            },
                        },
                    ],
                },
            },
        };

        const edgeData = collectEdgeData({ definition });

        expect(edgeData['BranchA->BranchAEnd#normal#0']).toEqual({
            from: 'BranchA',
            to: 'BranchAEnd',
            type: 'normal',
        });
    });
});

describe('serializeEdgeData', () => {
    it('escapes characters that would break out of an inline script block', () => {
        const edgeData = {
            'A->B#choice#0': {
                condition: `$.x < 1 && $.y > 2${LINE_SEPARATOR}`,
                from: 'A',
                to: 'B',
                type: 'choice' as const,
            },
        };

        const json = serializeEdgeData({ edgeData });

        expect(json).not.toContain('<');
        expect(json).not.toContain('>');
        expect(json).not.toContain(LINE_SEPARATOR);
        expect(JSON.parse(json)).toEqual(edgeData);
    });
});
