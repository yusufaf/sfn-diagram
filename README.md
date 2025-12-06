# sfn-diagram

[![npm version](https://img.shields.io/npm/v/sfn-diagram.svg)](https://www.npmjs.com/package/sfn-diagram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Generate beautiful, interactive diagrams from AWS Step Functions ASL (Amazon States Language) definitions. Supports dual output formats: D3.js-based SVG and Mermaid.js diagram code, plus PNG export.

## Features

- **Multiple Output Formats**: SVG (D3.js), Mermaid syntax, and PNG
- **Automatic Layout**: Smart graph positioning using Dagre layout engine
- **Full ASL Support**: All state types (Pass, Task, Choice, Wait, Succeed, Fail, Parallel, Map)
- **Customizable Themes**: AWS light/dark themes plus custom theme support
- **Flexible Layouts**: Top-bottom, left-right, right-left, bottom-top
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **AWS SDK Integration**: Direct integration with AWS Step Functions API
- **Dual APIs**: Function-based and class-based interfaces

## Installation

```bash
npm install sfn-diagram
```

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

const generator = new SfnDiagramGenerator()
  .setAsl(asl)
  .setTheme('dark')
  .setLayout('TB')
  .setNodeDimensions({ width: 150, height: 80 });

const { svg } = generator.generateSvg();
const { mermaid } = generator.generateMermaid();
const { png } = await generator.exportPng();
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

// Returns: { svg: string, width: number, height: number, nodeCount: number }
```

### generateMermaid(params)

Generate Mermaid.js diagram syntax.

```typescript
import { generateMermaid } from 'sfn-diagram';

const result = generateMermaid({
  aslDefinition: asl,
  includeComments: true
});

// Returns: { mermaid: string, nodeCount: number, edgeCount: number }
```

### generateDiagram(params)

Generate both SVG and Mermaid output simultaneously.

```typescript
import { generateDiagram } from 'sfn-diagram';

const result = generateDiagram({
  aslDefinition: asl,
  theme: 'dark'
});

// Returns: { svg: SvgOutput, mermaid: MermaidOutput }
```

### exportPng(params)

Export diagram as PNG image.

```typescript
import { exportPng } from 'sfn-diagram';

const result = await exportPng({
  aslDefinition: asl,
  theme: 'light',
  quality: 1.0,
  transparent: false
});

// Returns: { png: Buffer, width: number, height: number }
writeFileSync('diagram.png', result.png);
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
  awsResponse: response,
  theme: 'dark'
});
```

### SfnDiagramGenerator Class

Fluent interface for generating diagrams.

```typescript
import { SfnDiagramGenerator } from 'sfn-diagram';

const generator = new SfnDiagramGenerator()
  .setAsl(asl)
  .setTheme('dark')
  .setLayout('LR')
  .setNodeDimensions({ width: 150, height: 80 })
  .setSpacing({ rankSeparation: 60, nodeSeparation: 60 })
  .setEdgeStyle('curved')
  .setPadding(30);

// Generate outputs
const svgResult = generator.generateSvg();
const mermaidResult = generator.generateMermaid();
const pngResult = await generator.exportPng({ quality: 1.0 });
```

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
| **Map** | Rectangle | Iterates over array items |

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
import { generateDiagram, exportPng } from 'sfn-diagram';
import { writeFileSync } from 'fs';

// Generate SVG and Mermaid
const { svg, mermaid } = generateDiagram({ aslDefinition: asl });
writeFileSync('diagram.svg', svg.svg);
writeFileSync('diagram.mmd', mermaid.mermaid);

// Generate PNG
const { png } = await exportPng({
  aslDefinition: asl,
  quality: 1.0,
  transparent: false
});
writeFileSync('diagram.png', png);
```

## TypeScript Support

Full TypeScript definitions included:

```typescript
import type {
  AslDefinition,
  DiagramOptions,
  SvgOutput,
  MermaidOutput,
  PngOutput,
  CustomTheme,
  StateType
} from 'sfn-diagram';
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
