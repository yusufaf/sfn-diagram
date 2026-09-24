import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import {
    buildExecutionTimeline,
    generateExecution,
    generateExecutionHtml,
    generateExecutionHtmlAsync,
    generateMermaidExecution,
    parseExecutionHistory,
} from '../src/index';
import { parseAsl } from '../src/AslParser';
import type { AslDefinition, ExecutionTimeline } from '../src/types';

const loadAsl = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'));

const loadHistoryJson = (name: string): string =>
    readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf-8');

const loadEvents = (name: string): HistoryEvent[] =>
    JSON.parse(loadHistoryJson(name)).events as HistoryEvent[];

describe('parseExecutionHistory', () => {
    it('marks every state succeeded on a clean run and captures the path', () => {
        const overlay = parseExecutionHistory({ events: loadEvents('execution-success') });

        expect(overlay.executionStatus).toBe('succeeded');
        expect(overlay.startState).toBe('Start');
        expect(overlay.states.Start.status).toBe('succeeded');
        expect(overlay.states.Process.status).toBe('succeeded');
        expect(overlay.states.End.status).toBe('succeeded');

        // Process ran 200ms -> 1450ms exit = 1250ms
        expect(overlay.states.Process.durationMs).toBe(1250);
        expect(overlay.states.Process.attempts).toBe(1);

        expect(overlay.takenEdges).toEqual([
            { from: 'Start', to: 'Process' },
            { from: 'Process', to: 'End' },
        ]);
    });

    it('records only the taken branch of a Choice', () => {
        const overlay = parseExecutionHistory({
            events: loadEvents('execution-choice-highvalue'),
        });

        expect(overlay.states.CheckValue.status).toBe('succeeded');
        expect(overlay.states.HighValue.status).toBe('succeeded');
        // The untaken branches are absent from the derived model.
        expect(overlay.states.LowValue).toBeUndefined();
        expect(overlay.states.DefaultPath).toBeUndefined();

        const froms = overlay.takenEdges.map((edge) => `${edge.from}->${edge.to}`);
        expect(froms).toContain('CheckValue->HighValue');
        expect(froms).not.toContain('CheckValue->LowValue');
    });

    it('records a genuine self-transition as a taken edge, not a retry re-entry', () => {
        const overlay = parseExecutionHistory({ events: loadEvents('execution-self-loop') });

        expect(overlay.states.CheckStatus.status).toBe('succeeded');
        const froms = overlay.takenEdges.map((edge) => `${edge.from}->${edge.to}`);
        expect(froms).toContain('CheckStatus->CheckStatus');
        expect(froms).toContain('CheckStatus->Done');
    });

    it('marks a terminally failing task as failed with its error', () => {
        const overlay = parseExecutionHistory({ events: loadEvents('execution-failed') });

        expect(overlay.executionStatus).toBe('failed');
        expect(overlay.states.Start.status).toBe('succeeded');
        expect(overlay.states.Process.status).toBe('failed');
        expect(overlay.states.Process.error).toBe('Lambda.Unknown');
        expect(overlay.states.Process.attempts).toBe(1);
        // End was never reached.
        expect(overlay.states.End).toBeUndefined();
    });

    it('counts retries and still marks the state succeeded', () => {
        const overlay = parseExecutionHistory({
            events: loadEvents('execution-retry-success'),
        });

        expect(overlay.states.Submit.status).toBe('succeeded');
        // Two failed attempts + one successful attempt.
        expect(overlay.states.Submit.attempts).toBe(3);
        expect(overlay.states.Done.status).toBe('succeeded');
        expect(overlay.executionStatus).toBe('succeeded');
    });

    it('marks a caught task as caught while the run continues', () => {
        const overlay = parseExecutionHistory({ events: loadEvents('execution-caught') });

        expect(overlay.executionStatus).toBe('succeeded');
        expect(overlay.states.RiskyTask.status).toBe('caught');
        expect(overlay.states.RiskyTask.error).toBe('States.TaskFailed');
        expect(overlay.states.RiskyTask.attempts).toBe(1);
        expect(overlay.states.HandleError.status).toBe('succeeded');
        expect(overlay.states.Success.status).toBe('succeeded');
    });

    it('fails the abandoned leaf when a Parallel branch failure is caught', () => {
        const overlay = parseExecutionHistory({
            events: loadEvents('execution-parallel-caught'),
        });

        expect(overlay.executionStatus).toBe('succeeded');
        // The branch that blew up never emits a StateExited - the Parallel's own
        // failure is what closes it.
        expect(overlay.states.Branch2.status).toBe('failed');
        expect(overlay.states.Branch2.error).toBe('Lambda.Unknown');
        expect(overlay.states.Branch2.attempts).toBe(1);
        expect(overlay.states.Branch1.status).toBe('succeeded');
        // The container exits via its Catch, so it is caught rather than failed.
        expect(overlay.states.ParallelExecution.status).toBe('caught');
        expect(overlay.states.ParallelExecution.error).toBe('Lambda.Unknown');
        expect(overlay.states.HandleError.status).toBe('succeeded');
        expect(overlay.states.FinalState.status).toBe('succeeded');
    });

    it('fails the iteration leaf a Map run failure abandons', () => {
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                stateEnteredEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapRunStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'TaskStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.100Z'),
                stateEnteredEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'MapRunFailed',
                mapRunFailedEventDetails: { error: 'States.TaskFailed' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'MapStateExited',
                timestamp: new Date('2024-01-01T00:00:00.200Z'),
                stateExitedEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 7, previousEventId: 6, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });

        // MapRunFailed carries the error, so the leaf inherits it.
        expect(overlay.states.ProcessItem.status).toBe('failed');
        expect(overlay.states.ProcessItem.error).toBe('States.TaskFailed');
        expect(overlay.states.ProcessItems.status).toBe('caught');
    });

    it('closes a sibling branch the container failure aborted mid-run', () => {
        // Branch1 is still in flight when Branch2 takes the Parallel down. It reports
        // `failed` with no error of its own rather than staying open as `running`.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'ParallelStateEntered',
                stateEnteredEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'ParallelStateStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'Slow' },
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 3,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'Doomed' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'TaskFailed',
                taskFailedEventDetails: { error: 'Boom' },
            } as HistoryEvent,
            { id: 7, previousEventId: 6, type: 'ParallelStateFailed' } as HistoryEvent,
            {
                id: 8,
                previousEventId: 7,
                type: 'ParallelStateExited',
                stateExitedEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            { id: 9, previousEventId: 8, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });

        expect(overlay.states.Doomed.status).toBe('failed');
        expect(overlay.states.Doomed.error).toBe('Boom');
        expect(overlay.states.Slow.status).toBe('failed');
        expect(overlay.states.Slow.error).toBeUndefined();
        expect(overlay.states.Fanout.status).toBe('caught');
    });

    it('resolves nested container failures outermost-last, not to the inner frame twice', () => {
        // An inner Map fails uncaught, so it never exits and its frame stays open; the
        // outer Map's own failure must resolve to the outer frame rather than matching
        // the still-open inner one again.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                stateEnteredEventDetails: { name: 'OuterMap' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapStateStarted' } as HistoryEvent,
            { id: 4, previousEventId: 3, type: 'MapIterationStarted' } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'MapStateEntered',
                stateEnteredEventDetails: { name: 'InnerMap' },
            } as HistoryEvent,
            { id: 6, previousEventId: 5, type: 'MapStateStarted' } as HistoryEvent,
            { id: 7, previousEventId: 6, type: 'MapIterationStarted' } as HistoryEvent,
            {
                id: 8,
                previousEventId: 7,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'Leaf' },
            } as HistoryEvent,
            {
                id: 9,
                previousEventId: 8,
                type: 'TaskFailed',
                taskFailedEventDetails: { error: 'Boom' },
            } as HistoryEvent,
            { id: 10, previousEventId: 9, type: 'MapIterationFailed' } as HistoryEvent,
            { id: 11, previousEventId: 10, type: 'MapStateFailed' } as HistoryEvent,
            { id: 12, previousEventId: 11, type: 'MapIterationFailed' } as HistoryEvent,
            { id: 13, previousEventId: 12, type: 'MapStateFailed' } as HistoryEvent,
            {
                id: 14,
                previousEventId: 13,
                type: 'MapStateExited',
                stateExitedEventDetails: { name: 'OuterMap' },
            } as HistoryEvent,
            { id: 15, previousEventId: 14, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });

        expect(overlay.executionStatus).toBe('succeeded');
        expect(overlay.states.Leaf.status).toBe('failed');
        expect(overlay.states.InnerMap.status).toBe('failed');
        expect(overlay.states.OuterMap.status).toBe('caught');
        expect(overlay.states.OuterMap.attempts).toBe(1);
    });

    it('counts a distributed Map run failure once, not once per failure event', () => {
        // A distributed Map emits MapRunFailed and then MapStateFailed for the same
        // failed attempt; both belong to the one Map frame.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                stateEnteredEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapRunStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'MapRunFailed',
                mapRunFailedEventDetails: { error: 'States.ExceedToleratedFailureThreshold' },
            } as HistoryEvent,
            { id: 5, previousEventId: 4, type: 'MapStateFailed' } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'MapStateExited',
                stateExitedEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 7, previousEventId: 6, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });

        expect(overlay.states.ProcessItems.status).toBe('caught');
        expect(overlay.states.ProcessItems.attempts).toBe(1);
        expect(overlay.states.ProcessItems.error).toBe('States.ExceedToleratedFailureThreshold');
    });

    it('counts each failed attempt of a retried container', () => {
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'ParallelStateEntered',
                stateEnteredEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'ParallelStateStarted' } as HistoryEvent,
            { id: 4, previousEventId: 3, type: 'ParallelStateFailed' } as HistoryEvent,
            { id: 5, previousEventId: 4, type: 'ParallelStateStarted' } as HistoryEvent,
            { id: 6, previousEventId: 5, type: 'ParallelStateFailed' } as HistoryEvent,
            {
                id: 7,
                previousEventId: 6,
                type: 'ParallelStateExited',
                stateExitedEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            { id: 8, previousEventId: 7, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });

        // Two failed attempts, then a Catch exit - so no successful try to add.
        expect(overlay.states.Fanout.status).toBe('caught');
        expect(overlay.states.Fanout.attempts).toBe(2);
    });

    it('aggregates a state entered multiple times (Map iterations)', () => {
        // Two iterations of the same inner state: one succeeds, one fails terminally.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'TaskStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                stateEnteredEventDetails: { name: 'Work' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'TaskSucceeded' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'TaskStateExited',
                timestamp: new Date('2024-01-01T00:00:00.100Z'),
                stateExitedEventDetails: { name: 'Work' },
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'TaskStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.200Z'),
                stateEnteredEventDetails: { name: 'Work' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'TaskFailed',
                taskFailedEventDetails: { error: 'Boom' },
            } as HistoryEvent,
            {
                id: 7,
                previousEventId: 6,
                type: 'ExecutionFailed',
            } as HistoryEvent,
        ];

        const overlay = parseExecutionHistory({ events });
        // Worst outcome wins across iterations.
        expect(overlay.states.Work.status).toBe('failed');
        // 1 (success iteration) + 1 (failed iteration) attempts.
        expect(overlay.states.Work.attempts).toBe(2);
        expect(overlay.states.Work.durationMs).toBe(100);
    });

    it('accepts a raw GetExecutionHistory response and a JSON string', () => {
        const asObject = parseExecutionHistory({
            events: JSON.parse(loadHistoryJson('execution-success')).events,
        });
        // The generators accept the JSON string form directly.
        const fromString = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
        });
        expect(asObject.states.Process.status).toBe('succeeded');
        expect(fromString.metadata.executionStatus).toBe('succeeded');
    });
});

