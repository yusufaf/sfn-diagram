# sfn-diagram-react

[![npm version](https://img.shields.io/npm/v/sfn-diagram-react.svg)](https://www.npmjs.com/package/sfn-diagram-react)
[![license](https://img.shields.io/npm/l/sfn-diagram-react.svg)](https://github.com/yusufaf/sfn-diagram/blob/main/LICENSE)

React component for rendering [AWS Step Functions](https://aws.amazon.com/step-functions/) ASL definitions as diagrams, built on top of [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram).

The core is DOM-free, so `<SfnDiagram>` renders the SVG (or Mermaid code) with no browser-only dependencies. Not on React (or on React 18, which can't set object props on custom elements)? [`<sfn-diagram>`](https://sfn.yusufaf.dev/ecosystem/web-component/) is a framework-agnostic custom element shipped from `sfn-diagram/element` — no extra package.

## Installation

```bash
npm install sfn-diagram-react sfn-diagram
# or
pnpm add sfn-diagram-react sfn-diagram
```

`react` and `sfn-diagram` are peer dependencies. `sfn-diagram >= 1.6.0` is required — earlier versions don't have the options this package forwards (`collapse`, `catchHandling`, `showVariables`, `generateHtml`, and `edgeOverrides`' qualified-id form).

## Usage

```tsx
import { SfnDiagram } from 'sfn-diagram-react'

const definition = {
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

`definition` accepts either an ASL object or a JSON string.

### Execution overlay

Pass an execution's `history` to overlay a real run onto the diagram: states are
coloured by outcome (succeeded / failed / caught / not-reached), the taken path is
emphasized, and per-state duration and retry counts are annotated.

```tsx
// historyJson: output of `aws stepfunctions get-execution-history`, as a JSON string
<SfnDiagram definition={definition} history={historyJson} />
```

`history` accepts a `GetExecutionHistory` events array, the raw command output, or a
JSON string of either. In the browser, pass the JSON string.

`history` and `before` (diff mode, below) cannot be combined — core has no API for
overlaying an execution onto a diff. Combining them calls `onError` and renders `null`,
the same way any other invalid input is handled.

### Interactive viewer (`format="html"`)

Set `format="html"` to render the full interactive pan/zoom/search viewer instead of
static markup. Since embedding a complete HTML *document* is only possible in an
`<iframe>`, that's what this renders — as a sandboxed `srcDoc`, not a same-origin embed.
Consequences worth knowing:

- Page CSS does not reach the iframe's content — style it via the diagram options
  (`theme`, `customColors` are not exposed by this package yet — file an issue if you
  need them) rather than page-level CSS.
- The iframe has no intrinsic height; size it yourself (`style={{ height: 600 }}`, or a
  wrapper with a fixed aspect ratio).
- `onStateClick` does not fire from inside it — clicks inside a sandboxed iframe never
  reach the parent document's event handlers.
- `history` cannot be combined with `format="html"` — core's `generateHtml` accepts
  neither `history` nor a diff. Combining them calls `onError` and renders `null`.

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
- `before` cannot be combined with `history` or `format="html"` — core has no diff API
  for either combination. Combining them calls `onError` and renders `null`.
- The **SVG diff** (`generateDiff`) honours every diagram option this package forwards
  (`collapse`, `catchHandling`, `showIcons`, and the rest).
- The **Mermaid diff** (`generateMermaidDiff`) accepts only the two definitions — every
  other prop (`layout`, `theme`, `collapse`, …) is silently ignored in `format="mermaid"`
  diff mode.

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

### `useSfnDiagram`

For the raw output — the SVG/HTML string, Mermaid code, dimensions, and metadata —
without mounting anything, use the hook `<SfnDiagram>` is built on:

```tsx
import { useSfnDiagram } from 'sfn-diagram-react'

function DownloadSvgButton({ definition }: { definition: object }) {
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

It accepts the same option-bearing props as `<SfnDiagram>` (`before`, `definition`,
`format`, `history`, plus every diagram option below) — just not the presentational
ones (`className`, `onError`, `onStateClick`, `style`, `title`). Errors are returned as
`{ type: 'error', error }` rather than thrown.

## Props

| Prop | Type | Default | Applies to | Description |
| --- | --- | --- | --- | --- |
| `before` | `object \| string` | — | svg, mermaid | The *original* side of a diff; `definition` becomes the *after* side. See [Diff mode](#diff-mode). |
| `catchHandling` | `'hide' \| 'show'` | `'show'` | svg, mermaid | `'hide'` drops Catch error edges and handler-only nodes. |
| `className` | `string` | — | all | Applied to the wrapper element (`div`, `pre`, or `iframe`). |
| `collapse` | `string[] \| boolean` | — | svg, mermaid | Collapse Parallel/Map containers into a placeholder node. `true` collapses every container; an array collapses only the named ones. |
| `definition` | `object \| string` | — (required) | all | ASL definition as an object or JSON string. |
| `edgeOverrides` | `Record<string, EdgeStyleOverride>` | — | svg only | Per-edge style overrides keyed by `GraphEdge.id` (preferred, e.g. `Route->Work#choice#1`) or the legacy bare `${from}->${to}` (broad-matches every edge between that pair). |
| `edgeStyle` | `'straight' \| 'curved' \| 'orthogonal'` | `'curved'` | svg, mermaid | Edge path rendering style. |
| `format` | `'svg' \| 'mermaid' \| 'html'` | `'svg'` | — | Output format. See [Interactive viewer](#interactive-viewer-formathtml) for `'html'`. |
| `history` | `HistoryEvent[] \| GetExecutionHistoryCommandOutput \| string` | — | svg, mermaid | Execution history; when set, renders an execution overlay. See [Execution overlay](#execution-overlay). |
| `iconPosition` | `'left' \| 'top' \| 'right'` | `'left'` | svg only | Position of AWS service icons relative to the node label. |
| `iconSize` | `number` | `24` | svg only | Size of AWS service icons in pixels. |
| `layout` | `'TB' \| 'LR' \| 'RL' \| 'BT'` | `'TB'` | svg, mermaid | Graph layout direction. |
| `nodeOverrides` | `Record<string, Partial<NodeStyle>>` | — | svg only | Per-node style overrides keyed by graph node id. |
| `onError` | `(error: Error) => void` | — | all | Called when the definition fails to parse/render. |
| `onStateClick` | `(params: { event, stateId }) => void` | — | svg only | See [`onStateClick`](#onstateclick). |
| `showIcons` | `boolean` | `false` | svg only | Whether to display AWS service icons on Task state nodes. |
| `showVariables` | `boolean` | `true` | svg, mermaid | Whether to annotate nodes with the variables they assign via ASL `Assign`. |
| `style` | `React.CSSProperties` | — | all | Applied to the wrapper element. |
| `theme` | `'light' \| 'dark' \| CustomTheme` | `'light'` | svg, mermaid | Diagram theme. |
| `title` | `string` | `'Step Functions diagram'` | html only | Accessible title for the rendered iframe. |

When the definition is invalid the component renders `null` and (if provided) calls
`onError`.

**Memoize object-valued props.** `collapse` (as an array), `nodeOverrides`,
`edgeOverrides`, and a `CustomTheme` object for `theme` are all things a consumer might
inline in JSX. An inline object or array is referentially unstable — a different
reference on every render — which re-triggers this component's internal memo and a
full re-layout each time, even though nothing actually changed. Hoist them to a
constant or wrap them in `useMemo` if you re-render often.

## License

MIT
