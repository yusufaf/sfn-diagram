# sfn-diagram-react

React component for rendering [AWS Step Functions](https://aws.amazon.com/step-functions/) ASL definitions as diagrams, built on top of [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram).

The core is DOM-free, so `<SfnDiagram>` renders the SVG (or Mermaid code) with no browser-only dependencies.

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

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `definition` | `object \| string` | — (required) | ASL definition as an object or JSON string |
| `format` | `'svg' \| 'mermaid'` | `'svg'` | Render an SVG diagram or emit Mermaid code |
| `layout` | `'TB' \| 'LR' \| 'RL' \| 'BT'` | `'TB'` | Graph layout direction |
| `theme` | `'light' \| 'dark' \| CustomTheme` | `'light'` | Diagram theme |
| `onError` | `(error: Error) => void` | — | Called when the definition fails to parse/render |
| `className` | `string` | — | Applied to the wrapper element |
| `style` | `React.CSSProperties` | — | Applied to the wrapper element |

When the definition is invalid the component renders `null` and (if provided) calls `onError`.

## License

MIT