describe('buildExecutionTimeline', () => {
    /** `nodeId#attempt status` per entry, the shape most assertions here care about. */
    const summarizeEntries = (timeline: ExecutionTimeline): string[] =>
        timeline.entries.map((entry) => `${entry.nodeId}#${entry.attempt} ${entry.status}`);

    it('lists every run in entry order with its window and predecessor', () => {
        const timeline = buildExecutionTimeline({
            definition: loadAsl('simple'),
            events: loadEvents('execution-success'),
        });

        expect(timeline.status).toBe('succeeded');
        expect(summarizeEntries(timeline)).toEqual([
            'Start#1 succeeded',
            'Process#1 succeeded',
            'End#1 succeeded',
        ]);
        expect(timeline.entries.map((entry) => entry.fromNodeId)).toEqual([
            undefined,
            'Start',
            'Process',
        ]);

        const [, process] = timeline.entries;
        expect(process.exitedMs! - process.enteredMs).toBe(1250);
        expect(timeline.startMs).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
        expect(timeline.endMs).toBe(Date.parse('2024-01-01T00:00:01.520Z'));
    });

    it('gives each retry attempt its own entry rather than summing them', () => {
        const timeline = buildExecutionTimeline({
            definition: loadAsl('simple'),
            events: loadEvents('execution-retry-success'),
        });

        expect(summarizeEntries(timeline)).toEqual([
            'Submit#1 failed',
            'Submit#2 failed',
            'Submit#3 succeeded',
            'Done#1 succeeded',
        ]);
        // Each attempt runs from its own scheduling to its own outcome, so the backoff
        // between attempts belongs to the attempt that waited it out.
        const [first, second, third] = timeline.entries;
        expect(first.exitedMs).toBe(Date.parse('2024-01-01T00:00:00.300Z'));
        expect(second.enteredMs).toBe(Date.parse('2024-01-01T00:00:02.300Z'));
        expect(second.exitedMs).toBe(Date.parse('2024-01-01T00:00:02.500Z'));
        expect(third.enteredMs).toBe(Date.parse('2024-01-01T00:00:06.500Z'));
        expect(first.error).toBe('States.Timeout');
        // Only the retried state is re-entered; the overlay's summed view still reports
        // the three attempts as one result.
        expect(parseExecutionHistory({ events: loadEvents('execution-retry-success') }).states.Submit
            .attempts).toBe(3);
    });

    it('marks the attempt a Catch handled as caught, not failed', () => {
        const timeline = buildExecutionTimeline({
            definition: loadAsl('error-handling'),
            events: loadEvents('execution-caught'),
        });

        const [risky] = timeline.entries;
        expect(risky.stateName).toBe('RiskyTask');
        expect(risky.status).toBe('caught');
        expect(risky.error).toBe('States.TaskFailed');
        // The run ended when it errored, not when the Catch routed on.
        expect(risky.exitedMs).toBe(Date.parse('2024-01-01T00:00:00.400Z'));
    });

    it('gives a Parallel its own entry with the branches it started', () => {
        const timeline = buildExecutionTimeline({
            definition: loadAsl('parallel-catch'),
            events: loadEvents('execution-parallel-caught'),
        });

        expect(summarizeEntries(timeline)).toEqual([
            'ParallelExecution#1 caught',
            'Branch1#1 succeeded',
            'Branch2#1 failed',
            'HandleError#1 succeeded',
            'FinalState#1 succeeded',
        ]);
        const [container, branch1] = timeline.entries;
        expect(container.branchCount).toBe(2);
        expect(container.iterationCount).toBeUndefined();
        // A branch's first state has no predecessor inside the container.
        expect(branch1.fromNodeId).toBeUndefined();
    });

    it('gives each Map iteration its own entries and counts them on the container', () => {
        const timeline = buildExecutionTimeline({
            definition: loadAsl('map'),
            events: loadEvents('execution-map-mixed'),
        });

        expect(summarizeEntries(timeline)).toEqual([
            'SplitInput#1 succeeded',
            'ProcessItems#1 failed',
            'ProcessItem#1 succeeded',
            'ValidateItem#1 succeeded',
            'ProcessItem#1 failed',
        ]);
        // Two iterations of the same state, one per outcome - separate entries, both a
        // first attempt, rather than one state summed to `failed`.
        expect(timeline.entries[1].iterationCount).toBe(2);
        expect(timeline.entries[4].error).toBe('States.TaskFailed');
    });

    it('reports no iterations for a Distributed Map, whose children are other executions', () => {
        // A DISTRIBUTED ItemProcessor runs each iteration as its own execution, so the
        // parent history carries the run's outcome and nothing finer.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                stateEnteredEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapRunStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'MapRunFailed',
                mapRunFailedEventDetails: { error: 'States.ExceedToleratedFailureThreshold' },
            } as HistoryEvent,
            { id: 5, previousEventId: 4, type: 'MapStateFailed' } as HistoryEvent,
            { id: 6, previousEventId: 5, type: 'ExecutionFailed' } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({
            definition: loadAsl('distributed-map'),
            events,
        });

        const [entry] = timeline.entries;
        expect(entry.stateName).toBe('ProcessItems');
        expect(entry.status).toBe('failed');
        expect(entry.error).toBe('States.ExceedToleratedFailureThreshold');
        expect(entry.iterationCount).toBe(0);
    });

    it('resolves a name reused across scopes to the node that ran', () => {
        // `Validate` exists at the root and inside the Parallel; scoped ids keep them
        // apart, and the container open around the event says which one was entered.
        const definition = {
            StartAt: 'Fanout',
            States: {
                Fanout: {
                    Type: 'Parallel',
                    Next: 'Validate',
                    Branches: [
                        {
                            StartAt: 'Validate',
                            States: { Validate: { Type: 'Pass', End: true } },
                        },
                    ],
                },
                Validate: { Type: 'Pass', End: true },
            },
        } as unknown as AslDefinition;
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'ParallelStateEntered',
                stateEnteredEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'ParallelStateStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'PassStateEntered',
                stateEnteredEventDetails: { name: 'Validate' },
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'PassStateExited',
                stateExitedEventDetails: { name: 'Validate' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'ParallelStateExited',
                stateExitedEventDetails: { name: 'Fanout' },
            } as HistoryEvent,
            {
                id: 7,
                previousEventId: 6,
                type: 'PassStateEntered',
                stateEnteredEventDetails: { name: 'Validate' },
            } as HistoryEvent,
            {
                id: 8,
                previousEventId: 7,
                type: 'PassStateExited',
                stateExitedEventDetails: { name: 'Validate' },
            } as HistoryEvent,
            { id: 9, previousEventId: 8, type: 'ExecutionSucceeded' } as HistoryEvent,
        ];

        const scoped = buildExecutionTimeline({ definition, events });
        expect(scoped.entries.map((entry) => entry.nodeId)).toEqual([
            'Fanout',
            'Fanout__branch0__Validate',
            'Validate',
        ]);

        // With no definition to resolve against, the state's own name stands in.
        const unscoped = buildExecutionTimeline({ events });
        expect(unscoped.entries.map((entry) => entry.nodeId)).toEqual([
            'Fanout',
            'Validate',
            'Validate',
        ]);
    });

    it('does not mistake a concurrent iteration starting for a retry of the failed leaf', () => {
        // With MaxConcurrency > 1 the next iteration starts while the failed leaf's
        // frame is still open. Only a task-level scheduling event begins an attempt, so
        // `MapIterationStarted` must not open a second attempt of that leaf.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                stateEnteredEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapStateStarted' } as HistoryEvent,
            { id: 4, previousEventId: 3, type: 'MapIterationStarted' } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
            { id: 6, previousEventId: 5, type: 'TaskScheduled' } as HistoryEvent,
            {
                id: 7,
                previousEventId: 6,
                type: 'TaskFailed',
                taskFailedEventDetails: { error: 'Boom' },
            } as HistoryEvent,
            { id: 8, previousEventId: 3, type: 'MapIterationStarted' } as HistoryEvent,
            { id: 9, previousEventId: 8, type: 'MapStateFailed' } as HistoryEvent,
            { id: 10, previousEventId: 9, type: 'ExecutionFailed' } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({ definition: loadAsl('map'), events });

        expect(summarizeEntries(timeline)).toEqual([
            'ProcessItems#1 failed',
            'ProcessItem#1 failed',
        ]);
    });

    it('credits an interleaved event to the branch it belongs to, not the last entered', () => {
        // Branch2 fails before Branch1 succeeds, so the success arrives while Branch2's
        // frame is the innermost one. Following the event's own causal chain keeps it
        // off Branch2, which would otherwise gain a second, never-closed run.
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'ParallelStateEntered',
                stateEnteredEventDetails: { name: 'ParallelExecution' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'ParallelStateStarted' } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'Branch1' },
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 3,
                type: 'TaskStateEntered',
                stateEnteredEventDetails: { name: 'Branch2' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 5,
                type: 'TaskFailed',
                taskFailedEventDetails: { error: 'Boom' },
            } as HistoryEvent,
            { id: 7, previousEventId: 4, type: 'TaskSucceeded' } as HistoryEvent,
            {
                id: 8,
                previousEventId: 7,
                type: 'TaskStateExited',
                stateExitedEventDetails: { name: 'Branch1' },
            } as HistoryEvent,
            { id: 9, previousEventId: 6, type: 'ParallelStateFailed' } as HistoryEvent,
            { id: 10, previousEventId: 9, type: 'ExecutionFailed' } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({ definition: loadAsl('parallel'), events });

        expect(summarizeEntries(timeline)).toEqual([
            'ParallelExecution#1 failed',
            'Branch1#1 succeeded',
            'Branch2#1 failed',
        ]);
    });

    it('closes the concurrent run a state exit belongs to, not the innermost by name', () => {
        // Two iterations of `ProcessItem` overlap; each exit must close its own run, or
        // the two entries swap windows and a failure lands on the wrong iteration.
        const at = (ms: number): Date => new Date(Date.parse('2024-01-01T00:00:00.000Z') + ms);
        const events: HistoryEvent[] = [
            {
                id: 1,
                previousEventId: 0,
                type: 'ExecutionStarted',
                timestamp: at(0),
            } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'MapStateEntered',
                timestamp: at(10),
                stateEnteredEventDetails: { name: 'ProcessItems' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'MapStateStarted', timestamp: at(20) } as HistoryEvent,
            {
                id: 4,
                previousEventId: 3,
                type: 'MapIterationStarted',
                timestamp: at(30),
            } as HistoryEvent,
            {
                id: 5,
                previousEventId: 4,
                type: 'TaskStateEntered',
                timestamp: at(50),
                stateEnteredEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
            {
                id: 6,
                previousEventId: 3,
                type: 'MapIterationStarted',
                timestamp: at(60),
            } as HistoryEvent,
            {
                id: 7,
                previousEventId: 6,
                type: 'TaskStateEntered',
                timestamp: at(70),
                stateEnteredEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
            { id: 8, previousEventId: 5, type: 'TaskSucceeded', timestamp: at(120) } as HistoryEvent,
            {
                id: 9,
                previousEventId: 8,
                type: 'TaskStateExited',
                timestamp: at(130),
                stateExitedEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
            { id: 10, previousEventId: 7, type: 'TaskSucceeded', timestamp: at(150) } as HistoryEvent,
            {
                id: 11,
                previousEventId: 10,
                type: 'TaskStateExited',
                timestamp: at(160),
                stateExitedEventDetails: { name: 'ProcessItem' },
            } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({ definition: loadAsl('map'), events });
        const iterations = timeline.entries.filter((entry) => entry.stateName === 'ProcessItem');

        expect(iterations.map((entry) => [entry.enteredMs - timeline.startMs, entry.exitedMs! - timeline.startMs])).toEqual([
            [50, 130],
            [70, 160],
        ]);
    });

    it('anchors the run at the first known timestamp, not the epoch', () => {
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'PassStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                stateEnteredEventDetails: { name: 'Only' },
            } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({ events });

        // An untimestamped first event must not stretch the span back to 1970.
        expect(timeline.startMs).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
        expect(timeline.entries[0].enteredMs).toBe(timeline.startMs);
    });

    it('leaves the entry a still-running execution is inside open', () => {
        const events: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted' } as HistoryEvent,
            {
                id: 2,
                previousEventId: 1,
                type: 'TaskStateEntered',
                timestamp: new Date('2024-01-01T00:00:00.000Z'),
                stateEnteredEventDetails: { name: 'Process' },
            } as HistoryEvent,
            { id: 3, previousEventId: 2, type: 'TaskStarted' } as HistoryEvent,
        ];

        const timeline = buildExecutionTimeline({ events });

        expect(timeline.status).toBe('running');
        expect(timeline.entries).toHaveLength(1);
        expect(timeline.entries[0].status).toBe('running');
        expect(timeline.entries[0].exitedMs).toBeUndefined();
    });
});

