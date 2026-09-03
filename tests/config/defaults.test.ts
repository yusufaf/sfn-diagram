import { describe, it, expect } from 'vitest';
import { mergeRecordOptions } from '../../src/config';

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

        expect(mergeRecordOptions(base, override)).toEqual({ A: 10, B: 2, C: 3 });
    });
});
