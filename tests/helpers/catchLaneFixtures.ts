import type { AslDefinition, AslState, LayoutDirection, StateNode } from '../../src/types';
import type { LayoutResult } from '../../src/layout/DagreLayout';

const RESOURCE = 'arn:aws:lambda:us-east-1:123456789012:function:Worker';

type CatchState = Pick<AslState, 'Catch'>;

const catchAllInto = (target: string): CatchState => ({
    Catch: [{ ErrorEquals: ['States.ALL'], Next: target }],
});

interface TaskParams {
    catchInto?: string;
    next?: string;
}

const task = (params: TaskParams): AslState => ({
    Type: 'Task',
    Resource: RESOURCE,
    ...(params.next ? { Next: params.next } : { End: true }),
    ...(params.catchInto ? catchAllInto(params.catchInto) : {}),
});

/**
 * T1 -> T2 -> Par (Parallel with one branch) -> T3 -> T4 -> T5 -> Done, every Task
 * catching into one `Failed`. The stub leaving T2 has to stay clear of the Parallel.
 */
export const parallelInChain = (): AslDefinition => ({
    StartAt: 'T1',
    States: {
        T1: task({ catchInto: 'Failed', next: 'T2' }),
        T2: task({ catchInto: 'Failed', next: 'Par' }),
        Par: {
            Type: 'Parallel',
            Branches: [{ StartAt: 'B1', States: { B1: { Type: 'Pass', End: true } } }],
            Next: 'T3',
        },
        T3: task({ catchInto: 'Failed', next: 'T4' }),
        T4: task({ catchInto: 'Failed', next: 'T5' }),
        T5: task({ catchInto: 'Failed', next: 'Done' }),
        Done: { Type: 'Succeed' },
        Failed: { Type: 'Fail' },
    },
});

/** A Map whose iterator chain I1..I4 catches into an in-iterator `IFail`. */
export const catchersInsideMap = (): AslDefinition => ({
    StartAt: 'Fan',
    States: {
        Fan: {
            Type: 'Map',
            ItemsPath: '$.items',
            Iterator: {
                StartAt: 'I1',
                States: {
                    I1: task({ catchInto: 'IFail', next: 'I2' }),
                    I2: task({ catchInto: 'IFail', next: 'I3' }),
                    I3: task({ catchInto: 'IFail', next: 'I4' }),
                    I4: task({ catchInto: 'IFail', next: 'IDone' }),
                    IDone: { Type: 'Succeed' },
                    IFail: { Type: 'Fail' },
                },
            },
            End: true,
        },
    },
});

/**
 * Choice -> A0..A5 -> Join -> X -> Y, and Choice -> B0 -> X. Every A and B0 catches into
 * `Failed`. B0 is listed first, so its catch edge comes before A5's in graph order. B0
 * is not an ancestor of any other catcher, so its edge has to stay in dagre or Failed
 * can land on B0's row.
 */
export const pulledShape = (): AslDefinition => ({
    StartAt: 'Route',
    States: {
        Route: {
            Type: 'Choice',
            Choices: [{ Variable: '$.x', BooleanEquals: true, Next: 'A0' }],
            Default: 'B0',
        },
        B0: task({ catchInto: 'Failed', next: 'X' }),
        A0: task({ catchInto: 'Failed', next: 'A1' }),
        A1: task({ catchInto: 'Failed', next: 'A2' }),
        A2: task({ catchInto: 'Failed', next: 'A3' }),
        A3: task({ catchInto: 'Failed', next: 'A4' }),
        A4: task({ catchInto: 'Failed', next: 'A5' }),
        A5: task({ catchInto: 'Failed', next: 'Join' }),
        Join: { Type: 'Pass', Next: 'X' },
        X: { Type: 'Pass', Next: 'Y' },
        Y: { Type: 'Succeed' },
        Failed: { Type: 'Fail' },
    },
});

/**
 * Choice fanning out to three branches of three Tasks (A, B, C), each ending in `Done`.
 * Every Task catches into `Failed`, and A0 has a second Catch block, so one row holds
 * four withheld labels.
 */
export const sameRowFanOut = (): AslDefinition => {
    const states: Record<string, AslState> = {
        Route: {
            Type: 'Choice',
            Choices: [
                { Variable: '$.x', NumericEquals: 1, Next: 'A0' },
                { Variable: '$.x', NumericEquals: 2, Next: 'B0' },
            ],
            Default: 'C0',
        },
        Done: { Type: 'Succeed' },
        Failed: { Type: 'Fail' },
    };
    for (const branch of ['A', 'B', 'C']) {
        for (let step = 0; step < 3; step += 1) {
            states[`${branch}${step}`] = task({
                catchInto: 'Failed',
                next: step === 2 ? 'Done' : `${branch}${step + 1}`,
            });
        }
    }
    states.A0.Catch = [
        { ErrorEquals: ['States.ALL'], Next: 'Failed' },
        { ErrorEquals: ['States.Timeout'], Next: 'Failed' },
    ];
    return { StartAt: 'Route', States: states };
};

interface IsLaneRouteParams {
    edge: LayoutResult['edges'][number];
    layout: LayoutDirection;
    nodes: StateNode[];
}

/**
 * True for a catch-lane route: an axis-aligned polyline of six or more points with a point
 * strictly beyond every node box on the side lanes use (left of all nodes in TB/BT, below
 * all of them in LR/RL). A dagre edge can bow past the nodes too, but it is never both
 * axis-aligned and that long.
 */
export function isLaneRoute(params: IsLaneRouteParams): boolean {
    const { edge, layout, nodes } = params;
    const points = edge.points ?? [];
    const axisAligned = points.every(
        (point, index) =>
            index === 0 ||
            Math.min(Math.abs(point.x - points[index - 1].x), Math.abs(point.y - points[index - 1].y)) < 1e-6,
    );
    if (points.length < 6 || !axisAligned) {
        return false;
    }
    if (layout === 'TB' || layout === 'BT') {
        const leftmost = Math.min(...nodes.map((node) => (node.x || 0) - (node.width || 0) / 2));
        return points.some((point) => point.x < leftmost);
    }
    const bottom = Math.max(...nodes.map((node) => (node.y || 0) + (node.height || 0) / 2));
    return points.some((point) => point.y > bottom);
}
