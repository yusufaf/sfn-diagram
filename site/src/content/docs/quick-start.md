---
title: Quick start
description: Render your first diagram with the function-based or class-based API.
---

## Function-based API

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

## Class-based API

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
