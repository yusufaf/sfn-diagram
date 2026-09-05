---
title: Configuration
description: Themes, layouts, edge styles, large diagrams, service icons, and other diagram options.
---

## Themes

**Built-in themes:**
- `'light'` - AWS light theme (default)
- `'dark'` - AWS dark theme

**Custom theme:**

A `CustomTheme` sets the background, per-state-type fill/stroke colours, edge colours, and typography. Pass it anywhere a theme is accepted.

```typescript
import type { CustomTheme } from 'sfn-diagram';

const customTheme: CustomTheme = {
  background: '#ffffff',
  edgeColors: {
    choice: '#7b1fa2',
    default: '#607d8b',
    error: '#f44336',
    normal: '#232f3e',
    retry: '#f9a825', // optional; falls back to `error` when omitted
  },
  fontFamily: 'Arial, sans-serif',
  fontSize: 14,
  nodeColors: {
    Pass:     { fill: '#e8f5e9', stroke: '#4caf50' },
    Task:     { fill: '#e3f2fd', stroke: '#2196f3' },
    Choice:   { fill: '#fff3e0', stroke: '#ff9800' },
    Wait:     { fill: '#f3e5f5', stroke: '#9c27b0' },
    Succeed:  { fill: '#e8f5e9', stroke: '#4caf50' },
    Fail:     { fill: '#ffebee', stroke: '#f44336' },
    Parallel: { fill: '#e0f7fa', stroke: '#00bcd4' },
    Map:      { fill: '#e8eaf6', stroke: '#3f51b5' },
  },
  textColor: '#232f3e',
};

generateSvg({ aslDefinition: asl, theme: customTheme });
```

## Layouts

- `'TB'` - Top to Bottom (default)
- `'LR'` - Left to Right
- `'RL'` - Right to Left
- `'BT'` - Bottom to Top

## Edge Styles

- `'curved'` - Smooth curved paths (default)
- `'straight'` - Direct straight lines
- `'orthogonal'` - Right-angled paths

## Per-node and per-edge overrides

Three options restyle individual states and transitions on top of the theme. Each is
merged field by field over the computed style, so an override only has to name the
fields it changes. The execution overlay is built on the same three options.

- `nodeOverrides` — `Partial<NodeStyle>` (`fill`, `stroke`, `strokeWidth`, `shape`)
  keyed by state name.
- `nodeAnnotations` — extra text rendered under a node's label, keyed by state name.
- `edgeOverrides` — `stroke`, `strokeOpacity`, and `strokeWidth`, keyed by edge.

```typescript
generateSvg({
  aslDefinition: asl,
  nodeOverrides: {
    ChargeCard: { stroke: '#d13212', strokeWidth: 3 },
  },
  nodeAnnotations: {
    ChargeCard: '2 retries · 1.4s',
  },
});
```

### Addressing an edge

`edgeOverrides` accepts two key shapes:

| Key | Matches |
| --- | --- |
| `Route->Work#choice#1` | Exactly one edge — the qualified `GraphEdge.id`. Prefer this. |
| `Route->Work` | Every edge from `Route` to `Work`, whatever its type. Legacy. |

The bare `${from}->${to}` form is supported throughout 1.x; removal is deferred to 2.0.
It cannot distinguish edges that share a state pair — two `Choice` rules with the same
`Next`, or a `Retry` self-loop beside a genuine self-transition — so it restyles all of
them together.

An edge id is `${from}->${to}#${type}#${ordinal}`, where `type` is one of `normal`,
`choice`, `default`, `error`, or `retry`, and `ordinal` counts from `0` across the edges
that share the same from/to/type triple.

When both shapes match the same edge, the qualified key is merged on top of the bare one,
field by field — so a pair-wide width and a single-branch colour compose:

```typescript
generateSvg({
  aslDefinition: asl,
  edgeOverrides: {
    // Both branches out of Route get the thicker stroke...
    'Route->Work': { strokeWidth: 2 },
    // ...and only the second Choice rule is recoloured.
    'Route->Work#choice#1': { stroke: '#d13212' },
  },
});
```

### Finding an edge's id

