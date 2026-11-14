# sfn-diagram-react

[![npm version](https://img.shields.io/npm/v/sfn-diagram-react.svg)](https://www.npmjs.com/package/sfn-diagram-react)
[![license](https://img.shields.io/npm/l/sfn-diagram-react.svg)](https://github.com/yusufaf/sfn-diagram/blob/main/LICENSE)

React component for rendering [AWS Step Functions](https://aws.amazon.com/step-functions/) ASL definitions as diagrams, built on top of [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram).

The core is DOM-free, so `<SfnDiagram>` renders the SVG, Mermaid code, or the interactive HTML viewer (in an `<iframe>`) with no browser-only dependencies. Not on React (or on React 18, which can't set object props on custom elements)? [`<sfn-diagram>`](https://sfn.yusufaf.dev/ecosystem/web-component/) is a framework-agnostic custom element shipped from `sfn-diagram/element` — no extra package.

## Installation

```bash
npm install sfn-diagram-react sfn-diagram
# or
pnpm add sfn-diagram-react sfn-diagram
```

`react` and `sfn-diagram` are peer dependencies. `sfn-diagram-react` 1.x needs `sfn-diagram` 2, because `format="html"` renders through the `sfn-diagram/html` subpath that 2.0 introduced. Like core, it ships ES modules only and needs Node >= 22.12, where `require()` still loads it. Upgrading from 1.x? See [Migrating to 2.0](https://sfn.yusufaf.dev/upgrading-to-v2/), which also covers Jest's `transformIgnorePatterns`.

## Usage

```tsx
import type { AslDefinition } from 'sfn-diagram'
import { SfnDiagram } from 'sfn-diagram-react'

const definition: AslDefinition = {
    StartAt: 'Hello',
    States: {
        Hello: { Type: 'Pass', Next: 'World' },
        World: { Type: 'Succeed' },
    },
}

export function Diagram() {
    return (
        <SfnDiagram
            definition={definition}
            layout="TB"
            theme="light"
            onError={(error) => console.error(error)}
        />
    )
}
```

`definition` accepts an `AslDefinition` object or a JSON string. An unannotated object
in a variable widens `Type` to `string`, so annotate it
(`const definition: AslDefinition = {...}`). A definition imported from a `.json` file
is widened the same way: pass it as a string (`JSON.stringify(json)` or the raw file
text), or cast it with `as unknown as AslDefinition`. A direct `as AslDefinition` fails
for a Parallel whose branches name different states.

### Execution overlay

Pass an execution's `history` to overlay a real run onto the diagram: states are
coloured by outcome (succeeded / failed / caught / aborted / not-reached), the taken
path is emphasized, and per-state duration and retry counts are annotated. An aborted
state was entered but abandoned before it finished: another branch's or iteration's
failure stopped it, AWS aborted its container, or it was still open when the execution
was stopped.

```tsx
// historyJson: output of `aws stepfunctions get-execution-history`, as a JSON string
<SfnDiagram definition={definition} history={historyJson} />
```

`history` accepts a `GetExecutionHistory` events array, the raw command output, or a
JSON string of either. In the browser, pass the JSON string.

`history` and `before` (diff mode, below) combine only with `format="html"`, where the
viewer paints the run onto the diff: a state that ran takes its execution colour, one
the run never reached keeps its diff colour, and a changed state that ran shows its diff
status in its annotation (`modified · 1.2s`). Core's SVG and Mermaid functions can't
overlay an execution onto a diff, so with those formats the pair calls `onError` and
renders `null`, the same way any other invalid input is handled.

**`format="mermaid"` combined with `history` honours `catchHandling`, `collapse`,
`showVariables`, `layout` and `theme`**, like plain `format="mermaid"`. The SVG execution
overlay honours every other option too. Neither the SVG nor the Mermaid execution overlay
draws `customColors`: both paint every state, including ones the run never reached, in its
run-status colour.

### Interactive viewer (`format="html"`)

Set `format="html"` to render the full interactive pan/zoom/search viewer instead of
static markup. Since embedding a complete HTML *document* is only possible in an
`<iframe>`, that's what this renders — as a sandboxed `srcDoc`, not a same-origin embed.
Consequences worth knowing:

- Page CSS does not reach the iframe's content — style it through the diagram props
  (`theme`, `customColors`) rather than page-level CSS.
- The iframe has no intrinsic height; size it yourself (`style={{ height: 600 }}`, or a
  wrapper with a fixed aspect ratio).
- `onStateClick` does not fire from inside it — clicks inside a sandboxed iframe never
  reach the parent document's event handlers.
- `history` and `before` both work here, alone or together. On `useSfnDiagram`'s html
  result, `metadata.execution` and `metadata.diff` carry each overlay's summary.

```tsx
<SfnDiagram definition={definition} format="html" style={{ height: 600, width: '100%' }} />
```

Give the iframe a `title` (defaults to `'Step Functions diagram'`) when a page renders
more than one, so screen readers can tell them apart.

### Diff mode

Pass `before` to render a diff instead of a plain diagram: `definition` becomes the
*after* side and `before` the original side. Added, modified, and removed states are
coloured (green / yellow / red) instead of the machine's normal styling.

```tsx
<SfnDiagram before={previousDefinition} definition={definition} />
```

- `before` accepts an ASL object or a JSON string, same as `definition`.
- `before` can't be combined with `history` except under `format="html"` (see
  [Execution overlay](#execution-overlay)).
- Both diffs honour the diagram props this package forwards. The **Mermaid diff**
  (`generateMermaidDiff`) uses the ones Mermaid output supports (`layout`, `theme`,
  `customColors`, `collapse`, `catchHandling`, `showVariables`) and ignores SVG-only ones such as
  `showIcons` and `edgeStyle`, same as a plain `format="mermaid"` render.

### `onStateClick`

Fires when a state node is clicked, SVG format only:

```tsx
<SfnDiagram
    definition={definition}
    onStateClick={({ stateId }) => console.log('clicked', stateId)}
/>
```

- Not invoked for `format="mermaid"` (no clickable elements) or `format="html"` (the
  sandboxed iframe's clicks never reach the parent document).
- `stateId` is the graph node id, which equals the state name for every state whose
  name is unique across the machine. A nested state whose name repeats elsewhere in the
  machine gets an id qualified by its scope — read it off the rendered `data-state-id`
  attribute rather than assuming the bare name.
- No click listener is attached at all when `onStateClick` is omitted.

### Imperative handle

`SfnDiagram` forwards a `ref` exposing `{ getSvg(): string | null }` — the rendered SVG
markup for `format="svg"`, or `null` for every other format (including an errored
render):

```tsx
const ref = useRef<SfnDiagramHandle>(null)
<SfnDiagram definition={definition} ref={ref} />
// later: ref.current?.getSvg()
```

There is no programmatic zoom/pan control — core doesn't expose the interactive
viewer's controller from a public subpath yet, so a meaningful pan/zoom handle needs a
core change first.

### Several diagrams on one page

Each `<SfnDiagram>` (and each `useSfnDiagram` call) prefixes its SVG marker ids with a
value from React's `useId()`. Within one React root, two diagrams, even of the same
definition, never pick up each other's arrowheads, and server-rendered markup keeps the
same ids after hydration. When a page hydrates several roots, give each root its own
`identifierPrefix`, as React requires for `useId`.

### Layout cache

Pass a layout cache from `sfn-diagram`'s `createLayoutCache()` to skip re-running the
layout when only paint-level props change, such as a light/dark theme toggle with the
same font size:

```tsx
import { createLayoutCache } from 'sfn-diagram'

const cache = createLayoutCache() // module scope, or useState(() => createLayoutCache())

<SfnDiagram cache={cache} definition={definition} theme={theme} />
```

- It applies to svg output (plain, diff, and execution overlay) and to the html viewer.
  Mermaid output ignores it.
- Pass a stable reference. A new cache on every render never hits.
- You own its lifetime: call `cache.clear()` when you're done with it. It holds at most
  `maxEntries` layouts (default 32).
- One cache can serve several diagrams; marker-id prefixes aren't part of its key.
- With svg or html, a hand-built or copied object calls `onError` with a `TypeError`.
  Mermaid ignores `cache`, so it never checks it.

### `useSfnDiagram`

For the raw output — the SVG/HTML string, Mermaid code, dimensions, and metadata —
without mounting anything, use the hook `<SfnDiagram>` is built on:

```tsx
import type { AslDefinition } from 'sfn-diagram'
import { useSfnDiagram } from 'sfn-diagram-react'

function DownloadSvgButton({ definition }: { definition: AslDefinition }) {
    const result = useSfnDiagram({ definition })
    if (result.type !== 'svg') return null

    const href = `data:image/svg+xml;base64,${btoa(result.svg)}`
    return (
        <a download="diagram.svg" href={href}>
            Download SVG
        </a>
    )
}
```

It accepts the same option-bearing props as `<SfnDiagram>` (`before`, `cache`,
`definition`, `format`, `history`, plus every diagram option below) — just not the presentational
ones (`className`, `onError`, `onStateClick`, `style`, `title`). Errors are returned as
`{ type: 'error', error }` rather than thrown.

## Props

| Prop | Type | Default | Applies to | Description |
| --- | --- | --- | --- | --- |
| `before` | `AslDefinition \| string` | — | all (with `history`: html only) | The *original* side of a diff; `definition` becomes the *after* side. See [Diff mode](#diff-mode). |
| `cache` | `LayoutCache` | — | svg, html | Layout cache from `createLayoutCache()`. See [Layout cache](#layout-cache). |
| `catchHandling` | `'hide' \| 'show'` | `'show'` | all | `'hide'` drops Catch error edges and handler-only nodes. |
| `className` | `string` | — | all | Applied to the wrapper element (`div`, `pre`, or `iframe`). |
| `collapse` | `string[] \| boolean` | — (html: `true`) | all | Collapse Parallel/Map containers into a placeholder node. `true` collapses every container; an array collapses only the named ones. The html viewer starts expanded and sets what its collapse toggle collapses (every container by default); `false` or `[]` removes the toggle. |
| `customColors` | `Partial<Record<StateType, Partial<NodeStyle>>>` | — | all | Per-state-type `fill` and `stroke` on top of `theme`; other `NodeStyle` fields are ignored (use `nodeOverrides`). An execution overlay paints every state its run-status colour instead, and a diff shows it only on unchanged states. |
| `definition` | `AslDefinition \| string` | — (required) | all | ASL definition as an object or JSON string. |
| `edgeOverrides` | `Record<string, EdgeStyleOverride>` | — | svg, html | Per-edge style overrides keyed by `GraphEdge.id` (preferred, e.g. `Route->Work#choice#1`) or the legacy bare `${from}->${to}` (broad-matches every edge between that pair). |
| `edgeStyle` | `'straight' \| 'curved' \| 'orthogonal'` | `'curved'` | svg, html | Edge path rendering style. |
| `format` | `'svg' \| 'mermaid' \| 'html'` | `'svg'` | — | Output format. See [Interactive viewer](#interactive-viewer-formathtml) for `'html'`. |
| `history` | `HistoryEvent[] \| GetExecutionHistoryCommandOutput \| string` | — | all (with `before`: html only) | Execution history; when set, renders an execution overlay. See [Execution overlay](#execution-overlay). |
| `iconPosition` | `'left' \| 'top' \| 'right'` | `'left'` | svg, html | Position of AWS service icons relative to the node label. |
| `iconSize` | `number` | `24` | svg, html | Size of AWS service icons in pixels. |
| `layout` | `'TB' \| 'LR' \| 'RL' \| 'BT'` | `'TB'` | all | Graph layout direction. |
| `nodeOverrides` | `Record<string, Partial<NodeStyle>>` | — | svg, html | Per-node style overrides keyed by graph node id. |
| `onError` | `(error: Error) => void` | — | all | Called when the definition fails to parse/render. |
| `onStateClick` | `(params: { event, stateId }) => void` | — | svg only | See [`onStateClick`](#onstateclick). |
| `showIcons` | `boolean` | `false` | svg, html | Whether to display AWS service icons on Task state nodes. |
| `showVariables` | `boolean` | `true` | all | Whether to annotate nodes with the variables they assign via ASL `Assign`. |
| `style` | `React.CSSProperties` | — | all | Applied to the wrapper element. |
| `theme` | `'light' \| 'dark' \| 'auto' \| CustomTheme` | `'light'` | all | Diagram theme. `'auto'` follows the reader's colour scheme in SVG and HTML output; Mermaid renders it as light. |
| `title` | `string` | `'Step Functions diagram'` | html only | Accessible title for the rendered iframe. |

When the definition is invalid the component renders `null` and (if provided) calls
`onError`.

**Memoize object-valued props.** `collapse` (as an array), `customColors`, `nodeOverrides`,
`edgeOverrides`, and a `CustomTheme` object for `theme` are all things a consumer might
inline in JSX. An inline object or array is referentially unstable — a different
reference on every render — which re-triggers this component's internal memo and a
full re-layout each time, even though nothing actually changed. Hoist them to a
constant or wrap them in `useMemo` if you re-render often.

## License

MIT
