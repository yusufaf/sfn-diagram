---
title: Upcoming in 2.0
description: "Every API sfn-diagram 1.x deprecates and every breaking change planned for 2.0, with what to use instead."
---

sfn-diagram 1.10 marks what 2.0 removes as deprecated, so editors strike it through
before it goes. The one exception is the interactive viewer's move to `sfn-diagram/html`
([below](#interactive-viewer-moved-to-sfn-diagramhtml-615)), which 1.10 did not flag.
Nothing is removed in 1.x, and 2.0 has no release date yet.
When 2.0 ships, this page becomes its migration guide
([#530](https://github.com/yusufaf/sfn-diagram/issues/530)).

:::note[Planned, not final]
The 2.0 work is tracked in the
[v2.0.0 milestone](https://github.com/yusufaf/sfn-diagram/milestone/10). Details may
change until 2.0 ships. What semver will cover from 2.0 on is drafted in the
[Compatibility policy](/compatibility/).
:::

## Deprecated in 1.x, removed in 2.0

| Deprecated | Since | Use instead |
| --- | --- | --- |
| `DiagramOptions.width`, `DiagramOptions.height` | 1.9.0 | Size the SVG with CSS (its `viewBox` scales freely); use `PngExportOptions.scale` for PNG resolution. ([#408](https://github.com/yusufaf/sfn-diagram/issues/408)) |
| `DiagramOptions.pngQuality` | 1.10.0 | `PngExportOptions.scale`. The option has no effect on PNG output. ([#321](https://github.com/yusufaf/sfn-diagram/issues/321)) |
| The `html-to-image` PNG engine (`engine: 'html-to-image'`) and its `node-html-to-image` peer | 1.9.0 | The default `resvg` engine: drop the `engine` option and uninstall the peer. `PngExporter.convert` also stops taking `height` (`ConvertParams.height`, deprecated in 1.10.0; no entry point exports the type) in 2.0, since only that engine used it; the PNG's aspect ratio comes from the SVG. ([#525](https://github.com/yusufaf/sfn-diagram/issues/525)) |
| `LayoutCache.get`, `LayoutCache.set`, `LayoutCache.keyFor` | 1.10.0 | Pass the cache as `cache` to a render function such as `generateSvg` and let it do the lookup. `clear()` and `stats()` stay. In 2.0 an SVG, HTML or PNG render throws a `TypeError` for a cache that `createLayoutCache` did not create. ([#526](https://github.com/yusufaf/sfn-diagram/issues/526)) |
| `buildViewerContent` | 1.10.0 | `generateViewerUpdate` (from `sfn-diagram/html` in 2.0), whose `contentHtml` is the same markup for a rendered diagram. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |
| `resolveViewerTheme` | 1.10.0 | No public replacement: `'light'`, `'dark'` and `'auto'` map to themselves; classify a custom theme by its `background` colour. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |
| The fields of `ViewerUpdate.relayoutModel` (type `RelayoutModel`, which no entry point exports): `RelayoutModel.callerOverrides`, `RelayoutModel.collapseTargets`, `RelayoutModel.diffChangedIds`, `RelayoutModel.edges`, `RelayoutModel.executionStatusByNodeId`, `RelayoutModel.nodes`, `RelayoutModel.options` | 1.10.0 | Pass `ViewerUpdate.relayoutModel` through unchanged together with `contentHtml`. The field stays in 2.0, typed `unknown`. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |

## Breaking changes with no 1.x warning

Most of these can't be flagged in 1.x, because the API that changes stays in place.
The viewer move is the exception.

### Node 22.12 or later ([#285](https://github.com/yusufaf/sfn-diagram/issues/285))

**What changes:** `engines.node` becomes `>=22.12.0`. Node 22 itself reaches end of
life on 2027-04-30, and from 2.0 an end-of-life Node line may be dropped in a minor
release (see [Runtime support](/compatibility/#runtime-support)).

**What to do:** upgrade Node.

### ESM only ([#524](https://github.com/yusufaf/sfn-diagram/issues/524))

**What changes:** the package ships ES modules only, and drops `main` and
`typesVersions`.

**What to do:** `import` is unchanged, and CommonJS `require('sfn-diagram')` keeps
working on Node 22.12+, which can `require` ES modules. Tooling that ignores the
`exports` map and reads `main` needs an update.

- **Jest:** exempt `sfn-diagram` (and `sfn-diagram-react`) from
  `transformIgnorePatterns` so Jest transforms them, for example
  `transformIgnorePatterns: ['/node_modules/(?!(sfn-diagram|sfn-diagram-react)/)']`.
  2.0 no longer depends on `d3-shape` or `d3-path`, so a 1.x exemption for them can go.
- **TypeScript:** with `typesVersions` gone, `moduleResolution: "node"` (`"node10"`)
  loses the subpath types (`sfn-diagram/png` and the rest). Use `"node16"`,
  `"nodenext"` or `"bundler"`. Projects that compile to CommonJS need TypeScript 5.8+
  with `module: "nodenext"` (current TypeScript also offers `"node20"`).

### `aborted` execution status ([#309](https://github.com/yusufaf/sfn-diagram/issues/309))

**What changes:** `ExecutionStateStatus` and `TimelineEntryStatus` gain an `aborted`
member, and `ExecutionMetadataSummary` gains an `aborted` list. A Parallel branch or Map
iteration stopped because another one failed, a container AWS aborted, and every state
still open when an execution is stopped now report `aborted` (blue-grey; Mermaid class
`execAborted`) instead of `failed`. The branch or iteration that actually errored stays
`failed`.

**What to do:** add a case, or a `default:` branch, to exhaustive switches over the
status. Code that reads `metadata.failed` to find every state that did not finish
should read `metadata.aborted` too. From 2.0 on, the [compatibility policy](/compatibility/#output-unions-may-grow-in-a-minor)
lets this union grow in a minor release, so a `default:` branch keeps working.

### Marker ids prefixed by default ([#527](https://github.com/yusufaf/sfn-diagram/issues/527))

**What changes:** each SVG render prefixes its marker ids with `sfn-` and eight hex
digits hashed from the rest of the SVG (`sfn-1a2b3c4d-arrowhead-normal`), so CSS or
scripts that reference `#arrowhead-*` stop matching. The hash changes whenever the
output does, so don't hard-code it. `<sfn-diagram>` elements change from
`arrowhead-<n>-<type>` to `sfn-el<n>-arrowhead-<type>`. The collapsed view that
`generateViewerUpdate` embeds gets its own hash, or `<idPrefix>collapsed-arrowhead-<type>`
under an explicit `idPrefix` (1.10 wrote `<idPrefix>arrowhead-collapsed-<type>`).

**What to do:** pass `idPrefix: ''` to keep the bare ids, or your own prefix to
target the ids from CSS (`idPrefix: 'orders-'` gives `orders-arrowhead-normal`). The CLI and
config file have no `idPrefix` setting yet
([#564](https://github.com/yusufaf/sfn-diagram/issues/564), not scheduled), so CLI
output gets the 2.0 default with no opt-out until that lands.

### Graph types tightened ([#526](https://github.com/yusufaf/sfn-diagram/issues/526))

**What changes:** `StateNode.type` becomes `NodeType` (a `StateType`, or one of the
synthetic `BranchEnd`, `IteratorEnd`, `ItemReader` and `ResultWriter` nodes) instead
of `string`, and `GraphEdge.type` becomes required.

**What to do:** nothing, unless your code builds these objects by hand; then set a
valid `type` on each.

### Interactive viewer moved to `sfn-diagram/html` ([#615](https://github.com/yusufaf/sfn-diagram/issues/615))

**What changes:** `generateHtml`, `generateHtmlAsync`, `generateExecutionHtml`,
`generateExecutionHtmlAsync` and `generateViewerUpdate` move from `sfn-diagram` to
`sfn-diagram/html`. `generateDiagram`, `generateFromAwsResponse` and
`SfnDiagramGenerator.generate` no longer accept `format: 'html'`: they throw an error
that names the new import, and their return types narrow to `MermaidOutput | SvgOutput`.
The HTML types (`HtmlOutput`, `GenerateHtmlParams` and the rest) are still exported
from the root as well. The CLI's `--format html` is unchanged.

Unlike the rest of this section, 1.10 could have flagged this one and didn't. It ships
in 2.0 anyway because the viewer is about half of the root entry. Without it,
`sfn-diagram` goes from 369 kB to 163 kB minified (120 kB to 57 kB gzipped). That
saving reaches every caller of `generateDiagram` and every unbundled import, which
tree-shaking can't help.

**What to do:** import the viewer from the subpath.

```ts
import { generateHtml } from 'sfn-diagram/html';
```

Replace `generateDiagram({ ...options, format: 'html' })` with `generateHtml(options)`.
For `generateFromAwsResponse({ response, ...options, format: 'html' })`, pass the
definition yourself, checking it first as `generateFromAwsResponse` did:

```ts
if (!response.definition) throw new Error('No definition found in AWS response');
const { html } = generateHtml({ ...options, aslDefinition: response.definition });
```

A cache from `createLayoutCache` works with both entries.

### Docker image base ([#555](https://github.com/yusufaf/sfn-diagram/issues/555))

**What changes:** the image moves off Debian, to Alpine or distroless (decided in
#555).

**What to do:** Dockerfiles that build `FROM` the image and run `apt-get`, or rely on
glibc or a shell, must change.

## Not changing

Bare `From->To` keys in `edgeOverrides` keep working in 2.0. They are the only key
form that survives reordering a Choice state's rules. See
[per-edge overrides](/guides/configuration/#per-node-and-per-edge-overrides).

## Releases and other packages

- Docker `latest` and `:2`, the Homebrew formula and the standalone binaries move to
  2.0 together. There is no 1.x maintenance line after 2.0.
- `sfn-diagram-react` 1.0.0 requires sfn-diagram 2
  ([#540](https://github.com/yusufaf/sfn-diagram/issues/540)).
- The VS Code extension adopts 2.0 in its 0.4.0 release
  ([#542](https://github.com/yusufaf/sfn-diagram/issues/542)).
- The GitHub Action stays on `v1`; its inputs don't change.
