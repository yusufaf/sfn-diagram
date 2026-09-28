---
title: Runtime support
description: "Where sfn-diagram runs: Node, browsers, edge runtimes, and what each entry point needs."
---

The core entry (`sfn-diagram`) builds SVG with a DOM-free string renderer, so
`generateSvg`, `generateMermaid`, `generateDiagram`, and `generateFromAwsResponse`
run in **Node, browsers, and edge runtimes** (Cloudflare Workers, Vercel Edge, Deno, Bun)
with no DOM polyfill.

PNG export (`sfn-diagram/png`), the CLI, and CI/PR integration building blocks
(`sfn-diagram/ci` — used by the GitHub Action and the `sfn-diagram comment gitlab`
CLI subcommand) are **Node-only** — they rely on a native rasterizer
(`@resvg/resvg-js`), Node's filesystem, or (for `sfn-diagram/ci`) shelling out
to `git` and, optionally, `@aws-sdk/client-sfn` for execution overlays. Because
`@resvg/resvg-js` and `@aws-sdk/client-sfn` are **optional peer dependencies**,
install them alongside `sfn-diagram` when you need PNG output or execution
overlays; `exportPng` throws an actionable error if `@resvg/resvg-js` is missing.

`sfn-diagram/png` also ships an opt-in `engine: 'html-to-image'` fallback backed
by the `node-html-to-image` peer, for cases that need its headless-Chromium
rendering instead of the native rasterizer. It is a library-only option — the CLI
and Docker image always use `@resvg/resvg-js` and have no engine flag.

**Node versions:** core, the CLI, and PNG export via the default `resvg` engine all
require **Node >= 20**. Only the opt-in `html-to-image` engine raises that floor, to
**Node >= 22.12.0**, set by `node-html-to-image` v6.

```ts
// Works in Node, browser, and edge:
import { generateSvg } from 'sfn-diagram';

// Node-only:
import { exportPng } from 'sfn-diagram/png';
import { runGitlabComment } from 'sfn-diagram/ci';
```

## What installing `sfn-diagram` pulls in

The package has four unconditional `dependencies`, and only two of them are
reachable from the core entry:

| Dependency | Needed by |
| --- | --- |
| `@dagrejs/dagre` | graph layout — every entry that renders a diagram: core, `/png`, `/ci`, `/element`, the CLI |
| `d3-shape` | edge paths — the same set |
| `yaml` | `sfn-diagram/cfn` (CloudFormation/SAM templates) and the CLI's `sfn-diagram.config.*` file |
| `minimatch` | `sfn-diagram/ci` (changed-file filtering) and the CLI's glob inputs |

`sfn-diagram/cfn` needs only `yaml`, and `sfn-diagram/aws` only its own
`@aws-sdk/client-sfn` peer — neither touches the layout packages.

So a browser or edge consumer who only calls `generateSvg` still **installs**
`yaml` and `minimatch` — about 1 MB in `node_modules` at the versions currently
pinned, counting `minimatch`'s own `brace-expansion`. It costs **zero bundle
bytes**: the core entry imports neither, so a bundler drops both entirely, and a
test (`tests/coreDependencies.test.ts`) fails if anything the core entry or the
`<sfn-diagram>` element entries reach ever imports them.

They are deliberately not optional peers. The CLI ships inside this same package
and needs both, so making them optional would turn `npx sfn-diagram` into an
install-two-more-packages error the first time anyone used a config file or a glob
input. Keeping them as real dependencies also keeps their transitive tree
patchable from this repo's `pnpm.overrides` rather than only by cutting a release
([#201](https://github.com/yusufaf/sfn-diagram/issues/201)).

The standalone binaries and the Docker image bundle every dependency, so neither
is affected either way.
