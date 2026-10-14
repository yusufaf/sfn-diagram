import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import type { CatchLaneRoute } from '../src/layout/catchLanes';
import { isLaneRoute, parallelInChain } from './helpers/catchLaneFixtures';

const collisions = vi.hoisted(() => ({
    pick: (routes: Map<string, CatchLaneRoute>): Set<string> => new Set(routes.keys()),
}));

vi.mock('../src/layout/catchLanes', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/layout/catchLanes')>()),
    findLaneCollisions: (params: { routes: Map<string, CatchLaneRoute> }) => collisions.pick(params.routes),
}));

const layoutErrors = () => {
    const { nodes, edges } = parseAsl({ definition: parallelInChain() });
    const result = new DagreLayout({ layout: 'TB' }).calculate(nodes, edges);
    const errors = result.edges.filter((edge) => edge.type === 'error');
    return {
        errors,
        lanes: errors.filter((edge) => isLaneRoute({ edge, layout: 'TB', nodes: result.nodes })),
    };
};

describe('catch lane fallback', () => {
    beforeEach(() => {
        collisions.pick = (routes) => new Set(routes.keys());
    });

    it('hands every colliding catch edge back to dagre', () => {
        const { errors, lanes } = layoutErrors();
        expect(errors).toHaveLength(5);
        expect(lanes).toHaveLength(0);
        for (const edge of errors) {
            expect((edge.points ?? []).length).toBeGreaterThanOrEqual(2);
        }
    });

    it('keeps lanes for the edges that do not collide', () => {
        let rejected: string | undefined;
        collisions.pick = (routes) => {
            rejected ??= [...routes.keys()][0];
            return new Set(routes.has(rejected) ? [rejected] : []);
        };
        const { lanes } = layoutErrors();
        expect(rejected).toBeDefined();
        expect(lanes.length).toBeGreaterThan(0);
        expect(lanes.map((edge) => edge.id)).not.toContain(rejected);
    });

    it('drops lanes altogether when collisions keep coming', () => {
        const seen: number[] = [];
        collisions.pick = (routes) => {
            seen.push(routes.size);
            return new Set([...routes.keys()].slice(0, 1));
        };
        const { lanes } = layoutErrors();
        expect(seen).toHaveLength(3);
        expect(seen[2]).toBeGreaterThan(0);
        expect(lanes).toHaveLength(0);
    });
});
