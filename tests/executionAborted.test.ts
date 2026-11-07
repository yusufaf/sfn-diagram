import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import { buildExecutionTimeline, generateExecution, parseExecutionHistory } from '../src/index';
import type { ExecutionTimeline } from '../src/types';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

/** One history event; `previousEventId` chains each event to the one it follows in its own run. */
const event = (id: number, previousEventId: number, type: string, details: Record<string, unknown> = {}): HistoryEvent =>
    ({ id, previousEventId, timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, id)), type, ...details }) as HistoryEvent;

const entered = (id: number, previousEventId: number, type: string, name: string): HistoryEvent =>
    event(id, previousEventId, type, { stateEnteredEventDetails: { name } });

const exited = (id: number, previousEventId: number, type: string, name: string): HistoryEvent =>
    event(id, previousEventId, type, { stateExitedEventDetails: { name } });

const taskFailed = (id: number, previousEventId: number, error: string): HistoryEvent =>
    event(id, previousEventId, 'TaskFailed', { taskFailedEventDetails: { error } });

/** `nodeId#attempt status` per entry. */
const summarizeEntries = (timeline: ExecutionTimeline): string[] =>
    timeline.entries.map((entry) => `${entry.nodeId}#${entry.attempt} ${entry.status}`);

/** `name:status` per state, in the order the overlay lists them. */
const statuses = (events: HistoryEvent[]): Record<string, string> =>
    Object.fromEntries(
        Object.entries(parseExecutionHistory({ events }).states).map(([name, state]) => [name, state.status])
    );

