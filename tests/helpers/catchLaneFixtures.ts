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

/**
 * Choice fanning out to `count` branches of two Tasks each, every Task catching
 * `States.TaskFailed` and `States.Timeout` into `Failed`, the branches rejoining at
 * `Join`. Every first Task shares one row, so all of their long labels want the same
 * short trunk stretch.
 */
export const wideFanOut = (count: number): AslDefinition => {
    const states: Record<string, AslState> = {
        Route: {
            Type: 'Choice',
            Choices: Array.from({ length: count - 1 }, (_, index) => ({
                Variable: '$.x',
                NumericEquals: index,
                Next: `B${index}a`,
            })),
            Default: `B${count - 1}a`,
        },
        Join: { Type: 'Succeed' },
        Failed: { Type: 'Fail' },
    };
    const catchBoth = { Catch: [{ ErrorEquals: ['States.TaskFailed', 'States.Timeout'], Next: 'Failed' }] };
    for (let branch = 0; branch < count; branch += 1) {
        states[`B${branch}a`] = { ...task({ next: `B${branch}b` }), ...catchBoth };
        states[`B${branch}b`] = { ...task({ next: 'Join' }), ...catchBoth };
    }
    return { StartAt: 'Route', States: states };
};

/**
 * Step0 -> ... -> Step9, every Step catching into `Recover`, a Pass listed first that
 * loops back to Step0. dagre breaks the loop at a catch edge and ranks `Recover` above
 * the chain.
 */
export const loopBackIntoChain = (): AslDefinition => {
    const states: Record<string, AslState> = { Recover: { Type: 'Pass', Next: 'Step0' } };
    for (let index = 0; index < 10; index += 1) {
        states[`Step${index}`] = task({ catchInto: 'Recover', next: index === 9 ? undefined : `Step${index + 1}` });
    }
    return { StartAt: 'Step0', States: states };
};

/**
 * Step0 -> ... -> Step7 -> Done, even Steps catching into `H1` and odd ones into `H2`.
 * H2's lane lies outside H1's, so H2's stubs cross H1's lane between H1's own rows.
 */
export const interleavedHandlers = (): AslDefinition => {
    const states: Record<string, AslState> = {
        Done: { Type: 'Succeed' },
        H1: { Type: 'Fail' },
        H2: { Type: 'Fail' },
    };
    for (let index = 0; index < 8; index += 1) {
        states[`Step${index}`] = task({
            catchInto: index % 2 === 0 ? 'H1' : 'H2',
            next: index === 7 ? 'Done' : `Step${index + 1}`,
        });
    }
    return { StartAt: 'Step0', States: states };
};

/**
 * Choice -> C0 -> ... -> C(length - 1), every C catching into `Failed`, with a Parallel
 * as the Choice's default branch. dagre puts the Parallel on the lane side, beside the
 * top of the chain, so the stubs leaving the rows it spans would run through it.
 */
export const parallelBesideChain = (length: number): AslDefinition => {
    const states: Record<string, AslState> = {
        Route: {
            Type: 'Choice',
            Choices: [{ Variable: '$.x', BooleanEquals: true, Next: 'C0' }],
            Default: 'Par',
        },
        Par: {
            Type: 'Parallel',
            Branches: [
                {
                    StartAt: 'P1',
                    States: {
                        P1: { Type: 'Pass', Next: 'P2' },
                        P2: { Type: 'Pass', Next: 'P3' },
                        P3: { Type: 'Pass', End: true },
                    },
                },
            ],
            End: true,
        },
        Failed: { Type: 'Fail' },
    };
    for (let index = 0; index < length; index += 1) {
        states[`C${index}`] = task({ catchInto: 'Failed', next: index === length - 1 ? undefined : `C${index + 1}` });
    }
    return { StartAt: 'Route', States: states };
};

/**
 * Choice fanning out to six branches of two Tasks each that converge on a `Join` Task
 * and then `Last`; every Task catches into `Failed`. Join's stub joins the lane nearer
 * the handler than every branch's, so packed branch labels must keep off its row.
 */