Every edge path in a rendered SVG carries its id as `data-edge-id`, so the ids can be
read straight off a diagram rather than derived by hand:

```typescript
const { svg } = generateSvg({ aslDefinition: asl });

const ids = [...svg.matchAll(/data-edge-id="([^"]+)"/g)].map(
  (match) => match[1].replace(/&gt;/g, '>'),
);
// ['Route->Work#choice#0', 'Route->Work#choice#1', ...]
```

In the browser, `document.querySelectorAll('path[data-edge-id]')` gives the same ids
already unescaped, which is also how the interactive viewer addresses single edges.

Easiest of all: open the diagram as `--format html` and click the edge. The panel title
is the id, ready to paste into `edgeOverrides`.

### Id stability

Ids survive the graph transforms the library applies after parsing — `collapse`, catch
handling — because those only ever drop edges, never renumber the survivors. Gaps in the
ordinal sequence are expected and deliberate.

They are **not** stable against edits to the ASL itself. Ordinals are assigned in parser
order, so inserting a `Choice` rule ahead of an existing one that shares the same `Next`
shifts the existing rule's ordinal, and a hand-written `edgeOverrides` key then points at
a different edge. Re-read the ids after changing a state machine's transitions.

## Large diagrams

Big, branchy state machines are hard to read as a static image. A few options help:

- **`--format html`** (or `generateHtml()`) — a self-contained interactive viewer.
  No external dependencies, opens offline straight from `file://`.
  ```bash
  npx sfn-diagram state.asl.json --format html -o diagram.html
  ```

  | Interaction | |
  | --- | --- |
  | Pan | drag the background |
  | Zoom | mouse wheel, or the `-` / `+` / **Fit** / **Reset** toolbar buttons |
  | Search states | type in the toolbar box — non-matches dim, the view pans to the first hit. `/` focuses it, `Enter` cycles hits (`Shift+Enter` backwards), `Esc` clears |
  | Inspect a state | click any node — a side panel shows its `Type`, `Resource`, `Next`, `Retry`, `Catch` and `Assign`, plus the raw ASL. Click the background or press `Esc` to close |
  | Inspect an edge | click any transition (or its label) — the same panel shows the edge's id, its endpoints, its kind (`normal`/`error`/`choice`/`default`/`retry`) and, for a Choice branch, the condition that produced it. The edge and both endpoints highlight while it's open |
  | Expand/Collapse | when the diagram has a Parallel or Map state, a toggle button switches between the expanded and fully-collapsed view |
  | Minimap | a scaled overview in the bottom-right corner, with a rectangle showing what's in view. Click or drag inside it to jump. **Map** or `m` toggles it — shown by default past 25 states, hidden below |

  Every node carries a `data-state-id` attribute, in the raw SVG too, so you can
  target states from your own scripts or styles. Edges carry `data-edge-id` the same
  way. The HTML viewer additionally renders an invisible widened hit area under each
  edge so it can be clicked without precise aim — that's the `edgeHitAreas` option,
  which `generateHtml()` and `<sfn-diagram interactive>` set for themselves and which
  stays off for plain `generateSvg()`/PNG output.

  The viewer chrome follows the diagram theme — `--theme dark` gets a dark shell.

  `--diff` and `--execution` also accept `--format html`, which is where the viewer
  earns its keep: a large diff or execution overlay is far easier to read when you
  can search and inspect it.

  ```bash
  npx sfn-diagram head.asl.json --diff base.asl.json --format html -o diff.html
  ```

  > **Icons and offline use:** the CLI inlines AWS service icons as data URIs, so
  > `--format html --show-icons` still works with no network. In the library, the
  > synchronous `generateHtml()` leaves icon URLs pointing at the jsDelivr CDN — use
  > the async `generateHtmlAsync()` to inline them:
  > ```typescript
  > import { generateHtmlAsync } from 'sfn-diagram';
  > const { html } = await generateHtmlAsync({ aslDefinition: asl, showIcons: true });
  > ```
- **`--hide-catch`** (or `catchHandling: 'hide'`) — drop per-state error-handler
  (`Catch`) branches so the happy path stands out. A handler that's also reachable
  via the happy path is kept.
  ```bash
  npx sfn-diagram state.asl.json --hide-catch --format svg -o diagram.svg
  ```
