import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateExecution, generateExecutionHtml, generateHtml } from '../src';
import { computeCollapsePlan, rollUpExecutionStatuses } from '../src/graph';
import { parseAsl } from '../src/AslParser';
import { renderCollapsedView } from '../src/renderers/viewer/relayout';
import type { RelayoutModel } from '../src/renderers/viewer/relayout';
import type { HistoryEvent } from '@aws-sdk/client-sfn';
import type { AslDefinition, ExecutionStateStatus } from '../src/types';

const loadAsl = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8')) as AslDefinition;
const loadHistoryJson = (name: string): string =>
    readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf-8');

const parallelAsl = loadAsl('parallel');
const partialFailure = loadHistoryJson('execution-parallel-partial-failure');

// Colours from src/graph/executionRollup.ts EXECUTION_COLORS.
const FAILED_FILL = '#ffcdd2';
const SUCCEEDED_FILL = '#c8e6c9';
const RUNNING_FILL = '#bbdefb';
const NOT_REACHED_FILL = '#f5f5f5';
// src/execution.ts TAKEN_EDGE_STYLE / UNTAKEN_EDGE_STYLE.
const TAKEN_STROKE = '#2e7d32';

/** A clean run of the `parallel` fixture: both branches succeed, FinalState is reached. */
const successEvents: HistoryEvent[] = [
    { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: new Date('2024-01-01T00:00:00.000Z') },
    { id: 2, previousEventId: 1, type: 'ParallelStateEntered', timestamp: new Date('2024-01-01T00:00:00.100Z'), stateEnteredEventDetails: { name: 'ParallelExecution' } },
    { id: 3, previousEventId: 2, type: 'TaskStateEntered', timestamp: new Date('2024-01-01T00:00:00.120Z'), stateEnteredEventDetails: { name: 'Branch1' } },
    { id: 4, previousEventId: 3, type: 'TaskStateExited', timestamp: new Date('2024-01-01T00:00:00.400Z'), stateExitedEventDetails: { name: 'Branch1' } },
    { id: 5, previousEventId: 2, type: 'TaskStateEntered', timestamp: new Date('2024-01-01T00:00:00.130Z'), stateEnteredEventDetails: { name: 'Branch2' } },
    { id: 6, previousEventId: 5, type: 'TaskStateExited', timestamp: new Date('2024-01-01T00:00:00.500Z'), stateExitedEventDetails: { name: 'Branch2' } },
    { id: 7, previousEventId: 6, type: 'ParallelStateExited', timestamp: new Date('2024-01-01T00:00:00.600Z'), stateExitedEventDetails: { name: 'ParallelExecution' } },
    { id: 8, previousEventId: 7, type: 'SucceedStateEntered', timestamp: new Date('2024-01-01T00:00:00.610Z'), stateEnteredEventDetails: { name: 'FinalState' } },
    { id: 9, previousEventId: 8, type: 'SucceedStateExited', timestamp: new Date('2024-01-01T00:00:00.620Z'), stateExitedEventDetails: { name: 'FinalState' } },
    { id: 10, previousEventId: 9, type: 'ExecutionSucceeded', timestamp: new Date('2024-01-01T00:00:00.630Z') },
];

/** The markup of one node's `<g>`, up to the first closing tag. */
function nodeMarkup(svg: string, stateId: string): string {
    const match = svg.match(new RegExp(`<g[^>]*data-state-id="${stateId}"[^>]*>[\\s\\S]*?</g>`));
    expect(match, `node ${stateId}`).not.toBeNull();
    return match![0];
}

/** The drawn (non hit-area) path of one edge; the id is attribute-escaped as the renderer writes it. */
function edgeMarkup(svg: string, edgeId: string): string {
    const escaped = edgeId.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    const drawn = paths.find(
        (path) => path.includes(`data-edge-id="${escaped}"`) && !path.includes('data-edge-hit-area'),
    );
    expect(drawn, `edge ${edgeId}`).toBeDefined();
    return drawn!;
}