describe('generateExecution (SVG overlay)', () => {
    it('colours states by status and dims untaken edges', () => {
        const result = generateExecution({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });

        expect(result.svg).toContain('<svg');
        // Succeeded fill present, not-reached grey fill present.
        expect(result.svg).toContain('#c8e6c9'); // succeeded
        expect(result.svg).toContain('#f5f5f5'); // notReached (LowValue/DefaultPath)
        // Untaken edges dimmed.
        expect(result.svg).toContain('stroke-opacity="0.2"');

        expect(result.metadata.succeeded).toEqual(
            expect.arrayContaining(['CheckValue', 'HighValue', 'Done']),
        );
        expect(result.metadata.notReached).toEqual(
            expect.arrayContaining(['LowValue', 'DefaultPath']),
        );
        expect(result.metadata.executionStatus).toBe('succeeded');
    });

    it('never leaves a caught branch painted as still running', () => {
        const result = generateExecution({
            aslDefinition: loadAsl('parallel-catch'),
            history: loadHistoryJson('execution-parallel-caught'),
        });

        expect(result.metadata.executionStatus).toBe('succeeded');
        expect(result.metadata.running).toEqual([]);
        expect(result.metadata.failed).toContain('Branch2');
        expect(result.metadata.caught).toContain('ParallelExecution');
        // The running blue must be gone from a finished run.
        expect(result.svg).not.toContain('#bbdefb');
    });

    it('reports the ordered timeline alongside the status summary', () => {
        const result = generateExecution({
            aslDefinition: loadAsl('parallel-catch'),
            history: loadHistoryJson('execution-parallel-caught'),
        });

        // Node ids match what the SVG stamps, so a consumer can address the diagram
        // straight from the timeline.
        for (const entry of result.metadata.timeline.entries) {
            expect(result.svg).toContain(`data-state-id="${entry.nodeId}"`);
        }
        expect(result.metadata.timeline.status).toBe('succeeded');
        expect(result.metadata.timeline.entries[0].branchCount).toBe(2);
    });

    it('draws a genuine self-transition at full opacity, not dimmed as untaken', () => {
        const result = generateExecution({
            aslDefinition: loadAsl('self-loop'),
            history: loadHistoryJson('execution-self-loop'),
        });

        // self-loop.asl.json has exactly two edges - the Choice self-loop and the
        // Default branch to Done - and both fired in execution-self-loop.json, so
        // nothing in this diagram should be dimmed as untaken. Before the fix the
        // self-loop was unconditionally excluded from takenEdges and rendered dimmed.
        expect(result.svg).not.toContain('stroke-opacity="0.2"');
        expect(result.metadata.succeeded).toEqual(
            expect.arrayContaining(['CheckStatus', 'Done']),
        );
    });

    it('renders a failed state in red and annotates retries', () => {
        const failed = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-failed'),
        });
        expect(failed.svg).toContain('#ffcdd2'); // failed fill
        expect(failed.metadata.failed).toContain('Process');

        const retried = generateExecution({
            aslDefinition: loadAsl('retry'),
            history: loadHistoryJson('execution-retry-success'),
        });
        // Retry annotation appears on the node.
        expect(retried.svg).toContain('×3');
    });
});

