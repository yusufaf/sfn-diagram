import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAsl } from '../src/AslParser';
import { DagreLayout } from '../src/layout';
import type { CatchLaneRoute } from '../src/layout/catchLanes';
import type { AslDefinition } from '../src/types';
import { isLaneRoute, parallelInChain, roundRobinHandlers } from './helpers/catchLaneFixtures';

const collisions = vi.hoisted(() => ({
    pick: (routes: Map<string, CatchLaneRoute>): Set<string> => new Set(routes.keys()),
    selections: 0,
}));

vi.mock('../src/layout/catchLanes', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/layout/catchLanes')>();
    return {
        ...original,
        findLaneCollisions: (params: { routes: Map<string, CatchLaneRoute> }) => collisions.pick(params.routes),
        selectLaneCatchEdges: (params: Parameters<typeof original.selectLaneCatchEdges>[0]) => {
            collisions.selections += 1;
            return original.selectLaneCatchEdges(params);
        },
    };
});

const layoutErrors = (definition: AslDefinition = parallelInChain()) => {
    const { nodes, edges } = parseAsl({ definition });
    const result = new DagreLayout({ layout: 'TB' }).calculate(nodes, edges);
    const errors = result.edges.filter((edge) => edge.type === 'error');
    return {
        errors,
        lanes: errors.filter((edge) => isLaneRoute({ edge, layout: 'TB', nodes: result.nodes })),
    };
};

/**
 * roundRobinHandlers with a Parallel after the chain, so the layout has a container and
 * the collision check runs.
 */
const roundRobinWithParallel = (handlers: number): AslDefinition => {
    const definition = roundRobinHandlers(8 * handlers, handlers);
    definition.States[`Step${8 * handlers - 1}`].Next = 'Par';
    definition.States.Par = {
        Type: 'Parallel',
        Branches: [{ StartAt: 'P1', States: { P1: { Type: 'Pass', End: true } } }],
        Next: 'Done',
    };
    return definition;
};

/** Collide on the first route into any of `handlers`, every pass. */
const collideFirstInto = (handlers: string[]) => (routes: Map<string, CatchLaneRoute>) =>
    new Set([...routes.keys()].filter((id) => handlers.some((handler) => id.includes(`->${handler}#`))).slice(0, 1));

describe('catch lane fallback', () => {
    beforeEach(() => {
        collisions.pick = (routes) => new Set(routes.keys());
        collisions.selections = 0;
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

    it('chooses lane edges once, however many passes run', () => {
        collisions.pick = collideFirstInto(['Failed0']);
        layoutErrors(roundRobinWithParallel(3));
        expect(collisions.selections).toBe(1);
    });

    it('hands back the whole handler once single edges keep colliding, and keeps other handlers', () => {
        const seen: number[] = [];
        const pick = collideFirstInto(['Failed0']);
        collisions.pick = (routes) => {
            seen.push(routes.size);
            return pick(routes);
        };
        const { lanes } = layoutErrors(roundRobinWithParallel(3));
        // The first pass hands back one Failed0 edge, the second all of Failed0's, and the
        // third finds no collision.
        expect(seen).toHaveLength(3);
        expect(lanes.some((edge) => edge.to === 'Failed0')).toBe(false);
        expect(lanes.some((edge) => edge.to === 'Failed1')).toBe(true);
        expect(lanes.some((edge) => edge.to === 'Failed2')).toBe(true);
    });

    it('drops lanes altogether when collisions outlast every pass', () => {
        const seen: number[] = [];
        const pick = collideFirstInto(['Failed0', 'Failed1']);
        collisions.pick = (routes) => {
            seen.push(routes.size);
            return pick(routes);
        };
        // Failed2 never collides, but the third and last lane pass still collides (on
        // Failed1), so Failed2 loses its lane too.
        const { lanes } = layoutErrors(roundRobinWithParallel(3));
        expect(seen).toHaveLength(3);
        expect(lanes).toHaveLength(0);
    });
});
