---
title: Migrating to 2.0
description: "How to upgrade from sfn-diagram 1.x to 2.0: every breaking change, with before-and-after code."
---

sfn-diagram 2.0 removes what 1.10 deprecated, ships ES modules only, needs Node 22.12 or
later, and moves the interactive viewer to `sfn-diagram/html`. From 2.0 on, the
[Compatibility policy](/compatibility/) defines what a version number promises. 1.10.0 is
the last 1.x release ([below](#releases-and-other-packages)).

## What to check

- **Every project:** the [Node version](#node-2212-or-later-285).
- **Library code:**
  - imports of the [interactive viewer](#interactive-viewer-moved-to-sfn-diagramhtml-615)
    and its [internals](#viewer-internals-no-longer-exported-528);
  - the removed options: [`width`/`height`](#diagramoptionswidth-and-height-removed-408),
    [`pngQuality`](#diagramoptionspngquality-removed-321) and
    [`engine`](#html-to-image-png-engine-removed-525);
  - [`LayoutCache` methods](#layoutcache-narrowed-526);
  - exhaustive switches over the [execution status](#aborted-execution-status-309);
  - CSS or scripts that target [`#arrowhead-*`](#marker-ids-prefixed-by-default-527);
  - [Jest and TypeScript config](#esm-only-524);
  - [hand-built graph objects](#graph-types-tightened-526).
- **CLI, Docker image and binaries:**
  - the [Node version](#node-2212-or-later-285), for `npx` and `npm i -g`;
  - jobs that pull the Docker image as `latest` or `:1`: `latest` moves to 2.0, and `:1`
    stops getting rebuilds ([below](#releases-and-other-packages));
  - images built [`FROM` the Docker image](#docker-image-base-555);
  - [SVG marker ids](#marker-ids-prefixed-by-default-527), which the CLI can't opt out of
    yet;
  - [`aborted`](#aborted-execution-status-309) in execution overlays and in the
    `--execution` summary.
- **GitHub Action and VS Code extension:** nothing to change
  ([below](#releases-and-other-packages)).

## Breaking changes

Each section shows the 1.x code and its 2.0 replacement.

### Node 22.12 or later ([#285](https://github.com/yusufaf/sfn-diagram/issues/285))

**What changes:** `engines.node` is `>=22.12.0`. Node 22 itself reaches end of life on
2027-04-30, and from 2.0 an end-of-life Node line may be dropped in a minor release (see
[Runtime support](/compatibility/#runtime-support)).

**Before (1.x):**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
```

**After (2.0):**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22 # 22.12 or later, or 24
```

### ESM only ([#524](https://github.com/yusufaf/sfn-diagram/issues/524))

**What changes:** the package ships ES modules only, and drops `main` and
`typesVersions`. `import` is unchanged, and CommonJS `require('sfn-diagram')` keeps
working on Node 22.12+, which can `require` ES modules. Tooling that ignores the
`exports` map and reads `main` needs an update.

**Before (1.x):**

```js
// jest.config.js
module.exports = {
  transformIgnorePatterns: ['/node_modules/(?!(d3-shape|d3-path)/)'],
};
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node"
  }
}
```

**After (2.0):**

```js
// jest.config.js
module.exports = {
  transformIgnorePatterns: [
    '/node_modules/(?!(sfn-diagram|sfn-diagram-react|d3-shape|d3-path)/)',
  ],
};
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext"
  }
}
```

- **Jest:** exempt `sfn-diagram` (and `sfn-diagram-react`) from
  `transformIgnorePatterns` so Jest transforms them, for example
  `transformIgnorePatterns: ['/node_modules/(?!(sfn-diagram|sfn-diagram-react|d3-shape|d3-path)/)']`.
  2.0.0 and 2.0.1 also need the `d3-shape` and `d3-path` exemption; later releases
  no longer depend on them, so it can go once you upgrade past 2.0.1.
- **TypeScript:** with `typesVersions` gone, `moduleResolution: "node"` (`"node10"`)
  loses the subpath types (`sfn-diagram/png` and the rest). Use `"node16"`,
  `"nodenext"` or `"bundler"`. Projects that compile to CommonJS need TypeScript 5.8+
  with `module: "nodenext"` (current TypeScript also offers `"node20"`).

### Interactive viewer moved to `sfn-diagram/html` ([#615](https://github.com/yusufaf/sfn-diagram/issues/615))

**What changes:** `generateHtml`, `generateHtmlAsync`, `generateExecutionHtml`,
`generateExecutionHtmlAsync` and `generateViewerUpdate` move from `sfn-diagram` to
`sfn-diagram/html`. `generateDiagram`, `generateFromAwsResponse` and
`SfnDiagramGenerator.generate` no longer accept `format: 'html'`: they throw an error
that names the new import, and their return types narrow to `MermaidOutput | SvgOutput`.

**Before (1.x):**

```ts
import { generateDiagram } from 'sfn-diagram';

const { html } = generateDiagram({ aslDefinition, format: 'html' });
```

**After (2.0):**

```ts
import { generateHtml } from 'sfn-diagram/html';

const { html } = generateHtml({ aslDefinition });
```

For `generateFromAwsResponse({ response, ...options, format: 'html' })`, pass the
definition yourself, checking it first as `generateFromAwsResponse` did:

```ts
if (!response.definition) throw new Error('No definition found in AWS response');
const { html } = generateHtml({ ...options, aslDefinition: response.definition });
```

The HTML types (`HtmlOutput`, `GenerateHtmlParams` and the rest) are still exported from
the root as well, and the CLI's `--format html` is unchanged. A cache from
`createLayoutCache` works with both entries.

1.10 could have flagged this change in advance and didn't. It ships in 2.0 anyway
because the viewer is about half of the root entry. Without it, `sfn-diagram` goes from
369 kB to 163 kB minified (120 kB to 57 kB gzipped). That saving reaches every caller of
`generateDiagram` and every unbundled import, which tree-shaking can't help.

### Viewer internals no longer exported ([#528](https://github.com/yusufaf/sfn-diagram/issues/528))

**What changes:** `buildViewerContent` and `resolveViewerTheme` are no longer exported.
`generateViewerUpdate` (from `sfn-diagram/html`) replaces `buildViewerContent`: its
`contentHtml` is the same markup for a rendered diagram. It renders from the definition,
so there is no replacement that takes an `svg` you rendered or edited yourself.

**Before (1.x):**

```ts
import { buildViewerContent } from 'sfn-diagram';

const contentHtml = buildViewerContent({ minimapCollapsed: true, svg });
```

**After (2.0):**

```ts
import { generateViewerUpdate } from 'sfn-diagram/html';

const { contentHtml, relayoutModel } = generateViewerUpdate({ aslDefinition });
```

- `resolveViewerTheme` has no public replacement: `'light'`, `'dark'` and `'auto'` map
  to themselves; classify a custom theme by its `background` colour.
- `ViewerUpdate.relayoutModel` is now typed `unknown`. Its 1.x fields
  (`RelayoutModel.callerOverrides`, `RelayoutModel.collapseTargets`,
  `RelayoutModel.diffChangedIds`, `RelayoutModel.edges`,
  `RelayoutModel.executionStatusByNodeId`, `RelayoutModel.nodes` and
  `RelayoutModel.options`) are internal. Pass it through unchanged together with
  `contentHtml`.

### `DiagramOptions.width` and `height` removed ([#408](https://github.com/yusufaf/sfn-diagram/issues/408))

**What changes:** `DiagramOptions.width` and `DiagramOptions.height` are removed. They
never affected the output.

**Before (1.x):**

```ts
const { svg } = generateSvg({ aslDefinition, height: 600, width: 800 });
```

**After (2.0):**

```ts
const { svg } = generateSvg({ aslDefinition });
```

```css
/* The SVG's viewBox scales freely: size it with CSS. */
.diagram svg {
  height: auto;
  max-width: 100%;
}
```

For PNG resolution, use `scale` ([below](#diagramoptionspngquality-removed-321)).

### `DiagramOptions.pngQuality` removed ([#321](https://github.com/yusufaf/sfn-diagram/issues/321))

**What changes:** `DiagramOptions.pngQuality` is removed. It never affected PNG output;
`PngExportOptions.scale` sets the resolution.

**Before (1.x):**

```ts
await exportPng({ aslDefinition, pngQuality: 90 });
```

**After (2.0):**

```ts
await exportPng({ aslDefinition, scale: 2 });
```

### `html-to-image` PNG engine removed ([#525](https://github.com/yusufaf/sfn-diagram/issues/525))

**What changes:** the `html-to-image` engine and its `node-html-to-image` peer are gone;
uninstall `node-html-to-image`. The default `resvg` engine is the only one, and
`engine: 'html-to-image'` now throws.

**Before (1.x):**

```bash
npm install sfn-diagram node-html-to-image
```

```ts
await exportPng({ aslDefinition, engine: 'html-to-image' });
await new PngExporter({}).convert({ height, svg, width });
```

**After (2.0):**

```bash
npm uninstall node-html-to-image
npm install @resvg/resvg-js
```

```ts
await exportPng({ aslDefinition });
await new PngExporter({}).convert({ svg, width });
```

`PngExporter.convert` stops taking `height` (`ConvertParams.height`; no entry point
exports the type), since only that engine used it. The PNG's aspect ratio comes from the
SVG.

### `LayoutCache` narrowed ([#526](https://github.com/yusufaf/sfn-diagram/issues/526))

**What changes:** `LayoutCache.get`, `LayoutCache.set` and `LayoutCache.keyFor` are
removed. Only `clear()` and `stats()` stay. Pass the cache as `cache` to a render
function such as `generateSvg` and let it do the lookup. An SVG, HTML or PNG render
throws a `TypeError` for a cache that `createLayoutCache` did not create.

**Before (1.x):**

```ts
import type { LayoutCache } from 'sfn-diagram';

// A hand-written cache, or code that calls get, set or keyFor itself.
const cache: LayoutCache = { clear, get, keyFor, set, stats };
generateSvg({ aslDefinition, cache });
```

**After (2.0):**

```ts
import { createLayoutCache, generateSvg } from 'sfn-diagram';

const cache = createLayoutCache({ maxEntries: 64 });
generateSvg({ aslDefinition, cache });
cache.stats();
```

### Graph types tightened ([#526](https://github.com/yusufaf/sfn-diagram/issues/526))

**What changes:** `StateNode.type` becomes `NodeType` (a `StateType`, or one of the
synthetic `BranchEnd`, `IteratorEnd`, `ItemReader` and `ResultWriter` nodes) instead
of `string`, and `GraphEdge.type` becomes required. Nothing changes unless your code
builds these objects by hand.

**Before (1.x):**

```ts
const edge: GraphEdge = { from: 'A', id: 'A->B', to: 'B' };
```

**After (2.0):**

```ts
const edge: GraphEdge = { from: 'A', id: 'A->B', to: 'B', type: 'normal' };
```

### `aborted` execution status ([#309](https://github.com/yusufaf/sfn-diagram/issues/309))

**What changes:** `ExecutionStateStatus` and `TimelineEntryStatus` gain an `aborted`
member, and `ExecutionMetadataSummary` gains an `aborted` list. A Parallel branch or Map
iteration stopped because another one failed, a container AWS aborted, and every state
still open when an execution is stopped now report `aborted` (blue-grey; Mermaid class
`execAborted`) instead of `failed`. The branch or iteration that actually errored stays
`failed`.

**Before (1.x):**

```ts
switch (status) {
  case 'caught':
  case 'failed':
  case 'notReached':
  case 'running':
  case 'succeeded':
    return label(status);
}
```

**After (2.0):**

```ts
switch (status) {
  case 'aborted':
  case 'caught':
  case 'failed':
  case 'notReached':
  case 'running':
  case 'succeeded':
    return label(status);
  default:
    return label('unknown');
}
```

Code that reads `metadata.failed` to find every state that did not finish should read
`metadata.aborted` too. The [compatibility policy](/compatibility/#output-unions-may-grow-in-a-minor)
lets this union grow in a minor release, so a `default:` branch keeps working.

### Marker ids prefixed by default ([#527](https://github.com/yusufaf/sfn-diagram/issues/527))

**What changes:** each SVG render prefixes its marker ids with `sfn-` and eight hex
digits hashed from the rest of the SVG (`sfn-1a2b3c4d-arrowhead-normal`), so CSS or
scripts that reference `#arrowhead-*` stop matching. The hash changes whenever the
output does, so don't hard-code it. `<sfn-diagram>` elements change from
`arrowhead-<n>-<type>` to `sfn-el<n>-arrowhead-<type>`. The collapsed view that
`generateViewerUpdate` embeds gets its own hash, or `<idPrefix>collapsed-arrowhead-<type>`
under an explicit `idPrefix` (1.10 wrote `<idPrefix>arrowhead-collapsed-<type>`).

**Before (1.x):**

```css
#arrowhead-normal path {
  fill: rebeccapurple;
}
```

**After (2.0):**

```ts
const { svg } = generateSvg({ aslDefinition, idPrefix: 'orders-' });
```

```css
#orders-arrowhead-normal path {
  fill: rebeccapurple;
}
```

Pass `idPrefix: ''` to keep the bare 1.x ids. The CLI and config file have no `idPrefix`
setting yet ([#564](https://github.com/yusufaf/sfn-diagram/issues/564), not scheduled),
so CLI output gets the 2.0 default with no opt-out until that lands.

### Docker image base ([#555](https://github.com/yusufaf/sfn-diagram/issues/555))

**What changes:** the image is built on `node:24-alpine` (Alpine Linux, musl libc)
instead of the Debian-based `node:24-slim`. The CLI, its entrypoint, the `node` user
(uid 1000) and the `/app` layout don't change. The Debian image carried 35 high and
critical OS findings with no Debian fix; the Alpine image has none. Nothing changes
unless you build `FROM` the image.

**Before (1.x):**

```dockerfile
FROM ghcr.io/yusufaf/sfn-diagram:1
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
USER node
```

**After (2.0):**

```dockerfile
FROM ghcr.io/yusufaf/sfn-diagram:2
USER root
RUN apk add --no-cache git
USER node
```

- Install packages with `apk add --no-cache <package>` instead of `apt-get install`, as
  root. Package names can differ.
- Binaries linked against glibc don't run on musl. Use Alpine builds of them, or build
  your own image from `node:24-slim`.
- `/bin/sh` is BusyBox `ash`, and there is no `bash` unless you add it.
- Liberation Sans is at `/usr/share/fonts/liberation/`. If `SFN_DIAGRAM_PNG_FONT_DIRS`
  points at `/usr/share/fonts/truetype/liberation`, update it.

## Not changing

- Bare `From->To` keys in `edgeOverrides` keep working. They are the only key form that
  survives reordering a Choice state's rules. See
  [per-edge overrides](/guides/configuration/#per-node-and-per-edge-overrides).
- CLI flags, exit codes and config keys.
- `--format html` from the CLI.
- The GitHub Action's inputs.

## Releases and other packages

- 2.0.0 is `latest` on npm and JSR. Docker `latest` and `:2` (on ghcr.io and Docker
  Hub), the Homebrew formula and the standalone binaries move to 2.0 in the same release.
- 1.10.0 is the last 1.x release: there are no 1.x fixes after 2.0. `:1` image tags stop
  getting the [weekly base-image rebuild](/guides/cli/#docker). To stay on 1.x for now,
  pin `sfn-diagram@1` or the `:1` image.
- `sfn-diagram-react` 1.0.0 requires sfn-diagram 2
  ([#540](https://github.com/yusufaf/sfn-diagram/issues/540)).
- The VS Code extension bundles 2.0 from its 0.4.0 release
  ([#542](https://github.com/yusufaf/sfn-diagram/issues/542)); there is nothing to do.
- The GitHub Action stays on `v1` with unchanged inputs, and bundles the 2.0 core, so
  its execution overlays can show `aborted`.