describe('caller-supplied override maps', () => {
    it('keeps a caller nodeOverrides entry', () => {
        const { svg } = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
            nodeOverrides: { Start: { fill: '#123456' } },
        });

        expect(svg).toContain('#123456');
    });

    it('keeps a caller nodeAnnotations entry', () => {
        const { svg } = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
            nodeAnnotations: { Start: 'caller annotation' },
        });

        expect(svg).toContain('caller annotation');
    });

    it('keeps a caller edgeOverrides entry under a qualified key', () => {
        const { svg } = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
            edgeOverrides: { 'Start->Process#normal#0': { stroke: '#abcdef' } },
        });

        expect(svg).toContain('#abcdef');
    });

    it('keeps a caller edgeOverrides entry under a legacy bare key', () => {
        const { svg } = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
            edgeOverrides: { 'Start->Process': { stroke: '#abcdef' } },
        });

        expect(svg).toContain('#abcdef');
    });

    it('still styles the edges the caller did not name', () => {
        const { svg } = generateExecution({
            aslDefinition: loadAsl('simple'),
            history: loadHistoryJson('execution-success'),
            edgeOverrides: { 'Start->Process': { stroke: '#abcdef' } },
        });

        // Process->End is untouched by the caller, so the overlay's taken styling
        // must still be there. Inlined from TAKEN_EDGE_STYLE.stroke in src/execution.ts,
        // which is module-private and not exported.
        expect(svg).toContain('#2e7d32');
    });
});

