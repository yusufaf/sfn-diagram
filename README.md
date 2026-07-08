# sfn-diagram

[![npm version](https://img.shields.io/npm/v/sfn-diagram.svg)](https://www.npmjs.com/package/sfn-diagram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Live Playground](https://img.shields.io/badge/playground-live-brightgreen)](https://yusufaf.github.io/sfn-diagram/)

Generate beautiful, interactive diagrams from AWS Step Functions ASL (Amazon States Language) definitions. Supports dual output formats: D3.js-based SVG and Mermaid.js diagram code, plus PNG export.

**▶ [Try it in the live playground](https://yusufaf.github.io/sfn-diagram/)** — paste any ASL definition and preview the diagram instantly, no install required.

## Features

- **Multiple Output Formats**: SVG (D3.js), Mermaid syntax, and PNG
- **Automatic Layout**: Smart graph positioning using Dagre layout engine
- **Full ASL Support**: All state types (Pass, Task, Choice, Wait, Succeed, Fail, Parallel, Map)
- **Customizable Themes**: AWS light/dark themes plus custom theme support
- **Flexible Layouts**: Top-bottom, left-right, right-left, bottom-top
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **AWS SDK Integration**: Direct integration with AWS Step Functions API
- **Dual APIs**: Function-based and class-based interfaces
- **Runs Anywhere**: SVG and Mermaid generation has zero platform dependencies — works in Node, the browser, and edge runtimes

## Installation

```bash
npm install sfn-diagram
```

The core package pulls in **no browser engine** — SVG and Mermaid generation stay lightweight. PNG export relies on a headless browser, provided by the optional peer dependency `node-html-to-image`. Install it only if you use `sfn-diagram/png`:

```bash
npm install sfn-diagram node-html-to-image
```

## Runtime Support

The core entry (`sfn-diagram`) builds SVG with a DOM-free string renderer, so
`generateSvg`, `generateMermaid`, `generateDiagram`, and `generateFromAwsResponse`
run in **Node, browsers, and edge runtimes** (Cloudflare Workers, Vercel Edge, Deno, Bun)
with no DOM polyfill.

PNG export (`sfn-diagram/png`) and the CLI are **Node-only** — they rely on a headless
browser (`node-html-to-image`) and Node's filesystem respectively. Because `node-html-to-image`
is an **optional peer dependency**, install it alongside `sfn-diagram` when you need PNG output;
`exportPng` throws an actionable error if it is missing.

```ts
// Works in Node, browser, and edge:
import { generateSvg } from 'sfn-diagram';

// Node-only:
import { exportPng } from 'sfn-diagram/png';
```

## Command-line Usage

The package ships a CLI for use without writing any JavaScript:

```bash
npx sfn-diagram state.asl.json --format svg -o diagram.svg
npx sfn-diagram state.asl.json --format mermaid > diagram.mmd
cat state.asl.json | npx sfn-diagram - --format svg
```

Flags: `--format <svg|mermaid|png>`, `-o/--output <path>`, `--theme <light|dark>`, `--layout <TB|LR|RL|BT>`, `-h/--help`, `-v/--version`.

## Docker

A prebuilt image is published to GitHub Container Registry with Chromium baked in, so PNG export works out of the box:

```bash
docker run --rm -v "$PWD":/work ghcr.io/yusufaf/sfn-diagram:latest \
  /work/state.asl.json --format svg -o /work/diagram.svg

docker run --rm -v "$PWD":/work ghcr.io/yusufaf/sfn-diagram:latest \
  /work/state.asl.json --format png -o /work/diagram.png
```

Tags: `latest`, `<major>`, `<major>.<minor>`, `<major>.<minor>.<patch>`.

## Quick Start

### Function-based API

```typescript
import { generateSvg } from 'sfn-diagram';
import { writeFileSync } from 'fs';

const asl = {
  StartAt: 'HelloWorld',
  States: {
    HelloWorld: {
      Type: 'Pass',
      Result: 'Hello, World!',
      End: true
    }
  }
};

const { svg, width, height } = generateSvg({
  aslDefinition: asl,
  theme: 'dark',
  layout: 'LR'
});

writeFileSync('diagram.svg', svg);
console.log(`Generated ${width}x${height} diagram`);
```

### Class-based API

```typescript
import { SfnDiagramGenerator } from 'sfn-diagram';

const generator = new SfnDiagramGenerator({
  theme: 'dark',
  layout: 'TB',
  nodeWidth: 150,
  nodeHeight: 80,
});

const { svg } = generator.generateSvg({ aslDefinition: asl });
const { code } = generator.generateMermaid({ aslDefinition: asl });
```

## API Reference

### generateSvg(params)

Generate an SVG diagram using D3.js and Dagre layout.

```typescript
import { generateSvg } from 'sfn-diagram';

const result = generateSvg({
  aslDefinition: asl,              // ASL definition (object or JSON string)
  theme: 'light',                  // 'light', 'dark', or CustomTheme object
  layout: 'TB',                    // 'TB', 'LR', 'RL', 'BT'
  nodeWidth: 120,                  // Node width in pixels
  nodeHeight: 60,                  // Node height in pixels
  rankSeparation: 50,              // Vertical spacing between ranks
  nodeSeparation: 50,              // Horizontal spacing between nodes
  padding: 20,                     // Diagram padding
  edgeStyle: 'curved',             // 'curved', 'straight', 'orthogonal'
  showStateTypes: false,           // Display state types on nodes
  includeComments: true,           // Use state comments as labels
  customColors: {}                 // Override colors for specific states
});

// Returns SvgOutput: { svg: string, width: number, height: number, metadata: { edgeCount: number, nodeCount: number } }
```

### generateMermaid(params)

Generate Mermaid.js diagram syntax.

```typescript
import { generateMermaid } from 'sfn-diagram';

const result = generateMermaid({
  aslDefinition: asl,
  includeComments: true
});

// Returns MermaidOutput: { code: string, metadata: { edgeCount: number, stateCount: number } }
```

### generateDiagram(params)

Generate a diagram, choosing the output format via the `format` option (defaults to `'svg'`).

```typescript
import { generateDiagram } from 'sfn-diagram';

const svgResult = generateDiagram({
  aslDefinition: asl,
  theme: 'dark'
});                                // Returns SvgOutput

const mermaidResult = generateDiagram({
  aslDefinition: asl,
  format: 'mermaid'
});                                // Returns MermaidOutput
```

### exportPng(params)

Export diagram as PNG image. Node-only — imported from the `sfn-diagram/png` subpath.

```typescript
import { exportPng } from 'sfn-diagram/png';

const result = await exportPng({
  aslDefinition: asl,
  theme: 'light',
  pngQuality: 90,               // 1–100 (default 90)
  backgroundColor: 'transparent'
});

// Returns PngOutput: { buffer: Buffer, width: number, height: number, metadata: { format: 'png' } }
writeFileSync('diagram.png', result.buffer);
```

### generateFromAwsResponse(params)

Generate diagram directly from AWS SDK response.

```typescript
import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { generateFromAwsResponse } from 'sfn-diagram';

const client = new SFNClient({ region: 'us-east-1' });
const response = await client.send(
  new DescribeStateMachineCommand({
    stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:MyStateMachine'
  })
);

const { svg } = generateFromAwsResponse({
  response,
  theme: 'dark'
});
```

### SfnDiagramGenerator Class

Reusable generator that holds diagram options once and applies them to every call. Configure options via the constructor or the fluent `setOptions()` method; pass the `aslDefinition` per generation.

```typescript
import { SfnDiagramGenerator } from 'sfn-diagram';

const generator = new SfnDiagramGenerator({
  theme: 'dark',
  layout: 'LR',
  nodeWidth: 150,
  nodeHeight: 80,
  rankSeparation: 60,
  nodeSeparation: 60,
  edgeStyle: 'curved',
  padding: 30,
});

// Update options later (chainable)
generator.setOptions({ theme: 'light' });

// Generate outputs (aslDefinition passed per call)
const svgResult = generator.generateSvg({ aslDefinition: asl });
const mermaidResult = generator.generateMermaid({ aslDefinition: asl });
```

> PNG export is a standalone function from `sfn-diagram/png` (`exportPng`), not a method on this class.

## Configuration Options

### Themes

**Built-in themes:**
- `'light'` - AWS light theme (default)
- `'dark'` - AWS dark theme

**Custom theme:**
```typescript
const customTheme = {
  backgroundColor: '#ffffff',
  nodeStroke: '#232f3e',
  nodeStrokeWidth: 2,
  fontSize: 14,
  fontFamily: 'Arial, sans-serif',
  stateColors: {
    Pass: '#4CAF50',
    Task: '#2196F3',
    Choice: '#FF9800',
    Wait: '#9C27B0',
    Succeed: '#4CAF50',
    Fail: '#F44336',
    Parallel: '#00BCD4',
    Map: '#3F51B5'
  }
};

generateSvg({ aslDefinition: asl, theme: customTheme });
```

### Layouts

- `'TB'` - Top to Bottom (default)
- `'LR'` - Left to Right
- `'RL'` - Right to Left
- `'BT'` - Bottom to Top

### Edge Styles

- `'curved'` - Smooth curved paths (default)
- `'straight'` - Direct straight lines
- `'orthogonal'` - Right-angled paths

### AWS Service Icons

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

## Supported State Types

All AWS Step Functions state types are fully supported:

| State Type | Shape | Description |
|------------|-------|-------------|
| **Pass** | Rectangle | Passes input to output, optionally with transformation |
| **Task** | Rectangle | Performs work via Lambda, Activity, or service integration |
| **Choice** | Diamond | Adds branching logic based on input |
| **Wait** | Rectangle | Delays execution for specified time |
| **Succeed** | Circle | Terminates successfully |
| **Fail** | Circle | Terminates with failure |
| **Parallel** | Rectangle | Executes branches in parallel |
| **Map** | Rectangle | Iterates over array items (legacy `Iterator` and modern `ItemProcessor`/Distributed Map) |

### Error handling & retries

- **`Catch`** blocks render as dashed error edges to their handler states.
- **`Retry`** policies render as a labelled self-loop on the state (e.g. `↻ States.Timeout (4x); States.ALL (2x)`) — a self-transition in Mermaid output.

## Examples

### Complex State Machine

```typescript
import { generateSvg } from 'sfn-diagram';

const complexAsl = {
  Comment: 'Order processing workflow',
  StartAt: 'ValidateOrder',
  States: {
    ValidateOrder: {
      Type: 'Task',
      Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder',
      Next: 'CheckInventory',
      Catch: [{
        ErrorEquals: ['ValidationError'],
        Next: 'OrderFailed'
      }]
    },
    CheckInventory: {
      Type: 'Task',
      Resource: 'arn:aws:lambda:us-east-1:123456789012:function:CheckInventory',
      Next: 'IsInStock'
    },
    IsInStock: {
      Type: 'Choice',
      Choices: [{
        Variable: '$.inStock',
        BooleanEquals: true,
        Next: 'ProcessPayment'
      }],
      Default: 'OutOfStock'
    },
    ProcessPayment: {
      Type: 'Task',
      Resource: 'arn:aws:states:::dynamodb:putItem',
      Next: 'OrderSucceeded'
    },
    OutOfStock: {
      Type: 'Fail',
      Error: 'OutOfStockError',
      Cause: 'Item not available'
    },
    OrderFailed: {
      Type: 'Fail',
      Error: 'OrderValidationError'
    },
    OrderSucceeded: {
      Type: 'Succeed'
    }
  }
};

const { svg } = generateSvg({
  aslDefinition: complexAsl,
  theme: 'dark',
  layout: 'TB',
  edgeStyle: 'curved',
  nodeWidth: 150,
  nodeHeight: 70
});
```

### Parallel State Machine

```typescript
const parallelAsl = {
  StartAt: 'ProcessInParallel',
  States: {
    ProcessInParallel: {
      Type: 'Parallel',
      Branches: [
        {
          StartAt: 'Branch1',
          States: {
            Branch1: { Type: 'Pass', Result: 'Branch 1', End: true }
          }
        },
        {
          StartAt: 'Branch2',
          States: {
            Branch2: { Type: 'Pass', Result: 'Branch 2', End: true }
          }
        }
      ],
      Next: 'FinalState'
    },
    FinalState: {
      Type: 'Succeed'
    }
  }
};

const { svg } = generateSvg({ aslDefinition: parallelAsl });
```

### Export Multiple Formats

```typescript
import { generateSvg, generateMermaid } from 'sfn-diagram';
import { exportPng } from 'sfn-diagram/png';
import { writeFileSync } from 'fs';

// Generate SVG and Mermaid
const { svg } = generateSvg({ aslDefinition: asl });
const { code } = generateMermaid({ aslDefinition: asl });
writeFileSync('diagram.svg', svg);
writeFileSync('diagram.mmd', code);

// Generate PNG (Node-only)
const { buffer } = await exportPng({
  aslDefinition: asl,
  pngQuality: 90,
  backgroundColor: 'transparent'
});
writeFileSync('diagram.png', buffer);
```

## TypeScript Support

Full TypeScript definitions included:

```typescript
import type {
  AslDefinition,
  DiagramOptions,
  SvgOutput,
  MermaidOutput,
  CustomTheme,
  StateType
} from 'sfn-diagram';

// PNG types live on the Node-only subpath
import type { PngOutput, ExportPngParams } from 'sfn-diagram/png';
```

## Ecosystem

### Playground

An interactive browser-based editor for exploring ASL definitions and previewing diagrams in real time. **[Open the live playground →](https://yusufaf.github.io/sfn-diagram/)** or run it locally from the [`playground/`](playground/) directory.

```bash
cd playground
pnpm install
pnpm dev
```

Paste any ASL JSON, switch themes, and see the SVG diagram update instantly — no install required beyond the dev server.

### VS Code Extension

Preview Step Functions diagrams directly inside VS Code. Located in [`packages/vscode-sfn-diagram/`](packages/vscode-sfn-diagram/).

**Install from source:**
```bash
cd packages/vscode-sfn-diagram
pnpm install
pnpm package          # produces vscode-sfn-diagram-*.vsix
code --install-extension vscode-sfn-diagram-*.vsix
```

**Usage:** Open any `.json` or `.asl` file and run **Step Functions: Preview Step Functions Diagram** from the command palette, or click the diagram icon in the editor title bar.

### GitHub Action

Post SVG diff previews and Mermaid diagrams as PR comments whenever ASL files change. Located in [`packages/github-action-sfn-diagram/`](packages/github-action-sfn-diagram/).

```yaml
# .github/workflows/sfn-preview.yml
name: Step Functions Preview
on:
  pull_request:
    paths: ['**/*.asl.json']

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: ./packages/github-action-sfn-diagram
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Yusuf Afzal

## Links

- [GitHub Repository](https://github.com/yusufaf/sfn-diagram)
- [npm Package](https://www.npmjs.com/package/sfn-diagram)
- [Issue Tracker](https://github.com/yusufaf/sfn-diagram/issues)
- [AWS Step Functions Documentation](https://docs.aws.amazon.com/step-functions/)