describe('aborted states', () => {
    it('keeps a Fail state reached in a branch failed while its in-flight sibling is aborted', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'ParallelStateEntered', 'P'),
            event(3, 2, 'ParallelStateStarted'),
            entered(4, 3, 'FailStateEntered', 'F'),
            entered(5, 3, 'TaskStateEntered', 'T'),
            event(6, 5, 'TaskScheduled'),
            event(7, 4, 'ParallelStateFailed'),
            exited(8, 7, 'ParallelStateExited', 'P'),
            event(9, 8, 'ExecutionSucceeded'),
        ];

        expect(statuses(events)).toEqual({ F: 'failed', P: 'caught', T: 'aborted' });
    });

    it('aborts a nested Parallel and resolves the outer failure to the outer Parallel', () => {
        // Doomed fails in P1's first branch; AWS aborts the nested P2 in its second.
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'ParallelStateEntered', 'P1'),
            event(3, 2, 'ParallelStateStarted'),
            entered(4, 3, 'TaskStateEntered', 'Doomed'),
            taskFailed(5, 4, 'Boom'),
            entered(6, 3, 'ParallelStateEntered', 'P2'),
            event(7, 6, 'ParallelStateStarted'),
            entered(8, 7, 'TaskStateEntered', 'L'),
            event(9, 8, 'TaskScheduled'),
            event(10, 9, 'TaskStateAborted'),
            event(11, 10, 'ParallelStateAborted'),
            event(12, 5, 'ParallelStateFailed'),
            exited(13, 12, 'ParallelStateExited', 'P1'),
            event(14, 13, 'ExecutionSucceeded'),
        ];

        const overlay = parseExecutionHistory({ events });

        expect(statuses(events)).toEqual({ Doomed: 'failed', L: 'aborted', P1: 'caught', P2: 'aborted' });
        expect(overlay.states.P1.attempts).toBe(1);
    });

    it('closes a nested Parallel that failed before it was aborted as failed', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'ParallelStateEntered', 'P1'),
            event(3, 2, 'ParallelStateStarted'),
            entered(4, 3, 'TaskStateEntered', 'Doomed'),
            taskFailed(5, 4, 'Boom'),
            entered(6, 3, 'ParallelStateEntered', 'P2'),
            event(7, 6, 'ParallelStateStarted'),
            entered(8, 7, 'TaskStateEntered', 'L'),
            event(9, 8, 'TaskScheduled'),
            taskFailed(10, 9, 'LeafBoom'),
            event(11, 10, 'ParallelStateFailed'),
            event(12, 11, 'ParallelStateAborted'),
            event(13, 5, 'ParallelStateFailed'),
            exited(14, 13, 'ParallelStateExited', 'P1'),
            event(15, 14, 'ExecutionSucceeded'),
        ];

        const overlay = parseExecutionHistory({ events });

        expect(statuses(events)).toEqual({ Doomed: 'failed', L: 'failed', P1: 'caught', P2: 'failed' });
        expect(overlay.states.P1.attempts).toBe(1);
    });

    // Synthetic event orders: AWS documents no ordering for a nested Map's run abort.
    it('leaves a Map whose run was aborted for the outer container failure to skip', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'MapStateEntered', 'O'),
            event(3, 2, 'MapStateStarted'),
            event(4, 3, 'MapIterationStarted'),
            entered(5, 4, 'MapStateEntered', 'M'),
            event(6, 5, 'MapRunStarted'),
            event(7, 6, 'MapRunAborted'),
            event(8, 7, 'MapStateFailed'),
            exited(9, 8, 'MapStateExited', 'O'),
            event(10, 9, 'ExecutionSucceeded'),
        ];

        expect(statuses(events)).toEqual({ M: 'aborted', O: 'caught' });
    });

    it('aborts a Map whose run and state were both aborted', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'MapStateEntered', 'M'),
            event(3, 2, 'MapRunStarted'),
            event(4, 3, 'MapRunAborted'),
            event(5, 4, 'MapStateAborted'),
            event(6, 5, 'ExecutionAborted'),
        ];

        const overlay = parseExecutionHistory({ events });

        expect(overlay.executionStatus).toBe('aborted');
        expect(overlay.states.M.status).toBe('aborted');
        expect(overlay.states.M.attempts).toBe(1);
    });

    it('takes the worst of a state\'s runs, ranking aborted between failed and caught', () => {
        // Three iterations of X -> Y. X is caught in A, succeeds in B and is in flight in C;
        // Y fails in A and is in flight in B.
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'MapStateEntered', 'M'),
            event(3, 2, 'MapStateStarted'),
            event(4, 3, 'MapIterationStarted'),
            entered(5, 4, 'TaskStateEntered', 'X'),
            taskFailed(6, 5, 'XFailed'),
            exited(7, 6, 'TaskStateExited', 'X'),
            entered(8, 7, 'TaskStateEntered', 'Y'),
            taskFailed(9, 8, 'YFailed'),
            event(10, 3, 'MapIterationStarted'),
            entered(11, 10, 'TaskStateEntered', 'X'),
            exited(12, 11, 'TaskStateExited', 'X'),
            entered(13, 12, 'TaskStateEntered', 'Y'),
            event(14, 13, 'TaskScheduled'),
            event(15, 3, 'MapIterationStarted'),
            entered(16, 15, 'TaskStateEntered', 'X'),
            event(17, 16, 'TaskScheduled'),
            event(18, 9, 'MapStateFailed'),
            exited(19, 18, 'MapStateExited', 'M'),
            event(20, 19, 'ExecutionSucceeded'),
        ];

        // X: caught + succeeded + aborted -> aborted. Y: failed + aborted -> failed.
        expect(statuses(events)).toEqual({ M: 'caught', X: 'aborted', Y: 'failed' });
    });

    it('aborts a sibling that was mid-Retry when another branch failed', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'ParallelStateEntered', 'P'),
            event(3, 2, 'ParallelStateStarted'),
            entered(4, 3, 'TaskStateEntered', 'Slow'),
            event(5, 4, 'TaskScheduled'),
            taskFailed(6, 5, 'Flaky'),
            event(7, 6, 'TaskScheduled'),
            entered(8, 3, 'TaskStateEntered', 'Doomed'),
            taskFailed(9, 8, 'Boom'),
            event(10, 9, 'ParallelStateFailed'),
            exited(11, 10, 'ParallelStateExited', 'P'),
            event(12, 11, 'ExecutionSucceeded'),
        ];

        const overlay = parseExecutionHistory({ events });
        const timeline = buildExecutionTimeline({ events });
        const entryFor = (nodeId: string, attempt: number) =>
            timeline.entries.find((entry) => entry.nodeId === nodeId && entry.attempt === attempt)!;

        expect(statuses(events)).toEqual({ Doomed: 'failed', P: 'caught', Slow: 'aborted' });
        expect(summarizeEntries(timeline)).toEqual(
            expect.arrayContaining(['Slow#1 failed', 'Slow#2 aborted', 'Doomed#1 failed'])
        );
        // The container failed because of Doomed, not because of Slow's earlier attempt.
        expect(overlay.states.P.error).toBe('Boom');
        expect(entryFor('P', 1).error).toBe('Boom');
        // The abandoned attempt never failed of its own, so it carries no error.
        expect(entryFor('Slow', 1).error).toBe('Flaky');
        expect(entryFor('Slow', 2).error).toBeUndefined();
        expect(overlay.states.Slow.error).toBe('Flaky');
    });

    it('keeps a failed inner container open when its abort lands after the outer failure', () => {
        const events = [
            event(1, 0, 'ExecutionStarted'),
            entered(2, 1, 'ParallelStateEntered', 'P1'),
            event(3, 2, 'ParallelStateStarted'),
            entered(4, 3, 'TaskStateEntered', 'Doomed'),
            taskFailed(5, 4, 'Boom'),
            entered(6, 3, 'ParallelStateEntered', 'P2'),
            event(7, 6, 'ParallelStateStarted'),
            entered(8, 7, 'TaskStateEntered', 'L'),
            taskFailed(9, 8, 'LeafBoom'),
            event(10, 9, 'ParallelStateFailed'),
            event(11, 5, 'ParallelStateFailed'),
            event(12, 10, 'ParallelStateAborted'),
            exited(13, 11, 'ParallelStateExited', 'P1'),
            event(14, 13, 'ExecutionSucceeded'),
        ];

        const overlay = parseExecutionHistory({ events });

        expect(statuses(events)).toEqual({ Doomed: 'failed', L: 'failed', P1: 'caught', P2: 'failed' });
        expect(overlay.states.P1.attempts).toBe(1);
    });

    describe('a redriven execution', () => {
        it('resumes a sibling the failure aborted', () => {
            const events = [
                event(1, 0, 'ExecutionStarted'),
                entered(2, 1, 'ParallelStateEntered', 'Fan'),
                event(3, 2, 'ParallelStateStarted'),
                entered(4, 3, 'TaskStateEntered', 'Slow'),
                entered(5, 3, 'TaskStateEntered', 'Doomed'),
                event(6, 4, 'TaskScheduled'),
                taskFailed(7, 5, 'Boom'),
                event(8, 7, 'ParallelStateFailed'),
                event(9, 8, 'ExecutionFailed', { executionFailedEventDetails: { error: 'Boom' } }),
                event(10, 9, 'ExecutionRedriven', { executionRedrivenEventDetails: { redriveCount: 1 } }),
                event(11, 4, 'TaskScheduled'),
                event(12, 11, 'TaskSucceeded'),
                exited(13, 12, 'TaskStateExited', 'Slow'),
                event(14, 5, 'TaskScheduled'),
                event(15, 14, 'TaskSucceeded'),
                exited(16, 15, 'TaskStateExited', 'Doomed'),
                exited(17, 16, 'ParallelStateExited', 'Fan'),
                event(18, 17, 'ExecutionSucceeded'),
            ];

            const overlay = parseExecutionHistory({ events });
            const timeline = buildExecutionTimeline({ events });

            expect(statuses(events)).toEqual({ Doomed: 'succeeded', Fan: 'succeeded', Slow: 'succeeded' });
            expect(summarizeEntries(timeline)).toEqual(expect.arrayContaining(['Slow#1 aborted', 'Slow#2 succeeded']));
            expect(overlay.states.Slow.attempts).toBe(2);
        });
    });

    describe('generateExecution', () => {
        it('reports the states a stopped execution abandoned as aborted', () => {
            const result = generateExecution({
                aslDefinition: fixture('redrive.asl.json'),
                history: fixture('execution-aborted.json'),
            });

            expect(result.metadata.aborted).toEqual(['Fan', 'Right']);
            expect(result.metadata.failed).toEqual([]);
            expect(result.svg).toContain('#cfd8dc');
        });
    });
});
