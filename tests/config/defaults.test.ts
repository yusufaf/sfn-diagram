import { describe, it, expect } from 'vitest';
import {
    DEFAULT_DIAGRAM_OPTIONS,
    mergeOptions,
    mergeRecordOptions,
} from '../../src/config';
import type { DiagramOptions } from '../../src/types';

describe('mergeOptions', () => {
    const optionKeys = Object.keys(
        DEFAULT_DIAGRAM_OPTIONS,
    ) as (keyof typeof DEFAULT_DIAGRAM_OPTIONS)[];

    it.each(optionKeys)(
        'falls back to the default when %s is explicitly undefined',
        (key) => {
            const merged = mergeOptions({ [key]: undefined } as DiagramOptions);

            expect(merged[key]).toEqual(DEFAULT_DIAGRAM_OPTIONS[key]);
        },
    );

    it('keeps defined falsy values over the defaults', () => {
        const merged = mergeOptions({
            includeComments: false,
            padding: 0,
            showVariables: false,
        });

        expect(merged.includeComments).toBe(false);
        expect(merged.padding).toBe(0);
        expect(merged.showVariables).toBe(false);
    });

    it('keeps a defined value next to undefined ones', () => {
        const merged = mergeOptions({
            edgeStyle: 'straight',
            layout: undefined,
        });

        expect(merged.edgeStyle).toBe('straight');
        expect(merged.layout).toBe(DEFAULT_DIAGRAM_OPTIONS.layout);
    });

    it('does not mutate DEFAULT_DIAGRAM_OPTIONS', () => {
        const before = { ...DEFAULT_DIAGRAM_OPTIONS };

        mergeOptions({ edgeStyle: 'straight' });

        expect(DEFAULT_DIAGRAM_OPTIONS).toEqual(before);
    });
});

describe('mergeRecordOptions', () => {
    it('returns undefined when both base and override are undefined', () => {
        expect(mergeRecordOptions(undefined, undefined)).toBeUndefined();
    });

    it('returns the base record when override is undefined', () => {
        const base = { A: 1 };

        expect(mergeRecordOptions(base, undefined)).toEqual({ A: 1 });
    });

    it('returns the override record when base is undefined', () => {
        const override = { B: 2 };

        expect(mergeRecordOptions(undefined, override)).toEqual({ B: 2 });
    });

    it('merges keys present in only one side and lets override win on shared keys', () => {
        const base = { A: 1, C: 3 };
        const override = { A: 10, B: 2 };

        expect(mergeRecordOptions(base, override)).toEqual({
            A: 10,
            B: 2,
            C: 3,
        });
    });
});