- **`--collapse`** (or `collapse: true`) — collapse Parallel/Map containers into
  placeholder nodes so dagre lays out a smaller diagram. Pass specific state names
  (`--collapse=Name1,Name2`, or `collapse: ['Name1', 'Name2']`) to collapse only
  those containers. It applies to the SVG, Mermaid and HTML outputs and to
  `--diff` (except `--diff --format mermaid`), but not to `--execution` overlays,
  which build their graph separately — the same limitation `--hide-catch` has there.
  ```bash
  npx sfn-diagram state.asl.json --collapse --format svg -o diagram.svg
  ```
- **`--layout LR`** (or `layout: 'LR'`) — the default `TB` layout makes catch-heavy
  or deeply branching machines extremely tall; `LR` reads better for wide graphs.

## Variables and Distributed Map

Two pieces of modern ASL are rendered explicitly, because both are otherwise
invisible in a diagram.

**Variables (`Assign`).** A state that assigns variables is annotated with their
names beneath its label — `$orderId, $total`. The list caps at three names, then
collapses to `+N more`, so a state assigning many variables cannot blow out the
node width. Disable with `showVariables: false`.

```typescript
const { svg } = generateSvg({ aslDefinition: asl, showVariables: false });
```

**Distributed Map.** A Map whose `ItemProcessor` declares
`ProcessorConfig.Mode: 'DISTRIBUTED'` runs a child execution per batch rather than
iterating inline, so it is labelled `Distributed` in the container header instead
of rendering identically to an inline Map. `MaxConcurrency` is shown alongside it
when set.

Its `ItemReader` (dataset source — S3 or Athena) and `ResultWriter` (result sink)
each become a satellite node beside the container, wired in and out of the Map.
With `showIcons: true` they pick up the appropriate AWS service icon, resolved
from the ARN the same way Task states are.

```
ItemReader (s3) ──▶ ProcessItems ──▶ ResultWriter (s3)
                  Distributed · max 100
```

## AWS Service Icons

Display AWS service icons on Task state nodes to improve diagram readability and quickly identify which AWS services are being used.

**Basic Usage:**

```typescript
import { generateSvg } from 'sfn-diagram';

const { svg } = generateSvg({
  aslDefinition: asl,
  showIcons: true,        // Enable icons
  iconPosition: 'left',   // Icon placement (default)
  iconSize: 24            // Icon dimensions in pixels (default)
});
```

**Supported Services (30+):**

Lambda, ECS, Fargate, EC2, Batch, DynamoDB, RDS, Aurora, Neptune, S3, EFS, FSx, SQS, SNS, EventBridge, Kinesis, Glue, Athena, EMR, Redshift, SageMaker, Bedrock, Comprehend, Rekognition, Step Functions, API Gateway, AppSync, CloudWatch, CloudFormation, Systems Manager, Secrets Manager, KMS, and more.

**Icon Positioning:**

- `'left'` - Icon to the left of label (default, matches AWS Console style)
- `'top'` - Icon above label
- `'right'` - Icon to the right of label

**Custom Icon Resolver:**

Provide your own icon URLs for services:

```typescript
const { svg } = generateSvg({
  aslDefinition: asl,
  showIcons: true,
  iconResolver: (service) => {
    if (service === 'lambda') {
      return 'https://my-cdn.com/lambda-icon.svg';
    }
    return null; // Fall back to default
  }
});
```

**Recommended Node Dimensions:**

For optimal icon visibility, use wider nodes:

```typescript
const { svg } = generateSvg({
  aslDefinition: asl,
  showIcons: true,
  nodeWidth: 150,  // Default: 120
  nodeHeight: 70   // Default: 60
});
```

**Important Notes:**
- Icons are only displayed on Task states (states with AWS service integrations)
- Icons are sourced from [aws-icons](https://www.npmjs.com/package/aws-icons) via jsDelivr CDN
- **PNG export limitation**: External CDN images may not render in PNG output due to headless browser limitations. **Use SVG output for diagrams with icons.**
- Unsupported services gracefully fall back to text-only labels
- Icons are opt-in via `showIcons: true` (disabled by default)
