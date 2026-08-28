/// <reference lib="dom" />
/**
 * @module
 *
 * `<sfn-diagram>` — a framework-agnostic custom element for `sfn-diagram` (the
 * `sfn-diagram/element` subpath), for Solid, Svelte, Vue, Angular, Astro, Hono,
 * vanilla HTML/htmx, and React 19+.
 *
 * This subpath is isolated from the core entry so importing `sfn-diagram` never
 * pulls in a `customElements.define` side effect on a server that has no DOM. It
 * has **no registration side effect of its own** - the custom element spec allows
 * registering one class under only one tag name, ever, so this module only hands
 * you {@link SfnDiagramElement} and {@link defineSfnDiagram} and lets you decide
 * the name. Import `sfn-diagram/element/auto` instead for the zero-config
 * `<sfn-diagram>` registration.
 *
 * @example
 * ```typescript
 * import 'sfn-diagram/element/auto'; // auto-defines <sfn-diagram>
 * ```
 *
 * @example
 * ```typescript
 * import { defineSfnDiagram } from 'sfn-diagram/element';
 * defineSfnDiagram({ name: 'my-diagram' }); // <my-diagram> instead of <sfn-diagram>
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
 * Register {@link SfnDiagramElement} under a custom element tag name.
 *
 * No-ops outside a DOM environment (`typeof customElements === 'undefined'`), so
 * importing this module on the server never throws. Also no-ops (rather than
 * throwing `NotSupportedError`) when `name` is already registered, or when
 * {@link SfnDiagramElement} was already registered under a *different* name - the
 * spec allows registering one class under only one tag name ever, so a second call
 * here (e.g. from a duplicate `sfn-diagram/element/auto` import elsewhere in the
 * dependency graph) is a no-op rather than a crash.
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
    try {
        customElements.define(name, SfnDiagramElement);
    } catch (error) {
        const alreadyRegisteredElsewhere = error instanceof DOMException && error.name === 'NotSupportedError';
        if (!alreadyRegisteredElsewhere) throw error;
    }
}