describe('retry self-loops in the overlay', () => {
    it('assigns a Retry loop and a genuine self-transition distinct qualified ids', () => {
        const { edges } = parseAsl({ definition: loadAsl('parallel-edges') });

        const retryEdge = edges.find((edge) => edge.type === 'retry');
        const selfTransition = edges.find(
            (edge) => edge.from === 'Work' && edge.to === 'Work' && edge.type === 'normal',
        );

        expect(retryEdge?.id).toBe('Work->Work#retry#0');
        expect(selfTransition?.id).toBe('Work->Work#normal#0');
    });

    it('dims a Retry loop in the rendered SVG even when the pair is genuinely taken', () => {
        // parallel-edges.asl.json's Work state has a Retry self-loop, a Catch
        // self-loop, and a genuine `Next: Work` self-transition, all sharing the
        // `Work->Work` pair. Work's only real successors are itself (Next) and
        // itself again (Catch) - there is no path out to Done - so
        // execution-parallel-edges.json is a still-running execution: Work fails
        // once (a real retry), succeeds, then genuinely re-enters itself via Next
        // and is still open when the history ends. `Work->Work` legitimately lands
        // in takenEdges. That must not paint the Retry loop itself as taken.
        const { svg } = generateExecution({
            aslDefinition: loadAsl('parallel-edges'),
            history: loadHistoryJson('execution-parallel-edges'),
        });

        const retryPath = svg.match(/<path[^>]*marker-end="url\(#arrowhead-retry\)"[^>]*>/)?.[0];
        expect(retryPath).toBeDefined();

        // UNTAKEN_EDGE_STYLE in src/execution.ts is `{ strokeOpacity: 0.2 }`.
        expect(retryPath).toContain('stroke-opacity="0.2"');
        // TAKEN_EDGE_STYLE in src/execution.ts is `{ stroke: '#2e7d32', strokeWidth: 3 }`.
        expect(retryPath).not.toContain('#2e7d32');
        expect(retryPath).not.toContain('stroke-width="3"');
    });
});

