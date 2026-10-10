import { describe, expect, it, vi } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { isLaneRoute, parallelInChain } from './helpers/catchLaneFixtures';

vi.mock('../src/layout/catchLanes', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/layout/catchLanes')>()),
    findLaneCollisions: () => true,
}));

describe('catch lane fallback', () => {
    it('falls back to the plain dagre layout when a lane would cross a container', () => {
        const { nodes, edges } = parseAsl({ definition: parallelInChain() });
        const result = new DagreLayout({ layout: 'TB' }).calculate(nodes, edges);
        const errors = result.edges.filter((edge) => edge.type === 'error');
        expect(errors).toHaveLength(5);
        for (const edge of errors) {
            expect(isLaneRoute({ edge, layout: 'TB', nodes: result.nodes })).toBe(false);
            expect((edge.points ?? []).length).toBeGreaterThanOrEqual(2);
        }
    });
});