export const convergingFanOut = (): AslDefinition => {
    const states: Record<string, AslState> = {
        Route: {
            Type: 'Choice',
            Choices: Array.from({ length: 5 }, (_, index) => ({
                Variable: '$.x',
                NumericEquals: index,
                Next: `B${index}_0`,
            })),
            Default: 'B5_0',
        },
        Join: task({ catchInto: 'Failed', next: 'Last' }),
        Last: { Type: 'Succeed' },
        Failed: { Type: 'Fail' },
    };
    for (let branch = 0; branch < 6; branch += 1) {
        states[`B${branch}_0`] = task({ catchInto: 'Failed', next: `B${branch}_1` });
        states[`B${branch}_1`] = task({ catchInto: 'Failed', next: 'Join' });
    }
    return { StartAt: 'Route', States: states };
};

/**
 * A chain of `length` Tasks catching round-robin into `Failed0` .. `Failed{handlers - 1}`,
 * each Catch naming three errors. In LR a label is longer than one rank, so with three
 * handlers the inner lanes' labels cannot avoid every stub of the outer lanes.
 */
export const roundRobinHandlers = (length: number, handlers = 3): AslDefinition => {
    const states: Record<string, AslState> = { Done: { Type: 'Succeed' } };
    for (let handler = 0; handler < handlers; handler += 1) {
        states[`Failed${handler}`] = { Type: 'Fail' };
    }
    for (let index = 0; index < length; index += 1) {
        states[`Step${index}`] = {
            ...task({ next: index === length - 1 ? 'Done' : `Step${index + 1}` }),
            Catch: [
                {
                    ErrorEquals: ['States.TaskFailed', 'States.Timeout', 'States.Permissions'],
                    Next: `Failed${index % handlers}`,
                },
            ],
        };
    }
    return { StartAt: 'Step0', States: states };
};

const RANDOM_ERROR_NAMES = [
    'States.TaskFailed',
    'States.Timeout',
    'States.Permissions',
    'Lambda.ServiceException',
    'MyCustomError',
    'X',
    'States.ALL',
];

/** One machine from {@link randomCatchMachines}, with the layout options to try it with. */
export interface RandomCatchMachine {
    definition: AslDefinition;
    layout: LayoutDirection;
    rankSeparation: number;
}

/**
 * `count` pseudo-random chains catching into one to three shared handlers, each with a
 * random layout direction, rank separation and one to three error names per Catch.
 * Deterministic for a given `seed`; seed 1's sixteenth machine (RL, rankSeparation 22)
 * once hung the lane label packing.
 */
export const randomCatchMachines = (seed: number, count: number): RandomCatchMachine[] => {
    let state = seed;
    const random = (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
    const layouts = ['TB', 'LR', 'RL', 'BT'] as const;
    return Array.from({ length: count }, () => {
        const length = 6 + Math.floor(random() * 20);
        const handlers = 1 + Math.floor(random() * 3);
        const states: Record<string, AslState> = { Done: { Type: 'Succeed' } };
        for (let handler = 0; handler < handlers; handler += 1) {
            states[`Failed${handler}`] = { Type: 'Fail' };
        }
        for (let index = 0; index < length; index += 1) {
            const errorCount = 1 + Math.floor(random() * 3);
            const errors = Array.from(
                { length: errorCount },
                () => RANDOM_ERROR_NAMES[Math.floor(random() * RANDOM_ERROR_NAMES.length)],
            );
            states[`Step${index}`] = {
                ...task({ next: index === length - 1 ? 'Done' : `Step${index + 1}` }),
                Catch: [{ ErrorEquals: [...new Set(errors)], Next: `Failed${Math.floor(random() * handlers)}` }],
            };
        }
        const layout = layouts[Math.floor(random() * 4)];
        const rankSeparation = 16 + Math.floor(random() * 90);
        return { definition: { StartAt: 'Step0', States: states }, layout, rankSeparation };
    });
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
