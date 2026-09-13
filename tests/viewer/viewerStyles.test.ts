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
            expect(css).toContain(
                '[data-sfn-viewer][data-sfn-interactive] { container: sfn-viewer / inline-size; }',
            );
        });

        it('declares the size container on interactive instances only', () => {
            const css = buildViewerStyles({});
            // A bare [data-sfn-viewer] rule with containment would collapse a
            // non-interactive element (an inline SVG sized by its content) in a
            // flex/grid/inline-block context.
            expect(css).not.toMatch(/\[data-sfn-viewer\] \{[^}]*container/);
        });

        it('hides the minimap while the bottom sheet covers it', () => {
            const css = buildViewerStyles({});
            const rule =
                '[data-sfn="panel"].sfn-open ~ [data-sfn="stage"] [data-sfn="minimap"] { display: none; }';
            expect(css.slice(css.indexOf('@media (max-width: 640px)'))).toContain(rule);
            expect(css.slice(css.indexOf('@container sfn-viewer (max-width: 640px)'))).toContain(rule);
            // Never outside compact mode - the side panel and the minimap don't overlap.
            expect(css.slice(0, css.indexOf('@media (max-width: 640px)'))).not.toContain(rule);
        });
    });
});
