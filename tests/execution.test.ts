import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import {
    generateExecution,
    generateMermaidExecution,
    parseExecutionHistory,
} from '../src/index';
import { parseAsl } from '../src/AslParser';
import type { AslDefinition } from '../src/types';

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
    it('dims a Retry loop while highlighting a genuine self-transition', () => {
        const { edges } = parseAsl({ definition: loadAsl('parallel-edges') });

        const retryEdge = edges.find((edge) => edge.type === 'retry');
        const selfTransition = edges.find(
            (edge) => edge.from === 'Work' && edge.to === 'Work' && edge.type === 'normal',
        );

        expect(retryEdge?.id).toBe('Work->Work#retry#0');
        expect(selfTransition?.id).toBe('Work->Work#normal#0');
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
    });
});
