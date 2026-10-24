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

    // Node ids replace characters XML forbids with U+FFFD, so a map keyed by the raw
    // ASL name has to be rekeyed the same way to keep finding its node.
    it('rekeys id-keyed maps the way node ids are built', () => {
        const raw = `Fail${String.fromCharCode(0x07)}`;
        const id = `Fail${String.fromCharCode(0xfffd)}`;
        const style = { fill: '#abcdef' };

        const merged = mergeOptions({
            edgeOverrides: { [`${raw}->Done`]: { stroke: '#123456' } },
            nodeAnnotations: { [raw]: 'note' },
            nodeOverrides: { [raw]: style },
        });

        expect(merged.nodeOverrides).toEqual({ [id]: style });
        expect(merged.nodeAnnotations).toEqual({ [id]: 'note' });
        expect(merged.edgeOverrides).toEqual({ [`${id}->Done`]: { stroke: '#123456' } });
    });

    it('returns an id-keyed map as given when no key needs rekeying', () => {
        const nodeOverrides = { Validate: { fill: '#abcdef' } };
        expect(mergeOptions({ nodeOverrides }).nodeOverrides).toBe(nodeOverrides);
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
