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

`react` and `sfn-diagram` are peer dependencies.

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

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `definition` | `object \| string` | — (required) | ASL definition as an object or JSON string |
| `format` | `'svg' \| 'mermaid'` | `'svg'` | Render an SVG diagram or emit Mermaid code |
| `history` | `HistoryEvent[] \| GetExecutionHistoryCommandOutput \| string` | — | Execution history; when set, renders an execution overlay |
| `layout` | `'TB' \| 'LR' \| 'RL' \| 'BT'` | `'TB'` | Graph layout direction |
| `theme` | `'light' \| 'dark' \| CustomTheme` | `'light'` | Diagram theme |
| `onError` | `(error: Error) => void` | — | Called when the definition fails to parse/render |
| `className` | `string` | — | Applied to the wrapper element |
| `style` | `React.CSSProperties` | — | Applied to the wrapper element |

When the definition is invalid the component renders `null` and (if provided) calls `onError`.

## License

MIT
