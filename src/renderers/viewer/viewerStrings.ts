/**
 * Every user-visible word in the viewer shell, gathered for a later localisation
 * option. Values are plain text and are interpolated unescaped.
 */
export interface ViewerStrings {
    /** Collapse toggle button text. */
    collapseButton: string;
    /** Collapse toggle tooltip. */
    collapseTitle: string;
    /** Copy-as-Mermaid button text. */
    copyMermaidButton: string;
    /** Copy-as-Mermaid tooltip. */
    copyMermaidTitle: string;
    /** Document `<title>` when the diagram has none. */
    documentTitle: string;
    /** Download-as-PNG button text. */
    exportPngButton: string;
    /** Download-as-PNG tooltip. */
    exportPngTitle: string;
    /** Download-as-SVG button text. */
    exportSvgButton: string;
    /** Download-as-SVG tooltip. */
    exportSvgTitle: string;
    /** Document `lang` attribute. */
    lang: string;
    /** Minimap toggle button text. */
    minimapButton: string;
    /** Minimap toggle tooltip. */
    minimapTitle: string;
    /** Detail panel close button accessible name. */
    panelCloseLabel: string;
    /** Detail panel close button tooltip. */
    panelCloseTitle: string;
    /** Playback next-step button accessible name. */
    playbackNextLabel: string;
    /** Playback next-step button tooltip. */
    playbackNextTitle: string;
    /** Playback play/pause button accessible name. */
    playbackPlayLabel: string;
    /** Playback play/pause button tooltip. */
    playbackPlayTitle: string;
    /** Playback previous-step button accessible name. */
    playbackPrevLabel: string;
    /** Playback previous-step button tooltip. */
    playbackPrevTitle: string;
    /** Real-time proportional playback button text. */
    playbackProportionalButton: string;
    /** Real-time proportional playback tooltip. */
    playbackProportionalTitle: string;
    /** Playback scrubber accessible name. */
    playbackScrubLabel: string;
    /** 16x speed tooltip. */
    playbackSpeed16Title: string;
    /** 4x speed tooltip. */
    playbackSpeed4Title: string;
    /** Jump-to-end speed button text. */
    playbackSpeedInstantButton: string;
    /** Jump-to-end speed tooltip. */
    playbackSpeedInstantTitle: string;
    /** Normal speed tooltip. */
    playbackSpeedNormalTitle: string;
    /** Search field accessible name. */
    searchLabel: string;
    /** Search field placeholder. */
    searchPlaceholder: string;
    /** Zoom-to-fit button text. */
    zoomFitButton: string;
    /** Zoom-to-fit tooltip. */
    zoomFitTitle: string;
    /** Zoom-in button accessible name. */
    zoomInLabel: string;
    /** Zoom-in tooltip. */
    zoomInTitle: string;
    /** Zoom-out button accessible name. */
    zoomOutLabel: string;
    /** Zoom-out tooltip. */
    zoomOutTitle: string;
    /** Reset-zoom button text. */
    zoomResetButton: string;
    /** Reset-zoom tooltip. */
    zoomResetTitle: string;
}

/** The viewer shell's English strings. */
export const VIEWER_STRINGS: ViewerStrings = {
    collapseButton: 'Collapse',
    collapseTitle: 'Toggle collapsed containers',
    copyMermaidButton: 'Mermaid',
    copyMermaidTitle: 'Copy this diagram as Mermaid source',
    documentTitle: 'sfn-diagram',
    exportPngButton: 'PNG',
    exportPngTitle: 'Download this diagram as a PNG image',
    exportSvgButton: 'SVG',
    exportSvgTitle: 'Download this diagram as an SVG file',
    lang: 'en',
    minimapButton: 'Map',
    minimapTitle: 'Toggle minimap (m)',
    panelCloseLabel: 'Close details',
    panelCloseTitle: 'Close (Esc)',
    playbackNextLabel: 'Next step',
    playbackNextTitle: 'Next step (Right arrow)',
    playbackPlayLabel: 'Play',
    playbackPlayTitle: 'Play / pause (Space)',
    playbackPrevLabel: 'Previous step',
    playbackPrevTitle: 'Previous step (Left arrow)',
    playbackProportionalButton: 'Real',
    playbackProportionalTitle: 'Play in real-time proportions instead of compressed',
    playbackScrubLabel: 'Playback position',
    playbackSpeed16Title: '16x speed',
    playbackSpeed4Title: '4x speed',
    playbackSpeedInstantButton: 'Instant',
    playbackSpeedInstantTitle: 'Jump to the end',
    playbackSpeedNormalTitle: 'Normal speed',
    searchLabel: 'Search states',
    searchPlaceholder: 'Search states (/)',
    zoomFitButton: 'Fit',
    zoomFitTitle: 'Zoom to fit',
    zoomInLabel: 'Zoom in',
    zoomInTitle: 'Zoom in',
    zoomOutLabel: 'Zoom out',
    zoomOutTitle: 'Zoom out',
    zoomResetButton: 'Reset',
    zoomResetTitle: 'Reset',
};
