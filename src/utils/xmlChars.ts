/**
 * Characters XML 1.0 does not allow anywhere in a document, not even as a character
 * reference: C0 controls other than tab, LF and CR, lone surrogates, and the
 * noncharacters U+FFFE and U+FFFF. resvg, and so `exportPng`, rejects an SVG holding one.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const XML_FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|\p{Cs}/gu;

/**
 * Replaces each character XML forbids with U+FFFD, the replacement character.
 *
 * Applied to every value the SVG builder writes and to every node id, so output stays
 * parseable and a `data-state-id` always equals the id the viewer and overlays look up.
 * U+FFFD keeps the change visible, where stripping would silently rename a state.
 */
export function replaceXmlForbiddenChars(text: string): string {
    return text.replace(XML_FORBIDDEN_CHARS, '\uFFFD');
}
