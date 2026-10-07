import { describe, expect, it } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { generateMermaid, generateSvg } from '../src/index';
import type { AslDefinition } from '../src/types';

const parallelWithFail = {
    StartAt: 'P',
    States: {
        Done: { Type: 'Succeed' },
        P: {
            Branches: [
                { StartAt: 'F', States: { F: { Type: 'Fail' } } },
                { StartAt: 'T', States: { T: { End: true, Type: 'Pass' } } },
            ],
            Next: 'Done',
            Type: 'Parallel',
        },
    },
} as unknown as AslDefinition;

const parallelAllFail = {
    StartAt: 'P',
    States: {
        Done: { Type: 'Succeed' },
        P: {
            Branches: [
                { StartAt: 'F1', States: { F1: { Type: 'Fail' } } },
                { StartAt: 'F2', States: { F2: { Type: 'Fail' } } },
            ],
            Next: 'Done',
            Type: 'Parallel',
        },
    },
} as unknown as AslDefinition;

const parallelPartlyFail = {
    StartAt: 'P',
    States: {
        Done: { Type: 'Succeed' },
        P: {
            Branches: [
                { StartAt: 'F1', States: { F1: { Type: 'Fail' } } },
                {
                    StartAt: 'Check',
                    States: {
                        Check: {
                            Choices: [{ BooleanEquals: true, Next: 'Reject', Variable: '$.x' }],
                            Default: 'Ok',
                            Type: 'Choice',
                        },
                        Ok: { Type: 'Succeed' },
                        Reject: { Type: 'Fail' },
                    },
                },
            ],
            Next: 'Done',
            Type: 'Parallel',
        },
    },
} as unknown as AslDefinition;

const mapWithFail = {
    StartAt: 'M',
    States: {
        Done: { Type: 'Succeed' },
        M: {
            ItemProcessor: {
                StartAt: 'Check',
                States: {
                    Check: {
                        Choices: [{ BooleanEquals: true, Next: 'Reject', Variable: '$.x' }],
                        Default: 'Ok',
                        Type: 'Choice',
                    },
                    Ok: { Type: 'Succeed' },
                    Reject: { Type: 'Fail' },
                },
            },
            Next: 'Done',
            Type: 'Map',
        },
    },
} as unknown as AslDefinition;

const mapAllFail = {
    StartAt: 'M',
    States: {
        Done: { Type: 'Succeed' },
        M: {
            ItemProcessor: { StartAt: 'F', States: { F: { Type: 'Fail' } } },
            Next: 'Done',
            Type: 'Map',
        },
    },
} as unknown as AslDefinition;

const hasEdge = (edges: { from: string; to: string }[], from: string, to: string) =>
    edges.some((edge) => edge.from === from && edge.to === to);

