export type SampleKey = 'choice' | 'helloWorld' | 'map' | 'parallel'

export const SAMPLE_KEYS: SampleKey[] = ['helloWorld', 'choice', 'parallel', 'map']

export const SAMPLE_LABELS: Record<SampleKey, string> = {
    choice: 'Choice',
    helloWorld: 'Hello World',
    map: 'Map',
    parallel: 'Parallel',
}

export const SAMPLES: Record<SampleKey, string> = {
    choice: JSON.stringify(
        {
            Comment: 'Choice state example',
            StartAt: 'CheckValue',
            States: {
                CheckValue: {
                    Choices: [
                        { Next: 'HighPath', NumericGreaterThan: 10, Variable: '$.value' },
                        { Next: 'LowPath', NumericLessThanEquals: 10, Variable: '$.value' },
                    ],
                    Type: 'Choice',
                },
                HighPath: { End: true, Result: 'high', Type: 'Pass' },
                LowPath: { End: true, Result: 'low', Type: 'Pass' },
            },
        },
        null,
        2
    ),

    helloWorld: JSON.stringify(
        {
            Comment: 'A simple Hello World state machine',
            StartAt: 'HelloWorld',
            States: {
                HelloWorld: {
                    End: true,
                    Result: 'Hello, World!',
                    Type: 'Pass',
                },
            },
        },
        null,
        2
    ),

    map: JSON.stringify(
        {
            Comment: 'Map state example',
            StartAt: 'ProcessItems',
            States: {
                Done: { End: true, Type: 'Succeed' },
                ProcessItems: {
                    ItemsPath: '$.items',
                    Iterator: {
                        StartAt: 'ProcessItem',
                        States: {
                            ProcessItem: { End: true, Type: 'Pass' },
                        },
                    },
                    Next: 'Done',
                    Type: 'Map',
                },
            },
        },
        null,
        2
    ),

    parallel: JSON.stringify(
        {
            Comment: 'Parallel state example',
            StartAt: 'ParallelWork',
            States: {
                Done: { End: true, Type: 'Succeed' },
                ParallelWork: {
                    Branches: [
                        {
                            StartAt: 'BranchA',
                            States: { BranchA: { End: true, Type: 'Pass' } },
                        },
                        {
                            StartAt: 'BranchB',
                            States: { BranchB: { End: true, Type: 'Pass' } },
                        },
                    ],
                    Next: 'Done',
                    Type: 'Parallel',
                },
            },
        },
        null,
        2
    ),
}
