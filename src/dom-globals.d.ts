/// <reference lib="dom" />

// Ambient DOM globals for the browser-only modules under src/element/ and
// src/renderers/viewer/. The root tsconfig's `lib` is `es2023` only (core must
// type-check without a DOM lib since it also runs in Node and edge runtimes),
// so those modules need this somewhere. It used to live as a per-file
// `/// <reference lib="dom" />`, but JSR's publish analysis bans triple-slash
// directives that modify globals inside published source files. Keeping the
// directive in this one file instead — excluded from the JSR package via
// jsr.json's `publish.exclude` — satisfies both: local tsc still sees it
// (ambient .d.ts files apply to the whole `include` graph regardless of
// imports), and it never reaches the JSR analyzer. JSR's own Deno runtime
// already has DOM globals ambiently, so nothing replaces this for that side.
