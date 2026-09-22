import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    generateDiff,
    generateExecution,
    generateExecutionHtml,
    generateExecutionHtmlAsync,
    generateHtml,
    generateHtmlAsync,
} from '../src';
import { renderCollapsedView } from '../src/renderers/viewer/relayout';
import type { RelayoutModel } from '../src/renderers/viewer/relayout';
import type { AslDefinition } from '../src/types';

const loadAsl = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8')) as AslDefinition;
const loadHistoryJson = (name: string): string =>
    readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf-8');

const choiceAsl = loadAsl('choice');
const choiceHistory = loadHistoryJson('execution-choice-highvalue');
const parallelAsl = loadAsl('parallel');

/**
 * `before` differs from the `choice` fixture in two ways: `HighValue` (which the
 * history shows ran) carries a different Comment, so it is `modified`; `Legacy` only
 * exists here, so it is `removed` — and, never having run, `notReached`.
 */
const choiceBefore: AslDefinition = {
    ...choiceAsl,
    States: {
        ...choiceAsl.States,
        HighValue: { ...choiceAsl.States.HighValue, Comment: 'the old high-value branch' },
        Legacy: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:legacy',
            Retry: [{ ErrorEquals: ['States.ALL'], MaxAttempts: 2 }],
            End: true,
        },
    },
};

// Colours from src/diff.ts DIFF_COLORS and src/execution.ts EXECUTION_COLORS.
const DIFF_MODIFIED_FILL = '#fff9c4';
const DIFF_REMOVED_FILL = '#ffcdd2';
const EXECUTION_SUCCEEDED_FILL = '#c8e6c9';
const EXECUTION_NOT_REACHED_FILL = '#f5f5f5';

/** The markup of one state's `<g>` in the expanded view, up to its closing tag. */
function nodeMarkup(html: string, stateId: string): string {
    const match = html.match(
        new RegExp(`<g[^>]*data-state-id="${stateId}"[^>]*>[\\s\\S]*?</g>`),
    );
    expect(match, `node ${stateId}`).not.toBeNull();
    return match![0];
}

describe('generateHtml with a history overlay', () => {
    it('produces exactly what generateExecutionHtml does', () => {
        const direct = generateHtml({ aslDefinition: choiceAsl, history: choiceHistory });
        const wrapper = generateExecutionHtml({ aslDefinition: choiceAsl, history: choiceHistory });

        expect(direct.html).toBe(wrapper.html);
        expect(direct.height).toBe(wrapper.height);
        expect(direct.width).toBe(wrapper.width);
    });

    it('reports the execution summary under metadata.execution', () => {
        const { metadata } = generateHtml({ aslDefinition: choiceAsl, history: choiceHistory });
        const svgResult = generateExecution({ aslDefinition: choiceAsl, history: choiceHistory });
        const { edgeCount, nodeCount, ...summary } = svgResult.metadata;

        expect(metadata.execution).toEqual(summary);
        expect(metadata.edgeCount).toBe(edgeCount);
        expect(metadata.nodeCount).toBe(nodeCount);
        expect(metadata.diff).toBeUndefined();
    });

    it('keeps generateExecutionHtml reporting the flat metadata shape it always has', () => {
        const wrapper = generateExecutionHtml({ aslDefinition: choiceAsl, history: choiceHistory });
        const svgResult = generateExecution({ aslDefinition: choiceAsl, history: choiceHistory });

        expect(wrapper.metadata).toEqual(svgResult.metadata);
        expect(wrapper.metadata).not.toHaveProperty('execution');
    });

    it('collapses like a plain diagram: one view, controls, model and toggle', () => {
        const overlaid = generateHtml({
            aslDefinition: parallelAsl,
            history: loadHistoryJson('execution-parallel-partial-failure'),
        });

        expect(overlaid.html).toContain('data-sfn-collapse-toggle');
        expect(overlaid.html).toContain('id="sfn-relayout-model"');
        expect(overlaid.html).toMatch(/<g[^>]*data-sfn-collapse-target="ParallelExecution"/);
        expect(overlaid.html).not.toMatch(/<div data-sfn-view=/);
    });

    it('generateHtmlAsync matches generateExecutionHtmlAsync', async () => {
        const direct = await generateHtmlAsync({ aslDefinition: choiceAsl, history: choiceHistory });
        const wrapper = await generateExecutionHtmlAsync({
            aslDefinition: choiceAsl,
            history: choiceHistory,
        });

        expect(direct.html).toBe(wrapper.html);
        expect(wrapper.metadata).toEqual({
            ...direct.metadata.execution,
            edgeCount: direct.metadata.edgeCount,
            nodeCount: direct.metadata.nodeCount,
        });
    });
});