describe('rollUpExecutionStatuses', () => {
    const { edges, nodes } = parseAsl({ definition: parallelAsl });
    const plan = computeCollapsePlan({ collapse: true, edges, nodes });
    const rollUp = (statusByNodeId: Record<string, ExecutionStateStatus>) =>
        rollUpExecutionStatuses({ nodes, plan, statusByNodeId }).ParallelExecution;

    it('reports a failure inside as failed, counting the failed states', () => {
        const result = rollUp({ Branch1: 'succeeded', Branch2: 'failed', ParallelExecution: 'failed' });
        expect(result.status).toBe('failed');
        expect(result.annotation).toBe('1/2 failed');
        expect(result.counts).toEqual({ caught: 0, failed: 1, notReached: 0, running: 0, succeeded: 1, total: 2 });
    });

    it('reports a state still running inside as running', () => {
        const result = rollUp({ Branch1: 'succeeded', Branch2: 'running', ParallelExecution: 'running' });
        expect(result.status).toBe('running');
        expect(result.annotation).toBe('1/2 running');
    });

    it('reports a clean run as succeeded with every state counted', () => {
        const result = rollUp({ Branch1: 'succeeded', Branch2: 'succeeded', ParallelExecution: 'succeeded' });
        expect(result.status).toBe('succeeded');
        expect(result.annotation).toBe('2/2 succeeded');
    });

    it('keeps the container\'s own caught outcome when nothing inside failed', () => {
        const result = rollUp({ Branch1: 'succeeded', Branch2: 'caught', ParallelExecution: 'caught' });
        expect(result.status).toBe('caught');
        expect(result.annotation).toBe('1/2 succeeded');
    });

    it('is notReached when nothing inside ran', () => {
        const result = rollUp({});
        expect(result.status).toBe('notReached');
        expect(result.annotation).toBe('0/2 ran');
    });

    it('does not count branch end markers as states', () => {
        const hidden = plan.hiddenIdsByTarget.get('ParallelExecution')!;
        expect(hidden.size).toBeGreaterThan(2); // the two tasks plus their end markers
        expect(rollUp({}).counts.total).toBe(2);
    });
});

describe('generateExecution with collapse', () => {
    it('colours the placeholder by the rolled-up status and summarises the states inside', () => {
        const { svg, metadata } = generateExecution({
            aslDefinition: parallelAsl,
            collapse: true,
            history: partialFailure,
        });

        expect(svg).not.toContain('data-state-id="Branch1"');
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        expect(placeholder).toContain(FAILED_FILL);
        expect(placeholder).toContain('1/2 failed');
        // The summary reports states, not placeholders: both branches are still listed.
        expect(metadata.failed).toContain('Branch2');
        expect(metadata.succeeded).toContain('Branch1');
        expect(metadata.executionStatus).toBe('failed');
    });

    it('keeps taken-edge highlighting on the placeholder\'s own edges', () => {
        const collapsed = generateExecution({ aslDefinition: parallelAsl, collapse: true, history: successEvents });
        const expanded = generateExecution({ aslDefinition: parallelAsl, history: successEvents });

        expect(nodeMarkup(collapsed.svg, 'ParallelExecution')).toContain(SUCCEEDED_FILL);
        expect(nodeMarkup(collapsed.svg, 'ParallelExecution')).toContain('2/2 succeeded');
        // The same edge id exists in both views: it was taken, and stays taken.
        expect(edgeMarkup(expanded.svg, 'ParallelExecution->FinalState#normal#0')).toContain(TAKEN_STROKE);
        expect(edgeMarkup(collapsed.svg, 'ParallelExecution->FinalState#normal#0')).toContain(TAKEN_STROKE);
    });

    it('greys a placeholder nothing ran inside and says so', () => {
        const unreached: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: new Date('2024-01-01T00:00:00.000Z') },
        ];
        const { svg } = generateExecution({ aslDefinition: parallelAsl, collapse: true, history: unreached });
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        expect(placeholder).toContain(NOT_REACHED_FILL);
        expect(placeholder).toContain('0/2 ran');
    });

    it('puts the container\'s own duration before the summary', () => {
        const { svg } = generateExecution({ aslDefinition: parallelAsl, collapse: true, history: successEvents });
        expect(nodeMarkup(svg, 'ParallelExecution')).toContain('500ms · 2/2 succeeded');
    });

    it('lets a caller annotation on the container win over the summary', () => {
        const { svg } = generateExecution({
            aslDefinition: parallelAsl,
            collapse: true,
            history: successEvents,
            nodeAnnotations: { ParallelExecution: 'mine' },
        });
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        expect(placeholder).toContain('>mine<');
        expect(placeholder).not.toContain('succeeded');
    });

    it("keeps the placeholder's sub-label and summary inside its box", () => {
        // Two lines stacked under the name: the layout grows the box for the second,
        // and the renderer centres the whole stack so the last line stays inside.
        const { svg } = generateExecution({ aslDefinition: parallelAsl, collapse: true, history: partialFailure });
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        const height = Number(placeholder.match(/<rect[^>]* height="([\d.]+)"/)![1]);
        const textYs = [...placeholder.matchAll(/<text[^>]* y="(-?[\d.]+)"/g)].map((match) => Number(match[1]));
        expect(textYs.length).toBe(3);
        const fontSize = 14;
        for (const y of textYs) {
            expect(y - fontSize / 2).toBeGreaterThanOrEqual(-height / 2);
            expect(y + fontSize / 2).toBeLessThanOrEqual(height / 2);
        }
    });

    it('leaves the expanded rendering unchanged when collapse is off', () => {
        const before = generateExecution({ aslDefinition: parallelAsl, history: partialFailure });
        expect(nodeMarkup(before.svg, 'Branch2')).toContain(FAILED_FILL);
        expect(before.svg).not.toContain('/2 ');
    });
});

