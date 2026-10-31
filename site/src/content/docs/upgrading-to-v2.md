---
title: Upcoming in 2.0
description: "Every API sfn-diagram 1.x deprecates and every breaking change planned for 2.0, with what to use instead."
---

sfn-diagram 1.10 marks everything 2.0 removes as deprecated, so editors strike it
through before it goes. Nothing is removed in 1.x, and 2.0 has no release date yet.
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
| `DiagramOptions.pngQuality` | 1.10.0 | `PngExportOptions.scale`. The option has no effect on either PNG engine. ([#321](https://github.com/yusufaf/sfn-diagram/issues/321)) |
| The `html-to-image` PNG engine (`engine: 'html-to-image'`) and its `node-html-to-image` peer | 1.9.0 | The default `resvg` engine: drop the `engine` option and uninstall the peer. `PngExporter.convert` also stops taking `height` in 2.0, since only that engine used it; the PNG's aspect ratio comes from the SVG. ([#525](https://github.com/yusufaf/sfn-diagram/issues/525)) |
| `LayoutCache.get`, `LayoutCache.set`, `LayoutCache.keyFor` | 1.10.0 | Pass the cache as `cache` to a render function such as `generateSvg` and let it do the lookup. `clear()` and `stats()` stay. ([#526](https://github.com/yusufaf/sfn-diagram/issues/526)) |
| `buildViewerContent` | 1.10.0 | `generateViewerUpdate`, whose `contentHtml` is the same markup for a rendered diagram. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |
| `resolveViewerTheme` | 1.10.0 | No public replacement: `'light'`, `'dark'` and `'auto'` map to themselves; classify a custom theme by its `background` colour. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |
| The fields of `ViewerUpdate.relayoutModel` (type `RelayoutModel`, which no entry point exports): `RelayoutModel.callerOverrides`, `RelayoutModel.collapseTargets`, `RelayoutModel.diffChangedIds`, `RelayoutModel.edges`, `RelayoutModel.executionStatusByNodeId`, `RelayoutModel.nodes`, `RelayoutModel.options` | 1.10.0 | Pass `ViewerUpdate.relayoutModel` through unchanged together with `contentHtml`. The field stays in 2.0, typed opaquely. ([#528](https://github.com/yusufaf/sfn-diagram/issues/528)) |

## Breaking changes with no 1.x warning

These can't be flagged in 1.x, because the API that changes stays in place.

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
  `transformIgnorePatterns` so Jest transforms them. Extend the exemption you already
  need for `d3-shape` and `d3-path`, for example
  `transformIgnorePatterns: ['/node_modules/(?!(sfn-diagram|sfn-diagram-react|d3-shape|d3-path)/)']`.
- **TypeScript:** with `typesVersions` gone, `moduleResolution: "node"` (`"node10"`)
  loses the subpath types (`sfn-diagram/png` and the rest). Use `"node16"`,
  `"nodenext"` or `"bundler"`. Projects that compile to CommonJS need TypeScript 5.8+
  with `module: "nodenext"` (current TypeScript also offers `"node20"`).

### `aborted` execution status ([#309](https://github.com/yusufaf/sfn-diagram/issues/309))

**What changes:** `ExecutionStateStatus` gains an `aborted` member, and
`ExecutionMetadataSummary` gains an `aborted` list.

**What to do:** add a case, or a `default:` branch, to exhaustive switches over the
status. From 2.0 on, the [compatibility policy](/compatibility/#output-unions-may-grow-in-a-minor)
lets this union grow in a minor release, so a `default:` branch keeps working.

### Marker ids prefixed by default ([#527](https://github.com/yusufaf/sfn-diagram/issues/527))

**What changes:** SVG marker ids get a prefix by default, so CSS or scripts that
reference `#arrowhead-*` stop matching.

**What to do:** preview the change now by passing the `idPrefix` library option
(available since 1.10). In 2.0, pass `idPrefix: ''` to keep the bare ids. The CLI and
config file have no `idPrefix` setting yet
([#564](https://github.com/yusufaf/sfn-diagram/issues/564), not scheduled), so CLI
output gets the 2.0 default with no opt-out until that lands.

### Graph types tightened ([#526](https://github.com/yusufaf/sfn-diagram/issues/526))

**What changes:** `StateNode.type` becomes `StateType` instead of `string`, and
`GraphEdge.type` becomes required.

**What to do:** nothing, unless your code builds these objects by hand; then set a
valid `type` on each.

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
