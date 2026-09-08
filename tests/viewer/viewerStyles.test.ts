import { describe, it, expect } from 'vitest';
import { buildViewerStyles } from '../../src/renderers/viewer';

describe('buildViewerStyles', () => {
    describe('focus styling', () => {
        it('gives toolbar buttons and the panel close button a visible focus ring', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '[data-sfn="toolbar"] button:focus-visible, [data-sfn="panel-close"]:focus-visible { outline: 2px solid #0972d3; outline-offset: 1px; }',
            );
        });

        it('outlines the drawn shape of a focused node, skipping the invisible title', () => {
            const css = buildViewerStyles({});
            expect(css).toContain('[data-state-id]:focus-visible { outline: none; }');
            expect(css).toContain(
                '[data-state-id]:focus-visible > title + * { outline: 3px solid #0972d3; }',
            );
        });

        it('restyles the stroke of a focused edge hit area instead of an outline', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '[data-edge-hit-area]:focus-visible { outline: none; stroke: #0972d3; stroke-opacity: .4; }',
            );
        });

        it('suppresses the outline on the programmatically-focused panel', () => {
            const css = buildViewerStyles({});
            expect(css).toContain('[data-sfn="panel"]:focus { outline: none; }');
        });

        it('uses the dark palette accent under the dark theme', () => {
            const css = buildViewerStyles({ theme: 'dark' });
            expect(css).toContain('outline: 2px solid #539fe5; outline-offset: 1px;');
        });
    });
});