describe('a Fail state inside a Parallel branch or Map processor', () => {
    describe('parser', () => {
        it('does not connect a Parallel branch Fail to the branch end marker', () => {
            const { edges } = parseAsl({ definition: parallelWithFail });

            expect(hasEdge(edges, 'F', 'P__branch0__end')).toBe(false);
            expect(hasEdge(edges, 'T', 'P__branch1__end')).toBe(true);
        });

        it('keeps a Parallel branch Succeed connected to its end marker', () => {
            const { edges } = parseAsl({ definition: parallelPartlyFail });

            expect(hasEdge(edges, 'Ok', 'P__branch1__end')).toBe(true);
            expect(hasEdge(edges, 'Reject', 'P__branch1__end')).toBe(false);
        });

        it('does not connect a Map processor Fail to the iterator end marker', () => {
            const { edges } = parseAsl({ definition: mapWithFail });

            expect(hasEdge(edges, 'Reject', 'M__iterator__end')).toBe(false);
            expect(hasEdge(edges, 'Ok', 'M__iterator__end')).toBe(true);
        });

        it('creates no end marker for a branch that can only fail', () => {
            const { edges, nodes } = parseAsl({ definition: parallelPartlyFail });

            expect(nodes.some((node) => node.id === 'P__branch0__end')).toBe(false);
            expect(hasEdge(edges, 'P__branch0__end', 'Done')).toBe(false);
            expect(hasEdge(edges, 'P__branch1__end', 'Done')).toBe(true);
            expect(nodes.find((node) => node.id === 'P')?.children).not.toContain(
                'P__branch0__end'
            );
        });

        it('keeps the end marker for a branch ending in a nested container with End: true', () => {
            const definition = {
                StartAt: 'P',
                States: {
                    Done: { Type: 'Succeed' },
                    P: {
                        Branches: [
                            { StartAt: 'F', States: { F: { Type: 'Fail' } } },
                            {
                                StartAt: 'Inner',
                                States: {
                                    Inner: {
                                        Branches: [
                                            { StartAt: 'X', States: { X: { End: true, Type: 'Pass' } } },
                                        ],
                                        End: true,
                                        Type: 'Parallel',
                                    },
                                },
                            },
                        ],
                        Next: 'Done',
                        Type: 'Parallel',
                    },
                },
            } as unknown as AslDefinition;

            const { edges } = parseAsl({ definition });

            expect(hasEdge(edges, 'Inner', 'P__branch1__end')).toBe(true);
            expect(hasEdge(edges, 'P__branch1__end', 'Done')).toBe(true);
        });

        it('keeps the end marker for a branch with no terminal state at all', () => {
            const definition = {
                StartAt: 'P',
                States: {
                    Done: { Type: 'Succeed' },
                    P: {
                        Branches: [
                            {
                                StartAt: 'Spin',
                                States: { Spin: { Next: 'Spin', Seconds: 1, Type: 'Wait' } },
                            },
                        ],
                        Next: 'Done',
                        Type: 'Parallel',
                    },
                },
            } as unknown as AslDefinition;

            const { edges, nodes } = parseAsl({ definition });

            expect(nodes.some((node) => node.id === 'P__branch0__end')).toBe(true);
            expect(hasEdge(edges, 'P__branch0__end', 'Done')).toBe(true);
        });

        it('creates no end marker for a Map processor that can only fail', () => {
            const { edges, nodes } = parseAsl({ definition: mapAllFail });

            expect(nodes.some((node) => node.id === 'M__iterator__end')).toBe(false);
            expect(edges.some((edge) => edge.from === 'M__iterator__end')).toBe(false);
        });
    });

    describe('Mermaid', () => {
        it('does not draw a Parallel branch Fail as continuing to Next', () => {
            const { code } = generateMermaid({ aslDefinition: parallelWithFail });

            expect(code).not.toContain('F --> Done');
            expect(code).toContain('F --> [*]');
            expect(code).toContain('T --> Done');
        });

        it('does not draw a Map processor Fail as continuing to Next, but keeps Succeed', () => {
            const { code } = generateMermaid({ aslDefinition: mapWithFail });

            expect(code).not.toContain('Reject --> Done');
            expect(code).toContain('Reject --> [*]');
            expect(code).toContain('Ok --> Done');
        });

        it('draws no continuation at all when every branch can only fail', () => {
            const { code } = generateMermaid({ aslDefinition: parallelAllFail });

            expect(code).not.toContain('__end');
            expect(code).not.toContain('F1 --> Done');
            expect(code).not.toContain('F2 --> Done');
            expect(code).toContain('F1 --> [*]');
            expect(code).toContain('F2 --> [*]');
            // The container keeps its declared Next, and nothing else arrives at Done.
            expect(code.match(/--> Done/g)).toEqual(['--> Done']);
            expect(code).toContain('P --> Done');
        });
    });

    describe('SVG', () => {
        const edgeTitles = (svg: string) =>
            (svg.match(/<title>[^<]*<\/title>/g) ?? []).map((title) =>
                title.replace(/<\/?title>/g, '')
            );

        it('draws no edge out of a Parallel branch Fail', () => {
            const titles = edgeTitles(generateSvg({ aslDefinition: parallelWithFail }).svg);

            expect(titles.filter((title) => title.startsWith('F to '))).toEqual([]);
            expect(titles).toContain('T to P');
        });

        it('draws no edge out of a Map processor Fail but keeps Succeed', () => {
            const titles = edgeTitles(generateSvg({ aslDefinition: mapWithFail }).svg);

            expect(titles.filter((title) => title.startsWith('Reject to '))).toEqual([]);
            expect(titles).toContain('Ok to M');
        });

        it.each([
            ['Parallel', parallelAllFail],
            ['Map', mapAllFail],
        ])('lays out a %s whose branches can only fail without bad coordinates', (_name, definition) => {
            const { svg } = generateSvg({ aslDefinition: definition });

            expect(svg).not.toMatch(/NaN|undefined|Infinity/);
            expect(svg).toContain('Done (Succeed)');
        });

        it('draws no floating end marker for a branch that can only fail', () => {
            const { svg } = generateSvg({ aslDefinition: parallelPartlyFail });

            expect(svg).not.toContain('P__branch0__end');
            expect(svg).toContain('P__branch1__end');
        });
    });
});
