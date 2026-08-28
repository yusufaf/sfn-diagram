/// <reference lib="dom" />
/**
 * @module
 *
 * `<sfn-diagram>` — a framework-agnostic custom element for `sfn-diagram` (the
 * `sfn-diagram/element` subpath), for Solid, Svelte, Vue, Angular, Astro, Hono,
 * vanilla HTML/htmx, and React 19+.
 *
 * This subpath is isolated from the core entry so importing `sfn-diagram` never
 * pulls in a `customElements.define` side effect on a server that has no DOM.
 * Importing it defines `sfn-diagram` automatically; use {@link defineSfnDiagram}
 * for a scoped registration instead.
 *
 * @example
 * ```typescript
 * import 'sfn-diagram/element'; // auto-defines <sfn-diagram>
 * ```
 *
 * @example
 * ```typescript
 * import { defineSfnDiagram } from 'sfn-diagram/element';
 * defineSfnDiagram({ name: 'my-diagram' }); // <my-diagram> instead
 * ```
 */
import { SfnDiagramElement } from './SfnDiagramElement';

export { SfnDiagramElement } from './SfnDiagramElement';

/** Parameters for {@link defineSfnDiagram}. */
export interface DefineSfnDiagramParams {
    /** Tag name to register under. Defaults to `'sfn-diagram'`. */
    name?: string;
}

/**
 * Register {@link SfnDiagramElement} under a custom element tag name. Safe to call
 * more than once (including for the default name this module auto-registers) —
 * a name already registered, by this call or the auto-registration side effect,
 * is left alone rather than throwing `NotSupportedError`.
 *
 * No-ops outside a DOM environment (`typeof customElements === 'undefined'`), so
 * importing this module on the server never throws.
 *
 * @param params - Registration parameters
 * @param params.name - Tag name to register under. Defaults to `'sfn-diagram'`
 *
 * @example
 * ```typescript
 * import { defineSfnDiagram } from 'sfn-diagram/element';
 * defineSfnDiagram({ name: 'my-diagram' });
 * ```
 */
export function defineSfnDiagram(params: DefineSfnDiagramParams = {}): void {
    const { name = 'sfn-diagram' } = params;
    if (typeof customElements === 'undefined') return;
    if (customElements.get(name)) return;
    customElements.define(name, SfnDiagramElement);
}

defineSfnDiagram();
