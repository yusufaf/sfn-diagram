import { describe, it, expect } from 'vitest';
import { assignEdgeIds } from '../../src/graph';
import type { RawEdge } from '../../src/graph';

describe('assignEdgeIds', () => {
    it('gives edges sharing from/to/type distinct ordinals', () => {
        const edges: RawEdge[] = [
            { from: 'Route', label: 'x > 5', to: 'Work', type: 'choice' },
            { from: 'Route', label: 'x < 0', to: 'Work', type: 'choice' },
        ];

        const result = assignEdgeIds({ edges });

        expect(result.map((edge) => edge.id)).toEqual([
            'Route->Work#choice#0',
            'Route->Work#choice#1',
        ]);
    });

    it('counts ordinals per (from, to, type) rather than globally', () => {
        const edges: RawEdge[] = [
            { from: 'Work', to: 'Work', type: 'normal' },
            { from: 'Work', to: 'Work', type: 'retry', visualOnly: true },
            { from: 'Work', to: 'Work', type: 'error' },
        ];

        const result = assignEdgeIds({ edges });

        expect(result.map((edge) => edge.id)).toEqual([
            'Work->Work#normal#0',
            'Work->Work#retry#0',
            'Work->Work#error#0',
        ]);
    });

    it('normalizes a missing type to "normal" so it shares a counter', () => {
        const edges: RawEdge[] = [
            { from: 'Start', to: 'Work' },
            { from: 'Start', to: 'Work', type: 'normal' },
        ];

        const result = assignEdgeIds({ edges });

        expect(result.map((edge) => edge.id)).toEqual([
            'Start->Work#normal#0',
            'Start->Work#normal#1',
        ]);
    });

    it('preserves every other field and input order', () => {
        const edges: RawEdge[] = [
            { condition: 'x > 5', from: 'Route', label: 'x > 5', to: 'Work', type: 'choice' },
        ];

        const [edge] = assignEdgeIds({ edges });

        expect(edge).toEqual({
            condition: 'x > 5',
            from: 'Route',
            id: 'Route->Work#choice#0',
            label: 'x > 5',
            to: 'Work',
            type: 'choice',
        });
    });
});
