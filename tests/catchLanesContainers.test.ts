import { describe, expect, it, vi } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import { catchersInsideMap, isLaneRoute } from './helpers/catchLaneFixtures';

// With collision checks off, the fallback cannot hide a catcher that was wrongly bundled.
vi.mock('../src/layout/catchLanes', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/layout/catchLanes')>()),
    findLaneCollisions: () => false,
}));

describe('catch lanes and open containers', () => {
    it.each(['TB', 'LR'] as const)('never bundles catchers that sit inside a Map iterator (%s)', (layout) => {
        const { nodes, edges } = parseAsl({ definition: catchersInsideMap() });
        const result = new DagreLayout({ layout }).calculate(nodes, edges);
        const errors = result.edges.filter((edge) => edge.type === 'error');
        expect(errors).toHaveLength(4);
        for (const edge of errors) {
            expect(isLaneRoute({ edge, layout, nodes: result.nodes })).toBe(false);
        }
    });
});
