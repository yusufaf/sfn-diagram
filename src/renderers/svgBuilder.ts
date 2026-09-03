/**
 * Minimal, DOM-free SVG element builder.
 *
 * Replaces the JSDOM + d3-selection emit layer previously used by {@link SvgRenderer}
 * so the core library can run in Node, browsers, and edge runtimes (Cloudflare Workers,
 * Vercel Edge, Deno, Bun) without a DOM implementation.
 *
 * The chainable API (`append`/`attr`/`text`) intentionally mirrors the subset of the
 * d3-selection surface the renderer relied on, and {@link SvgElement.serialize} emits
 * markup byte-compatible with JSDOM's HTML serialization (`element.outerHTML`) with one
 * deliberate deviation: every element is closed (no self-closing tags), attributes are
 * double-quoted in insertion order, and text/attribute values are HTML-escaped, but
 * attribute values also escape `<`/`>` (see {@link escapeAttribute}), which real HTML
 * serialization leaves untouched.
 */

/** A value assignable to an SVG attribute; numbers are stringified like the DOM does. */
export type SvgAttrValue = number | string;

/**
 * Escape a string for use as a double-quoted HTML attribute value.
 *
 * Goes one step further than the HTML serialization algorithm, which leaves `<` and
 * `>` untouched inside attribute values. An edge id is `${from}->${to}#...`, so a raw
 * `>` would put a tag-looking character inside every edge's `data-edge-id` and break
 * the `<path[^>]*>` style scans callers run over the serialized SVG. The escaping is
 * transparent to any XML/DOM parser, which hands back the original string.
 */
function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/\u00A0/g, '&nbsp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Escape a string for use as element text content.
 *
 * Matches the HTML serialization algorithm: `&`, U+00A0, `<`, and `>` are escaped.
 */
function escapeText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/\u00A0/g, '&nbsp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * A single SVG element node with chainable construction.
 *
 * Create a root with `new SvgElement('svg')`, build the tree with `append`/`attr`/`text`,
 * then call {@link serialize} to produce the SVG string.
 */
export class SvgElement {
    private readonly tag: string;
    private readonly attributes: Array<[string, string]> = [];
    private readonly children: SvgElement[] = [];
    private textContent: string | null = null;

    constructor(tag: string) {
        this.tag = tag;
    }

    /**
     * Set an attribute. Repeated calls preserve insertion order, matching the DOM,
     * so a later call appends the attribute rather than reordering an existing one.
     */
    attr(name: string, value: SvgAttrValue): this {
        this.attributes.push([name, String(value)]);
        return this;
    }

    /** Append a child element of the given tag and return it for chaining. */
    append(tag: string): SvgElement {
        const child = new SvgElement(tag);
        this.children.push(child);
        return child;
    }

    /** Set the element's text content. */
    text(value: SvgAttrValue): this {
        this.textContent = String(value);
        return this;
    }

    /** Serialize this element and its subtree to an SVG string. */
    serialize(): string {
        const attrs = this.attributes
            .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
            .join('');

        const inner =
            (this.textContent !== null ? escapeText(this.textContent) : '') +
            this.children.map((child) => child.serialize()).join('');

        return `<${this.tag}${attrs}>${inner}</${this.tag}>`;
    }
}