describe('generateHtml with history collapses', () => {
    it('ships the relayout model and per-container controls for an execution overlay', () => {
        const { html } = generateHtml({ aslDefinition: parallelAsl, history: partialFailure });

        expect(html).toContain('data-sfn-collapse-toggle');
        expect(html).toContain('id="sfn-relayout-model"');
        expect(html).toMatch(/<g[^>]*data-sfn-collapse-target="ParallelExecution"/);
    });

    it('re-renders in the browser to exactly what generateExecution draws collapsed', () => {
        const { html } = generateHtml({ aslDefinition: parallelAsl, history: partialFailure });
        const match = html.match(
            /<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        const model = JSON.parse(match![1]) as RelayoutModel;
        expect(model.executionStatusByNodeId?.Branch2).toBe('failed');

        const collapsed = renderCollapsedView({ collapsedIds: model.collapseTargets, model });
        const reference = generateExecution({
            aslDefinition: parallelAsl,
            collapse: true,
            collapseControls: true,
            edgeHitAreas: true,
            history: partialFailure,
        });
        expect(collapsed.svg).toBe(reference.svg);
        expect(collapsed.svg).toContain('1/2 failed');
    });

    it('generateExecutionHtml gets the same document', () => {
        const wrapper = generateExecutionHtml({ aslDefinition: parallelAsl, history: partialFailure });
        const direct = generateHtml({ aslDefinition: parallelAsl, history: partialFailure });
        expect(wrapper.html).toBe(direct.html);
    });

    it('composes with a diff: a placeholder hiding a change that never ran stays amber', () => {
        const before: AslDefinition = {
            ...parallelAsl,
            States: {
                ...parallelAsl.States,
                ParallelExecution: {
                    ...parallelAsl.States.ParallelExecution,
                    Branches: [
                        parallelAsl.States.ParallelExecution.Branches![0],
                        {
                            StartAt: 'Branch2',
                            States: { Branch2: { Type: 'Task', Resource: 'arn:old', End: true } },
                        },
                    ],
                },
            },
        };
        const unreached: HistoryEvent[] = [
            { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: new Date('2024-01-01T00:00:00.000Z') },
        ];
        const { html } = generateHtml({ aslDefinition: parallelAsl, diff: { before }, history: unreached });
        const model = JSON.parse(
            html.match(/<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/)![1],
        ) as RelayoutModel;

        const { svg } = renderCollapsedView({ collapsedIds: model.collapseTargets, model });
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        expect(placeholder).toContain('#fff9c4'); // DIFF_COLORS.modified
        expect(placeholder).not.toContain(NOT_REACHED_FILL);
        expect(placeholder).toContain('1 changed inside · 0/2 ran');
    });

    it('composes with a diff: a placeholder that ran takes the execution colour', () => {
        const before: AslDefinition = {
            ...parallelAsl,
            States: {
                ...parallelAsl.States,
                ParallelExecution: {
                    ...parallelAsl.States.ParallelExecution,
                    Branches: [
                        parallelAsl.States.ParallelExecution.Branches![0],
                        {
                            StartAt: 'Branch2',
                            States: { Branch2: { Type: 'Task', Resource: 'arn:old', End: true } },
                        },
                    ],
                },
            },
        };
        const { html } = generateHtml({ aslDefinition: parallelAsl, diff: { before }, history: successEvents });
        const model = JSON.parse(
            html.match(/<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/)![1],
        ) as RelayoutModel;

        const { svg } = renderCollapsedView({ collapsedIds: model.collapseTargets, model });
        const placeholder = nodeMarkup(svg, 'ParallelExecution');
        expect(placeholder).toContain(SUCCEEDED_FILL);
        expect(placeholder).toContain('modified · 500ms · 1 changed inside · 2/2 succeeded');
        expect(placeholder).not.toContain(RUNNING_FILL);
    });
});