describe('generateExecutionHtml', () => {
    it('wraps the execution overlay SVG in the interactive viewer', () => {
        const result = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });

        expect(result.html).toContain('<!DOCTYPE html>');
        expect(result.html).toContain('data-sfn-zoom');
        expect(result.html).toContain('data-sfn="search"');
        expect(result.html).toContain('data-sfn="minimap"');
        // The execution overlay's own styling still made it into the embedded SVG.
        expect(result.html).toContain('#c8e6c9'); // succeeded fill
        expect(result.html).toContain('stroke-opacity="0.2"'); // untaken edge
    });

    it('reports the same metadata as generateExecution for the same inputs', () => {
        const svgResult = generateExecution({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });
        const htmlResult = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });

        expect(htmlResult.metadata).toEqual(svgResult.metadata);
        expect(htmlResult.height).toBe(svgResult.height);
        expect(htmlResult.width).toBe(svgResult.width);
    });

    it('embeds clickable edges and state detail, like generateHtml does', () => {
        const result = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });

        expect(result.html).toContain('data-edge-hit-area');
        expect(result.html).toContain('id="sfn-state-data"');
    });

    it('stamps the given nonce on every script and style tag', () => {
        const result = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
            nonce: 'abc123',
        });

        const scriptTags = result.html.match(/<script\b[^>]*>/g) ?? [];
        const styleTags = result.html.match(/<style\b[^>]*>/g) ?? [];
        expect(scriptTags.length).toBeGreaterThan(0);
        expect(styleTags.length).toBeGreaterThan(0);
        for (const tag of [...scriptTags, ...styleTags]) {
            expect(tag).toContain('nonce="abc123"');
        }
    });

    it('omits nonce attributes entirely when not provided', () => {
        const result = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });
        expect(result.html).not.toContain('nonce=');
    });
});

