/// <reference lib="dom" />
import { collectStateData } from '../renderers/viewer/stateData';
import { attachViewer, type ViewerHandle } from '../renderers/viewer/viewerController';
import { buildViewerBody } from '../renderers/viewer/viewerShell';
import { buildViewerStyles, resolveViewerTheme } from '../renderers/viewer/viewerStyles';
import { renderDiagramString } from './renderDiagram';
import type { AslDefinition, AslState, ExecutionHistoryInput, LayoutDirection, ThemeOption } from '../types';

/** Node count at or below which the minimap starts collapsed, matching the standalone viewer. */
const MINIMAP_AUTO_VISIBLE_THRESHOLD = 25;

const OBSERVED_ATTRIBUTES = ['definition', 'format', 'layout', 'theme', 'interactive'] as const;

/** One `<style>` per chrome theme, injected into `document.head` at most once each. */
const injectedStyleThemes = new Set<string>();

function ensureViewerStylesInjected(theme: 'dark' | 'light'): void {
    if (injectedStyleThemes.has(theme)) return;
    const style = document.createElement('style');
    style.setAttribute('data-sfn-viewer-styles', theme);
    style.textContent = buildViewerStyles({ scope: 'element', theme });
    document.head.appendChild(style);
    injectedStyleThemes.add(theme);
}

function parseAsl(source: AslDefinition | string): AslDefinition {
    return typeof source === 'string' ? (JSON.parse(source) as AslDefinition) : source;
}

/**
 * `<sfn-diagram>` — a framework-agnostic custom element rendering an AWS Step
 * Functions ASL definition as an SVG or Mermaid diagram, with an optional
 * interactive viewer (pan/zoom, search, minimap, click-a-state detail panel).
 *
 * Renders in light DOM (no shadow root), so page CSS reaches the SVG and the
 * element degrades to plain server-rendered markup: give it a pre-rendered
 * `<svg>` child (from `generateSvg()` run at build/server time) and omit
 * `definition` entirely for a zero-client-JS diagram; setting `interactive`
 * on top still upgrades that markup with pan/zoom/search.
 *
 * Register it with {@link defineSfnDiagram} (imported from `sfn-diagram/element`),
 * or rely on that module's auto-registration side effect.
 *
 * @example
 * ```html
 * <script type="module" src="sfn-diagram/element"></script>
 * <sfn-diagram interactive theme="dark"></sfn-diagram>
 * <script type="module">
 *   document.querySelector('sfn-diagram').definition = myAslDefinition;
 * </script>
 * ```
 *
 * @example
 * ```typescript
 * import { SfnDiagramElement } from 'sfn-diagram/element';
 * customElements.define('sfn-diagram', SfnDiagramElement);
 * ```
 *
 * @customElement sfn-diagram
 * @fires sfn-error - `CustomEvent<Error>`, bubbles and composes across shadow
 *   boundaries. Dispatched when `definition` fails to parse or fails ASL
 *   validation; the element renders nothing when this fires.
 */
export class SfnDiagramElement extends HTMLElement {
    static readonly observedAttributes: readonly string[] = OBSERVED_ATTRIBUTES;

    #customTheme: ThemeOption | undefined;
    #definitionSource: AslDefinition | string | undefined;
    #history: ExecutionHistoryInput | undefined;
    #renderScheduled = false;
    #viewerHandle: ViewerHandle | undefined;

    /** ASL definition as an object or JSON string. Property-set values are not reflected to the `definition` attribute. */
    get definition(): AslDefinition | string | undefined {
        return this.#definitionSource;
    }

    set definition(value: AslDefinition | string | undefined) {
        this.#definitionSource = value;
        this.#scheduleRender();
    }

    /** Optional execution history overlay. Property-only — objects don't survive an attribute round-trip. */
    get history(): ExecutionHistoryInput | undefined {
        return this.#history;
    }

    set history(value: ExecutionHistoryInput | undefined) {
        this.#history = value;
        this.#scheduleRender();
    }

    /** `'svg'` (default) or `'mermaid'`. Reflected to/from the `format` attribute. */
    get format(): 'mermaid' | 'svg' {
        return this.getAttribute('format') === 'mermaid' ? 'mermaid' : 'svg';
    }

    set format(value: 'mermaid' | 'svg') {
        this.setAttribute('format', value);
    }

    /** Graph layout direction. Reflected to/from the `layout` attribute. Defaults to `'TB'`. */
    get layout(): LayoutDirection {
        const value = this.getAttribute('layout');
        return value === 'LR' || value === 'RL' || value === 'BT' ? value : 'TB';
    }

    set layout(value: LayoutDirection) {
        this.setAttribute('layout', value);
    }

