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

/**
 * Sample execution histories paired with each ASL sample, used by the execution
 * overlay mode. Each is the shape returned by `GetExecutionHistory`.
 */
export const SAMPLE_HISTORIES: Record<SampleKey, string> = {
    helloWorld: JSON.stringify(
        {
            events: [
                { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
                { id: 2, previousEventId: 1, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.020Z', stateEnteredEventDetails: { name: 'HelloWorld' } },
                { id: 3, previousEventId: 2, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.140Z', stateExitedEventDetails: { name: 'HelloWorld' } },
                { id: 4, previousEventId: 3, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.150Z' },
            ],
        },
        null,
        2
    ),

    choice: JSON.stringify(
        {
            events: [
                { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
                { id: 2, previousEventId: 1, type: 'ChoiceStateEntered', timestamp: '2024-01-01T00:00:00.020Z', stateEnteredEventDetails: { name: 'CheckValue' } },
                { id: 3, previousEventId: 2, type: 'ChoiceStateExited', timestamp: '2024-01-01T00:00:00.070Z', stateExitedEventDetails: { name: 'CheckValue' } },
                { id: 4, previousEventId: 3, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.090Z', stateEnteredEventDetails: { name: 'HighPath' } },
                { id: 5, previousEventId: 4, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.180Z', stateExitedEventDetails: { name: 'HighPath' } },
                { id: 6, previousEventId: 5, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.190Z' },
            ],
        },
        null,
        2
    ),

    parallel: JSON.stringify(
        {
            events: [
                { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
                { id: 2, previousEventId: 1, type: 'ParallelStateEntered', timestamp: '2024-01-01T00:00:00.020Z', stateEnteredEventDetails: { name: 'ParallelWork' } },
                { id: 3, previousEventId: 2, type: 'ParallelStateStarted', timestamp: '2024-01-01T00:00:00.030Z' },
                { id: 4, previousEventId: 3, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.040Z', stateEnteredEventDetails: { name: 'BranchA' } },
                { id: 5, previousEventId: 4, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.120Z', stateExitedEventDetails: { name: 'BranchA' } },
                { id: 6, previousEventId: 3, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.040Z', stateEnteredEventDetails: { name: 'BranchB' } },
                { id: 7, previousEventId: 6, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.160Z', stateExitedEventDetails: { name: 'BranchB' } },
                { id: 8, previousEventId: 7, type: 'ParallelStateExited', timestamp: '2024-01-01T00:00:00.180Z', stateExitedEventDetails: { name: 'ParallelWork' } },
                { id: 9, previousEventId: 8, type: 'SucceedStateEntered', timestamp: '2024-01-01T00:00:00.190Z', stateEnteredEventDetails: { name: 'Done' } },
                { id: 10, previousEventId: 9, type: 'SucceedStateExited', timestamp: '2024-01-01T00:00:00.200Z', stateExitedEventDetails: { name: 'Done' } },
                { id: 11, previousEventId: 10, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.210Z' },
            ],
        },
        null,
        2
    ),

    map: JSON.stringify(
        {
            events: [
                { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00.000Z' },
                { id: 2, previousEventId: 1, type: 'MapStateEntered', timestamp: '2024-01-01T00:00:00.020Z', stateEnteredEventDetails: { name: 'ProcessItems' } },
                { id: 3, previousEventId: 2, type: 'MapStateStarted', timestamp: '2024-01-01T00:00:00.030Z' },
                { id: 4, previousEventId: 3, type: 'MapIterationStarted', timestamp: '2024-01-01T00:00:00.040Z' },
                { id: 5, previousEventId: 4, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.050Z', stateEnteredEventDetails: { name: 'ProcessItem' } },
                { id: 6, previousEventId: 5, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.110Z', stateExitedEventDetails: { name: 'ProcessItem' } },
                { id: 7, previousEventId: 6, type: 'MapIterationStarted', timestamp: '2024-01-01T00:00:00.120Z' },
                { id: 8, previousEventId: 7, type: 'PassStateEntered', timestamp: '2024-01-01T00:00:00.130Z', stateEnteredEventDetails: { name: 'ProcessItem' } },
                { id: 9, previousEventId: 8, type: 'PassStateExited', timestamp: '2024-01-01T00:00:00.190Z', stateExitedEventDetails: { name: 'ProcessItem' } },
                { id: 10, previousEventId: 9, type: 'MapStateExited', timestamp: '2024-01-01T00:00:00.200Z', stateExitedEventDetails: { name: 'ProcessItems' } },
                { id: 11, previousEventId: 10, type: 'SucceedStateEntered', timestamp: '2024-01-01T00:00:00.210Z', stateEnteredEventDetails: { name: 'Done' } },
                { id: 12, previousEventId: 11, type: 'SucceedStateExited', timestamp: '2024-01-01T00:00:00.220Z', stateExitedEventDetails: { name: 'Done' } },
                { id: 13, previousEventId: 12, type: 'ExecutionSucceeded', timestamp: '2024-01-01T00:00:00.230Z' },
            ],
        },
        null,
        2
    ),
}
