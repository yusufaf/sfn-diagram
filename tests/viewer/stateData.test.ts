import { describe, it, expect } from 'vitest';
import { collectStateData, serializeStateData } from '../../src/renderers/viewer';
import type { AslDefinition } from '../../src/types';

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('collectStateData', () => {
    it('collects every top-level state keyed by name', () => {
        const definition: AslDefinition = {
            StartAt: 'First',
            States: {
                First: { Type: 'Pass', Next: 'Second' },
                Second: { Type: 'Succeed' },
            },
        };

        const stateData = collectStateData({ definition });

        expect(Object.keys(stateData).sort()).toEqual(['First', 'Second']);
        expect(stateData.First).toEqual({ Type: 'Pass', Next: 'Second' });
    });

    it('recurses into Parallel branches', () => {
        const definition: AslDefinition = {
            StartAt: 'Fork',
            States: {
                Fork: {
                    Type: 'Parallel',
                    End: true,
                    Branches: [
                        { StartAt: 'BranchA', States: { BranchA: { Type: 'Pass', End: true } } },
                        { StartAt: 'BranchB', States: { BranchB: { Type: 'Pass', End: true } } },
                    ],
                },
            },
        };

        const stateData = collectStateData({ definition });

        expect(Object.keys(stateData).sort()).toEqual(['BranchA', 'BranchB', 'Fork']);
    });

    it('recurses into a Map ItemProcessor and the legacy Iterator alike', () => {
        const modern: AslDefinition = {
            StartAt: 'Loop',
            States: {
                Loop: {
                    Type: 'Map',
                    End: true,
                    ItemProcessor: {
                        StartAt: 'Inner',
                        States: { Inner: { Type: 'Pass', End: true } },
                    },
                },
            },
        };
        const legacy: AslDefinition = {
            StartAt: 'Loop',
            States: {
                Loop: {
                    Type: 'Map',
                    End: true,
                    Iterator: {
                        StartAt: 'Inner',
                        States: { Inner: { Type: 'Pass', End: true } },
                    },
                },
            },
        };

        expect(collectStateData({ definition: modern })).toHaveProperty('Inner');
        expect(collectStateData({ definition: legacy })).toHaveProperty('Inner');
    });
});

describe('serializeStateData', () => {
    it('round-trips through JSON.parse', () => {
        const stateData = { Task: { Type: 'Task' as const, Resource: 'arn:aws:lambda:::x' } };

        expect(JSON.parse(serializeStateData({ stateData }))).toEqual(stateData);
    });

    it('escapes angle brackets so a state cannot terminate the script element', () => {
        const stateData = {
            Sneaky: { Type: 'Pass' as const, Comment: '</script><img src=x onerror=alert(1)>' },
        };

        const serialized = serializeStateData({ stateData });

        expect(serialized).not.toContain('</script>');
        expect(serialized).not.toContain('<');
        expect(serialized).not.toContain('>');
        // Escaping must be lossless - the value survives a parse unchanged.
        expect(JSON.parse(serialized).Sneaky.Comment).toBe('</script><img src=x onerror=alert(1)>');
    });

    it('escapes U+2028, which is legal in JSON but not in a JS string literal', () => {
        const stateData = { Odd: { Type: 'Pass' as const, Comment: `a${LINE_SEPARATOR}b` } };

        const serialized = serializeStateData({ stateData });

        expect(serialized).not.toContain(LINE_SEPARATOR);
        expect(serialized).toContain('\\u2028');
        expect(JSON.parse(serialized).Odd.Comment).toBe(`a${LINE_SEPARATOR}b`);
    });
});
