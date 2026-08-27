# sfn-diagram — notes for coding agents

Library that generates diagrams from AWS Step Functions ASL (Amazon States
Language) definitions. Full documentation: <https://sfn.yusufaf.dev>, published
for agents at <https://sfn.yusufaf.dev/llms.txt>. Any docs page is available as
raw Markdown by appending `.md` to its URL.

## Entry points

| Import | Contents | Runtime |
|---|---|---|
| `sfn-diagram` | `generateSvg`, `generateMermaid`, `generateHtml`, `generateDiagram`, diff and execution overlays | Node, browser, edge |
| `sfn-diagram/png` | `exportPng` | Node only |
| `sfn-diagram/aws` | `generateFromAwsResponse`, `fetchExecutionHistory` | Node, browser, edge |
| `sfn-diagram/cfn` | `extractAslFromTemplate` for CloudFormation/SAM/CDK | Node, browser, edge |

The core is platform-agnostic and has no browser-engine dependency. Only
`sfn-diagram/png` (via the optional `node-html-to-image` peer) and the CLI are
Node-only. Do not import `sfn-diagram/png` in browser or edge code.

## Calling convention

Every public function takes a **single object parameter**, never positional
arguments:

```ts
import { generateSvg } from 'sfn-diagram';

const { svg, height, width } = generateSvg({
  asl: definition,
  options: { edgeStyle: 'curved', layout: 'LR', theme: 'dark' },
});
```

Type-only imports (`AslDefinition`, `DiagramOptions`, `CustomTheme`,
`LayoutDirection`, `ThemeOption`, …) come from the root entry point.

## Common mistakes

- Passing positional arguments — the API is object-parameter throughout.
- Importing `exportPng` from `sfn-diagram` — it lives in `sfn-diagram/png`.
- Assuming a DOM. SVG output is built as a string with no `document` access, so
  it works server-side and in edge runtimes without a shim.
- Treating `layout` as a Mermaid direction string. Valid values are `'TB'`,
  `'LR'`, `'RL'`, and `'BT'`.

## CLI

```bash
npx sfn-diagram diagram my-workflow.asl.json --format svg --out diagram.svg
```

Supports diffs between two revisions and execution overlays from a run's
history. See <https://sfn.yusufaf.dev/guides/cli/>.

## Working in this repository

Conventions, build commands, and release process are documented in
[CLAUDE.md](CLAUDE.md). In short: `pnpm test` (vitest), `pnpm run build`
(tsdown), `pnpm run typecheck`, `npx eslint .`. Releases are automated by
release-please — never bump the version or edit the changelog by hand.
