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

Every field is optional. Anything you leave out comes from the built-in theme named by `base` (`'light'` unless set), so overriding one thing is a one-line theme:

```typescript
import type { CustomTheme } from 'sfn-diagram';

// Dark theme, bigger labels
const bigDark: CustomTheme = { base: 'dark', fontSize: 18 };

// Light theme with a different Task fill — the Task stroke and every other colour stay
const greenTasks: CustomTheme = { nodeColors: { Task: { fill: '#e8f5e9' } } };

generateSvg({ aslDefinition: asl, theme: bigDark });
```

Or spell out the whole thing:

```typescript
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
  | Expand/Collapse | when the diagram has a Parallel or Map state, each container header carries a **−** control that collapses just that container to a placeholder (and a **+** on the placeholder to expand it again), and the toolbar's **Collapse**/**Expand** button collapses or expands every container at once. The diagram is re-laid out in place, so nothing is pre-rendered per combination |
  | Minimap | a scaled overview in the bottom-right corner, with a rectangle showing what's in view. Click or drag inside it to jump. **Map** or `m` toggles it — shown by default past 25 states, hidden below |
  | Keyboard | `Tab` reaches every state and transition; `Enter`/`Space` opens the detail panel and moves focus into it; `Esc` closes it and returns focus to what opened it. `/` focuses search, `m` toggles the minimap |

  Every node carries a `data-state-id` attribute, in the raw SVG too, so you can
  target states from your own scripts or styles. Edges carry `data-edge-id` the same
  way. The HTML viewer additionally renders an invisible widened hit area under each
  edge so it can be clicked without precise aim — that's the `edgeHitAreas` option,
  which `generateHtml()`, `<sfn-diagram interactive>` and every `--format html` CLI
  path (including `--diff` and `--execution`) set for themselves, and which stays off
  for plain `generateSvg()`/PNG output.

  The viewer chrome follows the diagram theme — `--theme dark` gets a dark shell.

  `--diff` and `--execution` also accept `--format html`, which is where the viewer
  earns its keep: a large diff or execution overlay is far easier to read when you
  can search and inspect it.

  ```bash
  npx sfn-diagram head.asl.json --diff base.asl.json --format html -o diff.html
  ```

  Per-container collapse re-runs the layout in the browser: a document with something
  to collapse embeds its parsed graph plus a minified copy of the layout and SVG
  renderer (about 80 KB, 28 KB gzipped) alongside the viewer. A diagram with no
  container never pays for it. The `collapseControls` diagram option draws the controls
  themselves; `generateHtml()` sets it for you.

  In the library, the same overlays are options on `generateHtml()` /
  `generateHtmlAsync()` — `history` for an execution overlay, `diff` for a change
  overlay — and they compose. `metadata.execution` and `metadata.diff` carry each
  overlay's summary. (`generateExecutionHtml()` remains as a thin wrapper.)

  ```typescript
  import { generateHtml } from 'sfn-diagram';

  const { html, metadata } = generateHtml({
    aslDefinition: after,
    diff: { before },      // added green, modified amber, removed red
    history: events,       // a run's status, taken path and durations
  });
  ```

  With both, a state that ran takes its execution colour, a state the run never
  reached keeps its diff colour, and a changed state that ran says so in its
  annotation (`modified · 1.2s`).

  An execution overlay shows where a run ended up. To see the order it got there in,
  `metadata.timeline` replays the run as an ordered list of state runs — and
  `buildExecutionTimeline()` computes the same thing from a history alone. Every
  `Retry` attempt, Map iteration and pass through a Parallel branch is its own entry,
  in the order the execution entered them, carrying the node id the diagram stamps as
  `data-state-id`:

  ```typescript
  import { buildExecutionTimeline } from 'sfn-diagram';

  const { entries } = buildExecutionTimeline({ definition: asl, events });
  for (const entry of entries) {
    // ProcessOrder attempt 2 failed
    console.log(entry.stateName, entry.attempt, entry.status);
  }
  ```

  A Parallel or Map entry also carries the branches or iterations its run started. A
  Distributed Map runs its iterations as child executions, whose events are not in the
  parent history, so its count is `0`.

  **Playback.** An HTML document built from a history gets a playback bar under the
  toolbar, driven by that timeline: play/pause, step back and forward, a scrubber, and
  1x / 4x / 16x / instant speeds. Space plays and pauses, the arrow keys step, Home and
  End jump to either end.

  The diagram shows the status each state *held at the playhead*, not the outcome it
  ended with: a state that has been entered but has not finished is blue and pulsing,
  one that finished shows the outcome it had by then, and anything not yet reached is
  grey. An edge lights up once the run it leads into has begun. A step lands on the
  next thing that actually ran, so every `Retry` attempt and every Map iteration is its
  own stop. Reaching the end drops every playback class, leaving exactly the static
  overlay the document was served with.

  Real durations are compressed — each interval of the run is log-scaled between 70ms
  and 900ms of display time — so a five-minute `Wait` does not stall the replay while a
  40ms Task still registers. **Real** switches to true proportions. Playback keeps the
  running state in view until you pan or zoom by hand, and honours
  `prefers-reduced-motion` by dropping the transitions and the pulse (stepping still
  works).

  **Per-state runs.** Clicking a state in an execution document lists what it actually
  did: one collapsible block per run, each headed with its attempt number, outcome,
  duration and error name. A retried Task shows all three attempts; a Map's inner state
  shows one block per iteration.

  The payloads those runs carried — a state's input, its output, a failure's `cause` —
  are **opt-in**, via `includeExecutionPayloads: true`:

  ```typescript
  const { html } = generateHtml({
    aslDefinition: asl,
    history: events,
    includeExecutionPayloads: true, // off by default
  });
  ```

  They are off by default on purpose. A history's payloads are the most sensitive thing
  it carries — request bodies, tokens, ARNs, whatever a Task was handed — and the
  default document is something people paste into an issue or a chat. Turning this on
  means those payloads travel with the file.

  Each payload is cut to 4096 characters (`EXECUTION_PAYLOAD_CAP`) with a visible
  `Truncated to 4096 of 6014 characters` notice, and capture stops altogether once
  256 KB (`EXECUTION_PAYLOAD_TOTAL_CAP`) has been embedded — a two-thousand-iteration
  Map is two thousand runs, each entitled to its own capped input and output, so the
  per-payload cap alone would not bound the file. Each block is pretty-printed and has a copy button. The same
  payloads are on the timeline itself via
  `buildExecutionTimeline({ events, includePayloads: true })`, as `entry.input`,
  `entry.output` and `entry.cause`.

  Overlays collapse too — in the viewer, and with `collapse` on `generateExecution()`
  / `--execution --collapse`. A collapsed container's placeholder takes the status
  rolled up from the states it hides: any failure makes it red, otherwise anything
  still running makes it blue, otherwise the container's own outcome stands. Its
  annotation gains a `3/4 succeeded` (or `1/4 failed`, `2/4 running`) summary beside
  the container's own duration, and a placeholder hiding a diff change keeps its
  `1 changed inside` count. Edges into and out of the placeholder keep their taken /
  untaken styling.

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
  those containers; on the CLI, escape a comma that is part of a state name as
  `\,`. It applies to the SVG, Mermaid and HTML outputs and to
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
- **PNG export**: CDN icons are inlined as data URIs before rasterizing (via `embedIcons`), so `showIcons` renders correctly with the default `resvg` engine. This requires network access when the PNG is generated; an icon whose fetch fails falls back to the original CDN URL, which `resvg` cannot fetch — that icon silently fails to render rather than the reference being removed. Only calling `PngExporter` directly with a hand-authored SVG skips this inlining — embed external images yourself first in that case.
- Unsupported services gracefully fall back to text-only labels
- Icons are opt-in via `showIcons: true` (disabled by default)
