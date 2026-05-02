# Bundle Size Reduction Design

**Date:** 2026-05-02
**Status:** Approved

## Problem

`sfn-diagram@0.2.0` reports 5.8MB minified / 1.4MB gzipped on Bundlephobia — large for a Node.js diagramming utility. The main culprits are:

- `node-html-to-image` + Puppeteer (~8.8MB on disk) — pulled in for all users even if they never export PNG
- `jsdom` (~4.4MB on disk) — used only by the SVG renderer
- `d3` (full umbrella package) — only 3 functions used
- `mermaid` — listed in `dependencies` but never imported anywhere

## Goals

- Reduce bundle size for users who only need SVG/Mermaid output
- Keep PNG export fully supported with no peer dependency friction
- No breaking changes to the SVG/Mermaid API

## Changes

### 1. Remove `mermaid` from `dependencies`

`mermaid` is listed in `package.json` but never imported in any source or test file. `MermaidRenderer` generates Mermaid *syntax* (plain text) without invoking the library.

- Delete the `mermaid` entry from `dependencies` in `package.json`
- No code changes required

### 2. Split PNG export into a sub-path entry point

**Motivation:** `node-html-to-image` transitively installs Puppeteer, which is the single largest contributor to install size. Most users generating SVG or Mermaid diagrams have no need for it.

**Implementation:**

- Create `src/png.ts` — new entry point that exports `exportPng` and `PngExporter`
- Remove `exportPng` and `PngExporter` from `src/index.ts`
- Add `png: './src/png.ts'` entry to `tsdown.config.ts`
- Add `./png` sub-path to the `exports` map in `package.json`

**Resulting API:**

```ts
// SVG/Mermaid — zero Puppeteer cost
import { generateSvg, generateMermaid } from 'sfn-diagram';

// PNG export — Puppeteer included
import { exportPng } from 'sfn-diagram/png';
```

`node-html-to-image` remains a normal `dependency` — no peer dep setup required.

### 3. Switch `d3` imports to sub-packages

**Motivation:** Importing from the `d3` umbrella re-export can prevent bundlers from reliably tree-shaking unused sub-modules. Direct sub-package imports are explicit and guaranteed to tree-shake.

**Current imports in `src/renderers/SvgRenderer.ts`:**
```ts
import { select, line, curveBasis } from 'd3';
```

**Replace with:**
```ts
import { select } from 'd3-selection';
import { line, curveBasis } from 'd3-shape';
```

`d3-selection` and `d3-shape` are already installed as transitive dependencies of `d3`, so no new packages are added. Add them as explicit `dependencies` in `package.json` and remove `d3`.

## Files to Change

| File | Change |
|------|--------|
| `package.json` | Remove `mermaid`; replace `d3` with `d3-selection` + `d3-shape` in `dependencies`; add `./png` export |
| `tsdown.config.ts` | Add `png` entry point |
| `src/index.ts` | Remove `exportPng`, `PngExporter` exports and their imports |
| `src/png.ts` | New file — re-exports `exportPng` (inline or from `exporters/`) and `PngExporter` |
| `src/renderers/SvgRenderer.ts` | Switch d3 imports to sub-packages |

## Out of Scope

- Replacing `jsdom` + `d3` with pure SVG string generation (significant rewrite, deferred)
- Moving `node-html-to-image` to a peer dependency (unnecessary given the sub-path approach)
