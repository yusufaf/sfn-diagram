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
        Legacy: { Type: 'Pass', End: true },
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

    it('ships the expanded view only, with no collapse toggle, even with a container', () => {
        const plain = generateHtml({ aslDefinition: parallelAsl });
        const overlaid = generateHtml({
            aslDefinition: parallelAsl,
            history: loadHistoryJson('execution-parallel-edges'),
        });

        expect(plain.html).toContain('data-sfn-collapse-toggle');
        expect(overlaid.html).not.toContain('data-sfn-collapse-toggle');
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

    it('serves the removed state to the detail panel too', () => {
        const { html } = generateHtml({ aslDefinition: choiceAsl, diff: { before: choiceBefore } });
        const match = html.match(
            /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/,
        );
        expect(match).not.toBeNull();
        expect(JSON.parse(match![1])).toHaveProperty('Legacy');
    });

    it('collapses like a plain diagram, annotating only the collapsed placeholder', () => {
        const { html } = generateHtml({
            aslDefinition: loadAsl('diff-nested-after'),
            collapse: true,
            diff: { before: loadAsl('diff-nested-before') },
        });

        expect(html).toContain('data-sfn-collapse-toggle');
        const collapsedStart = html.indexOf('<div data-sfn-view="collapsed"');
        expect(collapsedStart).toBeGreaterThan(0);
        // The change is visible in the expanded view, so only the collapsed view
        // carries the "hidden inside" annotation.
        expect(html.slice(0, collapsedStart)).not.toContain('changed inside');
        expect(html.slice(collapsedStart)).toContain('3 changed inside');
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

    it('reports both summaries', () => {
        expect(both.metadata.diff?.modified).toEqual(['HighValue']);
        expect(both.metadata.diff?.removed).toEqual(['Legacy']);
        expect(both.metadata.execution?.succeeded).toContain('HighValue');
        expect(both.metadata.execution?.notReached).toContain('Legacy');
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
