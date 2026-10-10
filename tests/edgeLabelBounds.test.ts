import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { mergeOptions } from '../src/config';
import { DagreLayout } from '../src/layout';
import { buildDiagramGraph } from '../src/pipeline';
import { SvgRenderer } from '../src/renderers/SvgRenderer';
import type { AslDefinition, DiagramOptions } from '../src/types';

interface Box {
    height: number;
    width: number;
    x: number;
    y: number;
}

const LABEL_RECT_PATTERN =
    /<rect x="([\d.e-]+)" y="([\d.e-]+)" width="([\d.e-]+)" height="([\d.e-]+)"[^>]*rx="3"/g;
const OVERLAP_TOLERANCE = 0.5;

const definition = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'long-condition.asl.json'), 'utf-8'),
) as AslDefinition;

function overlaps(first: Box, second: Box): boolean {
    return (
        first.x < second.x + second.width - OVERLAP_TOLERANCE &&
        first.x + first.width > second.x + OVERLAP_TOLERANCE &&
        first.y < second.y + second.height - OVERLAP_TOLERANCE &&
        first.y + first.height > second.y + OVERLAP_TOLERANCE
    );
}

interface RenderLabelBoxesParams {
    edgeStyle: NonNullable<DiagramOptions['edgeStyle']>;
    layout: 'LR' | 'TB';
}

function renderLabelBoxes(params: RenderLabelBoxesParams): { labels: Box[]; nodes: Box[] } {
    const options = mergeOptions({ edgeStyle: params.edgeStyle, layout: params.layout });
    const { edges, nodes } = buildDiagramGraph({ definition, options });
    const layout = new DagreLayout(options).calculate(nodes, edges);
    const markup = new SvgRenderer(options).render(layout).svg;
    const labels = [...markup.matchAll(LABEL_RECT_PATTERN)].map((match) => ({
        height: Number(match[4]),
        width: Number(match[3]),
        x: Number(match[1]),
        y: Number(match[2]),
    }));
    const leafNodes = layout.nodes
        .filter((node) => !node.children?.length)
        .map((node) => ({
            height: node.height ?? 0,
            width: node.width ?? 0,
            x: (node.x ?? 0) - (node.width ?? 0) / 2,
            y: (node.y ?? 0) - (node.height ?? 0) / 2,
        }));
    return { labels, nodes: leafNodes };
}

describe('Edge label bounds (#369)', () => {
    const cases = (['TB', 'LR'] as const).flatMap((layout) =>
        (['curved', 'orthogonal'] as const).map((edgeStyle) => ({ edgeStyle, layout })),
    );

    test.each(cases)('labels clear every node and each other ($layout, $edgeStyle)', (testCase) => {
        const { labels, nodes } = renderLabelBoxes(testCase);

        // One label per Choice rule plus the Default edge.
        expect(labels).toHaveLength(3);
        for (const label of labels) {
            for (const node of nodes) {
                expect(overlaps(label, node), `label ${JSON.stringify(label)} on node`).toBe(false);
            }
        }
        for (let first = 0; first < labels.length; first++) {
            for (let second = first + 1; second < labels.length; second++) {
                expect(
                    overlaps(labels[first], labels[second]),
                    `label ${first} on label ${second}`,
                ).toBe(false);
            }
        }
    });
});
