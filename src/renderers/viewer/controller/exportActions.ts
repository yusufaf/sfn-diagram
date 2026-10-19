import { hook, type ListenerRegistry, type ViewerData } from './dom';
import { diagramSize, inlineRemoteImages, RASTER_SCALE, rasterizeSvg } from './rasterize';
import type { Viewport } from './viewport';

/**
 * The toolbar's three ways of getting the diagram back out of a document that was
 * opened away from whatever produced it: download the SVG, download a PNG, and copy
 * the Mermaid.
 *
 * The SVG is already on the page, so it only needs cleaning and wrapping in a Blob.
 * The PNG is that same cleaned SVG drawn through a canvas (see `rasterize.ts`).
 * Mermaid is not, and cannot be: the controller bundle may only contain
 * `src/renderers/viewer/**` (`scripts/build-viewer-script.mjs` fails the build on
 * anything else), and `MermaidRenderer` lives outside it. So the Mermaid is rendered
 * at generate time and embedded as a fourth JSON blob, the same way the timeline is.
 */

/** Classes the viewer paints onto the live SVG that have no business in a download. */
const TRANSIENT_CLASSES = [
    'sfn-dim',
    'sfn-edge-endpoint',
    'sfn-edge-selected',
    'sfn-exec-active',
    'sfn-exec-caught',
    'sfn-exec-failed',
    'sfn-exec-pending',
    'sfn-exec-succeeded',
    'sfn-exec-taken',
    'sfn-exec-untaken',
    'sfn-hit',
    'sfn-playing',
];

/** How long a button shows what just happened before going back to its label. */
const FEEDBACK_MS = 1200;

/** Parameters for {@link attachExportActions}. */
export interface AttachExportActionsParams {
    /** The viewer's current data, read at click time - `mermaid` may arrive via setContent. */
    data: ViewerData;
    /** The document Blobs, links and the clipboard are created against; null when detached. */
    ownerDoc: Document | null;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups. */
    root: ParentNode;
    /** Source of the SVG actually on screen - the expanded or collapsed view. */
    viewport: Viewport;
}

/**
 * Copy `text` to the clipboard, falling back to a selection when there is no
 * clipboard to reach.
 *
 * `navigator.clipboard` needs a secure context, and `file://` is not one - which is
 * exactly where a standalone diagram usually gets opened. The deprecated
 * `execCommand('copy')` still works there, so the headline "copy Mermaid" button is
 * not dead on the most common way of reading these documents.
 *
 * @param params - Copy parameters
 * @param params.ownerDoc - The document to stage the fallback selection in
 * @param params.text - The text to put on the clipboard
 * @returns Whether the text reached the clipboard
 *
 * @example
 * ```typescript
 * const copied = await copyText({ ownerDoc: document, text: 'stateDiagram-v2' });
 * ```
 */
export async function copyText(params: { ownerDoc: Document | null; text: string }): Promise<boolean> {
    const { ownerDoc, text } = params;
    if (!ownerDoc) return false;

    const clipboard = ownerDoc.defaultView?.navigator?.clipboard;
    if (clipboard) {
        try {
            await clipboard.writeText(text);
            return true;
        } catch {
            // Denied by permissions policy, or the document is not focused. The
            // selection fallback below still has a chance.
        }
    }

    const staging = ownerDoc.createElement('textarea');
    staging.value = text;
    // Off-screen rather than hidden: execCommand copies a selection, and there is
    // nothing to select in an element the layout never gave a box to.
    staging.setAttribute('aria-hidden', 'true');
    staging.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    ownerDoc.body.appendChild(staging);
    try {
        staging.select();
        return ownerDoc.execCommand('copy');
    } catch {
        return false;
    } finally {
        staging.remove();
    }
}

/**
 * Clone the SVG on screen, without the classes the viewer painted onto it.
 *
 * A clone, so nothing here disturbs the live diagram. Search dimming, a selected
 * edge's highlight and playback's status colours are all viewer state rather than
 * diagram content - a download that baked them in would be a picture of this reader's
 * session, not of the state machine. Everything else is left exactly as rendered,
 * including the edge hit areas, which are part of what `generateSvg` produced.
 *
 * @param params - Clone parameters
 * @param params.svg - The live SVG element to copy
 * @returns A detached, standalone copy of the SVG
 *
 * @example
 * ```typescript
 * const clone = cleanVisibleSvgClone({ svg: viewport.activeSvg()! });
 * ```
 */
export function cleanVisibleSvgClone(params: { svg: SVGSVGElement }): SVGSVGElement {
    const clone = params.svg.cloneNode(true) as SVGSVGElement;

    for (const className of TRANSIENT_CLASSES) {
        for (const element of Array.from(clone.querySelectorAll('.' + className))) {
            element.classList.remove(className);
            if (element.getAttribute('class') === '') element.removeAttribute('class');
        }
    }
    clone.classList.remove('sfn-playing');
    if (clone.getAttribute('class') === '') clone.removeAttribute('class');

    // A file opened on its own has no page to inherit the SVG namespace from.
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return clone;
}

/** Parameters for {@link serializeSvg}. */
export interface SerializeSvgParams {
    /** The detached SVG to write out, e.g. from {@link cleanVisibleSvgClone}. */
    svg: SVGSVGElement;
    /** The window whose `XMLSerializer` writes it. */
    view: Window & typeof globalThis;
}

