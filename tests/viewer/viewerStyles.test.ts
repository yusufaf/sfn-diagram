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

    describe('motion', () => {
        it('declares the duration and easing tokens', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '--sfn-motion-fast: 120ms; --sfn-motion-base: 180ms;\n    --sfn-motion-ease: cubic-bezier(.2, 0, 0, 1);',
            );
        });

        it('reaches the standalone document from :root, which has no viewer element', () => {
            // The standalone document's chrome hangs off <body>, so tokens declared on
            // [data-sfn-viewer] alone would never reach it.
            expect(buildViewerStyles({ scope: 'document' })).toContain(
                ':root, [data-sfn-viewer] { --sfn-motion-fast:',
            );
        });

        it('stays inside an embedded element, which must not touch the host page root', () => {
            const css = buildViewerStyles({ scope: 'element' });
            expect(css).toContain('[data-sfn-viewer] { --sfn-motion-fast:');
            expect(css).not.toContain(':root, [data-sfn-viewer]');
        });

        it('zeroes the durations for viewers who asked for reduced motion', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '@media (prefers-reduced-motion: reduce) {\n    :root, [data-sfn-viewer] { --sfn-motion-fast: 0ms; --sfn-motion-base: 0ms; }',
            );
            // The override has to follow the declaration to win the cascade.
            expect(css.indexOf('--sfn-motion-fast: 0ms')).toBeGreaterThan(
                css.indexOf('--sfn-motion-fast: 120ms'),
            );
        });

        it('hides the closed panel with visibility, so the opening transition has a start value', () => {
            const css = buildViewerStyles({});
            expect(css).toContain('visibility: hidden; opacity: 0; pointer-events: none;');
            expect(css).toContain(
                '[data-sfn="panel"].sfn-open { visibility: visible; opacity: 1; pointer-events: auto;',
            );
            // Stepped, so it is delayed out and immediate in - never interpolated.
            expect(css).toContain('visibility 0s linear var(--sfn-motion-base); }');
            // display: none would give the transition nothing to interpolate from.
            expect(css).not.toContain('[data-sfn="panel"].sfn-open { display: flex; }');
        });

        it('collapses the minimap the same way, leaving display: none to the compact sheet', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '[data-sfn="minimap"].sfn-minimap-collapsed { visibility: hidden; opacity: 0; pointer-events: none;',
            );
            expect(css).toContain('visibility 0s linear var(--sfn-motion-fast); }');
            expect(css).not.toContain('[data-sfn="minimap"].sfn-minimap-collapsed { display: none; }');
        });

        it('never moves or resizes the panel, whose geometry is read on the same tick', () => {
            const css = buildViewerStyles({});
            const panelRule = css.slice(
                css.indexOf('[data-sfn="panel"] { position: absolute'),
                css.indexOf('[data-sfn="panel-head"]'),
            );
            expect(panelRule).not.toContain('transform');
            expect(panelRule).not.toContain('width var(--sfn-motion');
        });

        it('fades the search dim rather than snapping it', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                '[data-state-id] { cursor: pointer; transition: opacity var(--sfn-motion-fast) var(--sfn-motion-ease); }',
            );
        });

        it('drives the playback repaint off the same tokens instead of its own duration', () => {
            const css = buildViewerStyles({});
            expect(css).toContain(
                'transition: fill var(--sfn-motion-base) var(--sfn-motion-ease),\n      stroke var(--sfn-motion-base) var(--sfn-motion-ease);',
            );
            expect(css).not.toContain('transition: fill .18s ease, stroke .18s ease;');
        });

        it('keeps the active-state pulse behind a media query, since a 0ms loop is not "off"', () => {
            const css = buildViewerStyles({});
            const guarded = css.slice(css.indexOf('@media not (prefers-reduced-motion: reduce)'));
            expect(guarded).toContain('animation: sfn-exec-pulse 1.1s ease-in-out infinite;');
            expect(guarded).toContain('@keyframes sfn-exec-pulse { 50% { stroke-width: 4; } }');
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