describe('generateHtml with a diff overlay', () => {
    it('draws the merged definition with diff colouring and keeps removed states', () => {
        const { html, metadata } = generateHtml({
            aslDefinition: choiceAsl,
            diff: { before: choiceBefore },
        });
        const svgResult = generateDiff({ after: choiceAsl, before: choiceBefore });

        expect(nodeMarkup(html, 'HighValue')).toContain(DIFF_MODIFIED_FILL);
        expect(nodeMarkup(html, 'Legacy')).toContain(DIFF_REMOVED_FILL);
        expect(metadata.diff).toEqual({
            added: svgResult.metadata.added,
            modified: svgResult.metadata.modified,
            removed: svgResult.metadata.removed,
            unchanged: svgResult.metadata.unchanged,
        });
        expect(metadata.execution).toBeUndefined();
    });

    it('serves the removed state to the detail panel with its real ASL, not the orphan stub', () => {
        const { html } = generateHtml({ aslDefinition: choiceAsl, diff: { before: choiceBefore } });
        const match = html.match(
            /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        const stateData = JSON.parse(match![1]) as Record<string, unknown>;
        expect(stateData.Legacy).toEqual(choiceBefore.States.Legacy);
        // The states that survived still come from the after definition.
        expect(stateData.HighValue).toEqual(choiceAsl.States.HighValue);
    });

    it('collapses like a plain diagram, annotating only a collapsed placeholder', () => {
        const after = loadAsl('diff-nested-after');
        const before = loadAsl('diff-nested-before');
        const { html } = generateHtml({ aslDefinition: after, collapse: true, diff: { before } });

        expect(html).toContain('data-sfn-collapse-toggle');
        // The change is visible in the expanded view, so it carries no "hidden
        // inside" annotation; the relayout model knows which ids count as changes.
        // (The inlined relayout bundle carries the phrase as source, so only the
        // rendered SVG is checked.)
        const svgStart = html.indexOf('<svg');
        const svgEnd = html.indexOf('</svg>');
        expect(html.slice(svgStart, svgEnd)).not.toContain('changed inside');
        const match = html.match(
            /<script type="application\/json" id="sfn-relayout-model">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        const model = JSON.parse(match![1]) as RelayoutModel;
        expect(model.diffChangedIds).toBeDefined();

        // Collapsed in the browser, the placeholders annotate exactly as generateDiff does.
        const collapsed = renderCollapsedView({ collapsedIds: model.collapseTargets, model });
        expect(collapsed.svg).toContain('3 changed inside');
        expect(collapsed.svg).toContain('1 changed inside');
        const reference = generateDiff({
            after,
            before,
            collapse: true,
            collapseControls: true,
            edgeHitAreas: true,
        });
        expect(collapsed.svg).toBe(reference.svg);
    });
});

describe('generateHtml with both overlays', () => {
    const both = generateHtml({
        aslDefinition: choiceAsl,
        diff: { before: choiceBefore },
        history: choiceHistory,
    });

    it('lets the execution colour a changed state that ran, and says so in its annotation', () => {
        const highValue = nodeMarkup(both.html, 'HighValue');
        expect(highValue).toContain(EXECUTION_SUCCEEDED_FILL);
        expect(highValue).not.toContain(DIFF_MODIFIED_FILL);
        expect(highValue).toMatch(/modified · \d+ms/);
    });

    it('keeps the diff colour on a changed state the execution never reached', () => {
        const legacy = nodeMarkup(both.html, 'Legacy');
        expect(legacy).toContain(DIFF_REMOVED_FILL);
        expect(legacy).not.toContain(EXECUTION_NOT_REACHED_FILL);
    });

    it('greys an unchanged state the execution never reached', () => {
        expect(nodeMarkup(both.html, 'LowValue')).toContain(EXECUTION_NOT_REACHED_FILL);
    });

    it('still dims the untaken edges', () => {
        expect(both.html).toContain('stroke-opacity="0.2"');
    });

    it('reports both summaries, with the execution summary scoped to the after definition', () => {
        expect(both.metadata.diff?.modified).toEqual(['HighValue']);
        expect(both.metadata.diff?.removed).toEqual(['Legacy']);
        expect(both.metadata.execution?.succeeded).toContain('HighValue');
        expect(both.metadata.execution?.notReached).toContain('LowValue');
        // A removed state was never part of the machine that ran.
        expect(both.metadata.execution?.notReached).not.toContain('Legacy');
        // Same summary a plain execution overlay of the after definition reports.
        const { edgeCount, nodeCount, ...plainSummary } = generateExecution({
            aslDefinition: choiceAsl,
            history: choiceHistory,
        }).metadata;
        expect(both.metadata.execution).toEqual(plainSummary);
        expect(both.metadata.nodeCount).toBe(nodeCount + 1); // the removed orphan
        expect(both.metadata.edgeCount).toBeGreaterThanOrEqual(edgeCount);
    });

    it('keeps the diff status in the annotation of a changed state that ran but has no duration', () => {
        // `HighValue` is entered but never exited: still running, so no duration or
        // retry count to annotate — the diff status must still be shown.
        const truncated = JSON.stringify({
            events: (JSON.parse(choiceHistory) as { events: { type: string }[] }).events.filter(
                (event) => event.type !== 'PassStateExited' && event.type !== 'SucceedStateEntered',
            ),
        });
        const { html, metadata } = generateHtml({
            aslDefinition: choiceAsl,
            diff: { before: choiceBefore },
            history: truncated,
        });

        expect(metadata.execution?.running).toContain('HighValue');
        const highValue = nodeMarkup(html, 'HighValue');
        expect(highValue).toContain('>modified<');
        expect(highValue).not.toContain(DIFF_MODIFIED_FILL);
    });

    it('lets a caller override win over both overlays', () => {
        const { html } = generateHtml({
            aslDefinition: choiceAsl,
            diff: { before: choiceBefore },
            history: choiceHistory,
            nodeAnnotations: { HighValue: 'mine' },
            nodeOverrides: { Legacy: { fill: '#123456' } },
        });

        expect(nodeMarkup(html, 'Legacy')).toContain('#123456');
        expect(nodeMarkup(html, 'HighValue')).toContain('>mine<');
        expect(nodeMarkup(html, 'HighValue')).not.toContain('modified');
    });
});
