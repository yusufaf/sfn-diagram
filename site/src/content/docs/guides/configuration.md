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
  | Minimap | a scaled overview in the bottom-right corner, with a rectangle showing what's in view. Click or drag inside it to jump. **Map** or `m` toggles it — shown by default past 25 states, hidden below |

  Every node carries a `data-state-id` attribute, in the raw SVG too, so you can
  target states from your own scripts or styles.

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