    /**
     * Diagram theme. The `theme` attribute only accepts `'light'`/`'dark'`; set the
     * property directly for a `CustomTheme` object.
     */
    get theme(): ThemeOption {
        return this.#customTheme ?? (this.getAttribute('theme') === 'dark' ? 'dark' : 'light');
    }

    set theme(value: ThemeOption) {
        if (typeof value === 'string') {
            this.#customTheme = undefined;
            this.setAttribute('theme', value);
        } else {
            // A CustomTheme object can't round-trip through an attribute; stash it and
            // re-render directly rather than reflecting a lossy string.
            this.#customTheme = value;
            this.#scheduleRender();
        }
    }

    /** Enables pan/zoom, state search, the minimap, and the click-a-state detail panel. */
    get interactive(): boolean {
        return this.hasAttribute('interactive');
    }

    set interactive(value: boolean) {
        this.toggleAttribute('interactive', value);
    }

    connectedCallback(): void {
        this.setAttribute('data-sfn-viewer', '');
        this.#scheduleRender();
    }

    disconnectedCallback(): void {
        this.#viewerHandle?.destroy();
        this.#viewerHandle = undefined;
    }

    attributeChangedCallback(name: (typeof OBSERVED_ATTRIBUTES)[number], oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue) return;
        if (name === 'definition') {
            // A later property set is authoritative; an attribute mutation after that
            // is an unsupported mix, so this simply takes the attribute at face value.
            this.#definitionSource = newValue ?? undefined;
        }
        if (name === 'theme') {
            this.#customTheme = undefined;
        }
        this.#scheduleRender();
    }

    #scheduleRender(): void {
        if (this.#renderScheduled) return;
        this.#renderScheduled = true;
        queueMicrotask(() => {
            this.#renderScheduled = false;
            this.#render();
        });
    }

    #render(): void {
        if (!this.isConnected) return;

        this.#viewerHandle?.destroy();
        this.#viewerHandle = undefined;

        const theme = this.theme;
        const chromeTheme = resolveViewerTheme({ theme });

        if (this.#definitionSource === undefined) {
            this.#hydrateExisting(chromeTheme);
            return;
        }

        let result;
        let stateData: Record<string, AslState> | undefined;
        try {
            const aslObj = parseAsl(this.#definitionSource);
            result = renderDiagramString({
                asl: aslObj,
                format: this.format,
                history: this.#history,
                layout: this.layout,
                theme,
            });
            if (this.interactive && result.type === 'svg') {
                stateData = collectStateData({ definition: aslObj });
            }
        } catch (error) {
            this.textContent = '';
            this.dispatchEvent(
                new CustomEvent('sfn-error', {
                    bubbles: true,
                    composed: true,
                    detail: error instanceof Error ? error : new Error(String(error)),
                }),
            );
            return;
        }

        if (result.type === 'mermaid') {
            this.textContent = '';
            const pre = document.createElement('pre');
            pre.textContent = result.code;
            this.appendChild(pre);
            return;
        }

        if (!this.interactive) {
            this.innerHTML = result.svg;
            return;
        }

        const hasStateData = stateData !== undefined && Object.keys(stateData).length > 0;
        ensureViewerStylesInjected(chromeTheme);
        this.innerHTML = buildViewerBody({
            minimapCollapsed: result.nodeCount <= MINIMAP_AUTO_VISIBLE_THRESHOLD,
            panel: hasStateData,
            svg: result.svg,
        });
        this.#viewerHandle = attachViewer({ root: this, stateData });
    }

    /**
     * No `definition` was ever set - either there's nothing to do, or (progressive
     * enhancement) the server already rendered an `<svg>` into this element and only
     * `interactive` behaviour needs wiring up. The detail panel can't populate without
     * ASL data, so a bare-SVG hydration path never gets one - set `definition` too if
     * you need it alongside server-rendered markup.
     */
    #hydrateExisting(chromeTheme: 'dark' | 'light'): void {
        if (this.childElementCount === 0 || !this.interactive) return;

        if (this.querySelector('[data-sfn="stage"]')) {
            // Already-interactive markup (e.g. re-rendered by the page itself) - just
            // rewire behaviour, don't touch the DOM.
            ensureViewerStylesInjected(chromeTheme);
            this.#viewerHandle = attachViewer({ root: this });
            return;
        }

        const existingMarkup = this.innerHTML;
        ensureViewerStylesInjected(chromeTheme);
        this.innerHTML = buildViewerBody({ minimapCollapsed: true, panel: false, svg: existingMarkup });
        this.#viewerHandle = attachViewer({ root: this });
    }
}
