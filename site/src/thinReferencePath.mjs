/**
 * Matches TypeDoc's thin, auto-generated per-symbol reference pages —
 * `/reference/{index,png,aws,cfn}/{classes,interfaces,functions,type-aliases,variables}/...`
 * — as opposed to the hand-written `/reference/` landing page.
 *
 * Shared by astro.config.mjs (strips these from the sitemap) and Head.astro
 * (adds `noindex` to them), so the two stay in sync if the reference URL
 * scheme ever changes (e.g. TypeDoc adds a new symbol category).
 */
export const THIN_REFERENCE_PATH =
    /\/reference\/[^/]+\/(?:classes|interfaces|functions|type-aliases|variables)\//
