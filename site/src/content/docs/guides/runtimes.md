---
title: Runtime support
description: "Where sfn-diagram runs: Node, browsers, edge runtimes, and what each entry point needs."
---

The core entry (`sfn-diagram`) builds SVG with a DOM-free string renderer, so
`generateSvg`, `generateMermaid`, `generateDiagram`, and `generateFromAwsResponse`
run in **Node, browsers, and edge runtimes** (Cloudflare Workers, Vercel Edge, Deno, Bun)
with no DOM polyfill.

PNG export (`sfn-diagram/png`) and the CLI are **Node-only** — they rely on a headless
browser (`node-html-to-image`) and Node's filesystem respectively. Because `node-html-to-image`
is an **optional peer dependency**, install it alongside `sfn-diagram` when you need PNG output;
`exportPng` throws an actionable error if it is missing.

**Node versions:** the package requires **Node >= 20**. PNG export additionally requires
**Node >= 22.12.0**, the floor set by `node-html-to-image` v6 — SVG, Mermaid, and HTML
output are unaffected and keep working on Node 20.

```ts
// Works in Node, browser, and edge:
import { generateSvg } from 'sfn-diagram';

// Node-only:
import { exportPng } from 'sfn-diagram/png';
```
