import { describe, expect, it } from 'vitest';
import { buildIdResolver } from '../../src/graph/scopeIds';
import type { AslDefinition } from '../../src/types';

/** A Parallel named `Fanout` whose branches are the given `States` blocks. */
function fanout(...branches: Array<Record<string, unknown>>): AslDefinition {
    return {
        StartAt: 'Fanout',
        States: {
            Fanout: {
                Type: 'Parallel',
                End: true,
                Branches: branches.map((states) => ({
                    StartAt: Object.keys(states)[0],
                    States: states,
                })),
            },
        },
    } as AslDefinition;
}

describe('buildIdResolver', () => {
    it('leaves a name that occurs in one scope alone', () => {
        const definition = fanout({ Alpha: { Type: 'Pass', End: true } });
        const resolver = buildIdResolver({ definition });

        expect(resolver.resolve('', 'Fanout')).toBe('Fanout');
        expect(resolver.resolve(resolver.branchScope('', 'Fanout', 0), 'Alpha')).toBe('Alpha');
    });

    it('qualifies a name that occurs in two branches', () => {
        const definition = fanout(
            { Validate: { Type: 'Pass', End: true } },
            { Validate: { Type: 'Pass', End: true } }
        );
        const resolver = buildIdResolver({ definition });

        const first = resolver.resolve(resolver.branchScope('', 'Fanout', 0), 'Validate');
        const second = resolver.resolve(resolver.branchScope('', 'Fanout', 1), 'Validate');

        expect(first).not.toBe(second);
        expect(first).toBe('Fanout__branch0__Validate');
        expect(second).toBe('Fanout__branch1__Validate');
    });

    it('lets the root occurrence keep the bare name', () => {
        const definition: AslDefinition = {
            StartAt: 'Validate',
            States: {
                Validate: { Type: 'Pass', Next: 'Fanout' },
                Fanout: {
                    Type: 'Parallel',
                    End: true,
                    Branches: [
                        {
                            StartAt: 'Validate',
                            States: { Validate: { Type: 'Pass', End: true } },
                        },
                    ],
                },
            },
        } as AslDefinition;

        const resolver = buildIdResolver({ definition });

        expect(resolver.resolve('', 'Validate')).toBe('Validate');
        expect(resolver.resolve(resolver.branchScope('', 'Fanout', 0), 'Validate')).toBe(
            'Fanout__branch0__Validate'
        );
    });

    it('qualifies every occurrence when none of them is at the root', () => {
        const definition = fanout(
            { Validate: { Type: 'Pass', End: true } },
            { Validate: { Type: 'Pass', End: true } }
        );
        const resolver = buildIdResolver({ definition });

        for (const index of [0, 1]) {
            expect(
                resolver.resolve(resolver.branchScope('', 'Fanout', index), 'Validate')
            ).not.toBe('Validate');
        }
    });

    it('scopes a Map processor as well as Parallel branches', () => {
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

        const resolver = buildIdResolver({ definition });

        expect(resolver.resolve('', 'Handle')).toBe('Handle');
        expect(resolver.resolve(resolver.processorScope('', 'Each'), 'Handle')).toBe(
            'Each__iterator__Handle'
        );
    });

    it('composes scopes through three levels of nesting', () => {
        const inner = {
            StartAt: 'Work',
            States: { Work: { Type: 'Pass', End: true } },
        };
        const definition: AslDefinition = {
            StartAt: 'Work',
            States: {
                Work: { Type: 'Pass', Next: 'Fanout' },
                Fanout: {
                    Type: 'Parallel',
                    End: true,
                    Branches: [
                        {
                            StartAt: 'Each',
                            States: {
                                Each: { Type: 'Map', End: true, ItemProcessor: inner },
                            },
                        },
                    ],
                },
            },
        } as AslDefinition;

        const resolver = buildIdResolver({ definition });
        const branch = resolver.branchScope('', 'Fanout', 0);
        const processor = resolver.processorScope(branch, 'Each');

        expect(resolver.resolve('', 'Work')).toBe('Work');
        // A scope path is built from *resolved* container ids, so it only carries as
        // much path as it needs: `Each` occurs once and keeps its bare id, which keeps
        // the qualified id short instead of restating every level above it.
        expect(resolver.resolve(processor, 'Work')).toBe('Each__iterator__Work');
        expect(resolver.resolve(branch, 'Each')).toBe('Each');
    });

    it('does not let a state named "end" take its own branch end marker id', () => {
        // The marker for branch 0 of `Fanout` is `Fanout__branch0__end`, which is
        // exactly the id a colliding state named `end` in that branch would want.
        const definition = fanout(
            { end: { Type: 'Pass', End: true } },
            { end: { Type: 'Pass', End: true } }
        );

        const resolver = buildIdResolver({ definition });
        const first = resolver.resolve(resolver.branchScope('', 'Fanout', 0), 'end');

        expect(first).not.toBe('Fanout__branch0__end');
        expect(first.startsWith('Fanout__branch0__end')).toBe(true);
    });

    it('keeps every assigned id distinct across a definition full of repeats', () => {
        const branchStates = {
            Validate: { Type: 'Pass', Next: 'Work' },
            Work: { Type: 'Pass', End: true },
        };
        const definition = fanout(branchStates, branchStates, branchStates);

        const resolver = buildIdResolver({ definition });
        const ids = [0, 1, 2].flatMap((index) => {
            const scope = resolver.branchScope('', 'Fanout', index);
            return [resolver.resolve(scope, 'Validate'), resolver.resolve(scope, 'Work')];
        });

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('returns the bare name for a target that does not exist', () => {
        const resolver = buildIdResolver({
            definition: {
                StartAt: 'Work',
                States: { Work: { Type: 'Pass', End: true } },
            } as AslDefinition,
        });

        expect(resolver.resolve('', 'Nowhere')).toBe('Nowhere');
    });
});