describe('generateExecutionHtmlAsync', () => {
    it('matches generateExecutionHtml when the diagram has no remote icons', async () => {
        const sync = generateExecutionHtml({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });
        const async = await generateExecutionHtmlAsync({
            aslDefinition: loadAsl('choice'),
            history: loadHistoryJson('execution-choice-highvalue'),
        });

        expect(async.html).toBe(sync.html);
        expect(async.metadata).toEqual(sync.metadata);
    });
});

describe('generateMermaidExecution', () => {
    it('emits execution classes and label annotations', () => {
        const result = generateMermaidExecution({
            aslDefinition: loadAsl('retry'),
            history: loadHistoryJson('execution-retry-success'),
        });

        expect(result.code).toContain('stateDiagram-v2');
        expect(result.code).toContain('classDef execSucceeded');
        expect(result.code).toContain('classDef execNotReached');
        expect(result.code).toContain('class Submit execSucceeded');
        // Fail state (Failed) was never reached.
        expect(result.code).toContain('class Failed execNotReached');
        // Annotation on the retried state.
        expect(result.code).toContain('×3');
        expect(result.metadata.executionStatus).toBe('succeeded');
        // The Mermaid output cannot show a retry loop, so the three attempts the
        // annotation sums are only readable from the timeline.
        expect(
            result.metadata.timeline.entries.filter((entry) => entry.stateName === 'Submit')
        ).toHaveLength(3);
    });
});
