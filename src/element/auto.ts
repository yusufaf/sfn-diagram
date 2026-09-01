/**
 * @module
 *
 * Side-effect-only convenience entry (the `sfn-diagram/element/auto` subpath):
 * registers {@link SfnDiagramElement} as `<sfn-diagram>` on import. Import
 * `sfn-diagram/element` directly instead if you want a different tag name via
 * {@link defineSfnDiagram} - only one of the two should run per page, since a
 * class can be registered under one tag name only.
 *
 * @example
 * ```html
 * <script type="module" src="sfn-diagram/element/auto"></script>
 * <sfn-diagram></sfn-diagram>
 * ```
 */
import { defineSfnDiagram } from './index';

defineSfnDiagram();
