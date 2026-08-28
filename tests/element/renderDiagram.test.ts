import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { renderDiagramString } from '../../src/element/renderDiagram';
import type { AslDefinition } from '../../src/types';

const asl: AslDefinition = {
    StartAt: 'A',
    States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
};

const loadHistory = (): string =>
    readFileSync(join(__dirname, '../fixtures/execution-success.json'), 'utf-8');

describe('renderDiagramString', () => {
    it('renders SVG by default', () => {
        const result = renderDiagramString({ asl });
        expect(result.type).toBe('svg');
        if (result.type === 'svg') {
            expect(result.svg).toContain('<svg');
            expect(result.nodeCount).toBe(2);
        }
    });

    it('accepts a JSON string definition', () => {
        const result = renderDiagramString({ asl: JSON.stringify(asl) });
        expect(result.type).toBe('svg');
        if (result.type === 'svg') expect(result.svg).toContain('data-state-id="A"');
    });

    it('renders Mermaid code when format is mermaid', () => {
        const result = renderDiagramString({ asl, format: 'mermaid' });
        expect(result.type).toBe('mermaid');
        if (result.type === 'mermaid') expect(result.code).toContain('stateDiagram-v2');
    });

    it('renders an SVG execution overlay when history is supplied', () => {
        const result = renderDiagramString({ asl, history: loadHistory() });
        expect(result.type).toBe('svg');
        if (result.type === 'svg') expect(result.svg).toContain('data-state-id');
    });

    it('renders a Mermaid execution overlay when format is mermaid and history is supplied', () => {
        const result = renderDiagramString({ asl, format: 'mermaid', history: loadHistory() });
        expect(result.type).toBe('mermaid');
        if (result.type === 'mermaid') expect(result.code).toContain('stateDiagram-v2');
    });

    it('respects layout and theme', () => {
        const result = renderDiagramString({ asl, layout: 'LR', theme: 'dark' });
        expect(result.type).toBe('svg');
    });

    it('throws on invalid ASL', () => {
        expect(() => renderDiagramString({ asl: { StartAt: 'Missing', States: {} } })).toThrow();
    });

    it('throws on malformed JSON', () => {
        expect(() => renderDiagramString({ asl: '{not json' })).toThrow();
    });
});
