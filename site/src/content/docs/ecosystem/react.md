---
title: React component
description: Render diagrams in a React app with sfn-diagram-react.
---

Render diagrams in a React app with the [`sfn-diagram-react`](https://www.npmjs.com/package/sfn-diagram-react) package ([source](https://github.com/yusufaf/sfn-diagram/tree/main/packages/sfn-diagram-react/)). It wraps `generateSvg`/`generateMermaid` in a component with the same platform-agnostic core, so it works in any React renderer. React 18 and 19 are both supported.

```bash
npm install sfn-diagram-react sfn-diagram react
```

```tsx
import { SfnDiagram } from 'sfn-diagram-react';

<SfnDiagram
  definition={asl}     // ASL object or JSON string
  format="svg"         // 'svg' (default) | 'mermaid'
  theme="dark"         // 'light' | 'dark' | CustomTheme
  layout="LR"          // 'TB' | 'LR' | 'RL' | 'BT'
  history={history}    // optional: renders an execution overlay
  onError={(err) => console.error(err)}
/>
```
