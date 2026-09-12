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

    describe('responsive detail panel', () => {
        it('keeps the 360px side panel that shrinks the stage as the default', () => {
            const css = buildViewerStyles({});
            expect(css).toContain('[data-sfn="panel"].sfn-open ~ [data-sfn="stage"] { right: 360px; }');
        });

        it('drops to a bottom sheet over an unshrunk stage below the breakpoint, for both the document and an embedded element', () => {
            const css = buildViewerStyles({});
            const compactRules = [
                '[data-sfn="panel"] { top: auto; left: 0; width: auto; max-height: 60%; border-left: 0;',
                '[data-sfn="panel"].sfn-open ~ [data-sfn="stage"] { right: 0; }',
            ];
            const mediaBlock = css.slice(css.indexOf('@media (max-width: 640px)'));
            const containerBlock = css.slice(css.indexOf('@container sfn-viewer (max-width: 640px)'));
            for (const rule of compactRules) {
                expect(mediaBlock).toContain(rule);
                expect(containerBlock).toContain(rule);
            }
            expect(css).toContain('[data-sfn-viewer] { container: sfn-viewer / inline-size; }');
        });
    });
});