/**
 * Write an SVG out as standalone XML markup, for both the SVG download and the PNG
 * rasteriser.
 *
 * `XMLSerializer`, not `outerHTML`: the HTML parser has already decoded `&#160;` to
 * U+00A0, and HTML serialization writes it back as `&nbsp;`, an entity XML does not
 * define. The downloaded file would then fail to open in XML consumers (a browser
 * opening it directly, Inkscape, resvg), and the markup would not load as an image.
 *
 * @param params - Serialization parameters
 * @param params.svg - The SVG to write out
 * @param params.view - The window that owns it
 * @returns Well-formed SVG markup
 *
 * @example
 * ```typescript
 * const markup = serializeSvg({ svg: cleanVisibleSvgClone({ svg }), view: window });
 * ```
 */
export function serializeSvg(params: SerializeSvgParams): string {
    return new params.view.XMLSerializer().serializeToString(params.svg);
}

/** Wire up the toolbar's download-SVG, download-PNG and copy-Mermaid buttons, when present. */
export function attachExportActions(params: AttachExportActionsParams): void {
    const { data, ownerDoc, registry, root, viewport } = params;
    const { on } = registry;

    const downloadButton = hook(root, 'export-svg');
    const pngButton = hook(root, 'export-png');
    const copyButton = hook(root, 'copy-mermaid');

    // One entry per button, not one per click: a standalone document is never
    // destroyed, so pushing a fresh cleanup on every press would grow the registry for
    // the life of the page - and let two restores race after a double click.
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    registry.cleanups.push(() => {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
    });

    /** Say what happened on the button itself, then put its label back. */
    const flash = (button: HTMLElement, message: string): void => {
        const original = button.dataset.sfnLabel ?? button.textContent ?? '';
        button.dataset.sfnLabel = original;
        button.textContent = message;

        const pending = timers.get(button);
        if (pending !== undefined) clearTimeout(pending);
        timers.set(
            button,
            setTimeout(() => {
                timers.delete(button);
                button.textContent = button.dataset.sfnLabel ?? original;
            }, FEEDBACK_MS),
        );
    };

    // A PNG finishes after awaits; one that lands after teardown must not download.
    // Pending revokes are left alone at teardown: revoking early races the download the
    // click just started, and each one fires on the next turn anyway.
    let destroyed = false;
    registry.cleanups.push(() => {
        destroyed = true;
    });

    /** Hand `blob` to the browser as a download named `filename`. */
    const download = (downloadParams: { blob: Blob; doc: Document; filename: string }): void => {
        const { blob, doc, filename } = downloadParams;
        const url = URL.createObjectURL(blob);
        const link = doc.createElement('a');
        link.href = url;
        link.download = filename;
        doc.body.appendChild(link);
        link.click();
        link.remove();
        // Freed on the next turn rather than immediately: revoking synchronously
        // races the navigation the click just started, and Firefox drops it. One timer
        // per download, so an SVG and a PNG landing together cannot strand either URL;
        // not cancelled at teardown either (see above).
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    if (downloadButton) {
        on(downloadButton, 'click', () => {
            const svg = viewport.activeSvg();
            const view = ownerDoc?.defaultView;
            if (!svg || !ownerDoc || !view) {
                flash(downloadButton, 'Failed');
                return;
            }

            const blob = new Blob([serializeSvg({ svg: cleanVisibleSvgClone({ svg }), view })], {
                type: 'image/svg+xml;charset=utf-8',
            });
            download({ blob, doc: ownerDoc, filename: 'diagram.svg' });
        });
    }

    if (pngButton) {
        // Busy rather than `disabled`: disabling the focused button would drop keyboard
        // focus back to the top of the document.
        let busy = false;
        on(pngButton, 'click', () => {
            if (busy) return;
            const svg = viewport.activeSvg();
            const view = ownerDoc?.defaultView;
            if (!svg || !ownerDoc || !view) {
                flash(pngButton, 'Failed');
                return;
            }

            // A second click cannot start a second rasterisation and download the
            // diagram twice.
            busy = true;
            pngButton.setAttribute('aria-disabled', 'true');
            void (async () => {
                try {
                    const clone = cleanVisibleSvgClone({ svg });
                    const size = diagramSize({ svg: clone });
                    if (!size) throw new Error('The diagram has no size to rasterise at');
                    // Pinned to plain pixels, so the image the markup loads as has the
                    // same intrinsic size the canvas is sized from.
                    clone.setAttribute('width', String(size.width));
                    clone.setAttribute('height', String(size.height));

                    const missing = await inlineRemoteImages({ clone, ownerDoc, scale: RASTER_SCALE });
                    const markup = serializeSvg({ svg: clone, view });
                    const blob = await rasterizeSvg({ ...size, markup, ownerDoc, scale: RASTER_SCALE });
                    if (destroyed) return;
                    if (!blob) {
                        flash(pngButton, 'Failed');
                        return;
                    }
                    download({ blob, doc: ownerDoc, filename: 'diagram.png' });
                    if (missing > 0) flash(pngButton, 'No icons');
                } catch {
                    if (!destroyed) flash(pngButton, 'Failed');
                } finally {
                    busy = false;
                    pngButton.removeAttribute('aria-disabled');
                }
            })();
        });
    }

    if (copyButton) {
        on(copyButton, 'click', () => {
            // Read at click time, not at attach: setContent swaps in the new diagram's
            // Mermaid, and a copy of the diagram that was replaced is worse than none.
            const mermaid = data.mermaid;
            if (!mermaid) {
                flash(copyButton, 'Unavailable');
                return;
            }
            void copyText({ ownerDoc, text: mermaid }).then((copied) => {
                flash(copyButton, copied ? 'Copied' : 'Failed');
            });
        });
    }
}
