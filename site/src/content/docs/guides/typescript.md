---
title: TypeScript
description: Type definitions, strictness, and importing types from sfn-diagram.
---

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

## Without the AWS SDK

`@aws-sdk/client-sfn` is an optional peer. The core package and every subpath except `sfn-diagram/aws` and `sfn-diagram/ci` declare their own structural types (`ExecutionHistoryEvent`, `ExecutionHistoryPage`, `StateMachineDescription`) in place of the SDK's, so a project without the SDK installed type-checks with `skipLibCheck: false`. SDK responses still pass in as is:

```typescript
import type { GetExecutionHistoryCommandOutput } from '@aws-sdk/client-sfn';
import { generateExecution, type AslDefinition } from 'sfn-diagram';

declare const aslDefinition: AslDefinition;
declare const page: GetExecutionHistoryCommandOutput;
generateExecution({ aslDefinition, history: page });
```
