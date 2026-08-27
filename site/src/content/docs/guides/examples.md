---
title: Examples
description: "Complete worked examples: complex workflows, parallel states, and multi-format export."
---

## Complex State Machine

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

## Parallel State Machine

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

## Export Multiple Formats

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
