---
title: Use with your framework
description: Wire sfn-diagram into Next.js, Remix, SvelteKit, Astro, and other frameworks.
---

`generateSvg()` returns an SVG **string** and the core has no DOM dependency, so any
framework can render a diagram by injecting that string. There is nothing React-specific
in the core — [`sfn-diagram-react`](https://github.com/yusufaf/sfn-diagram/tree/main/packages/sfn-diagram-react/) exists for convenience,
not necessity.

Each snippet below is the whole integration. See [API Reference](#api-reference) for the
full option set (`theme`, `layout`, `showIcons`, …) and [`generateMermaid`](#generatemermaidparams)
if you would rather emit Mermaid than SVG.

**Svelte 5**

```svelte
<script lang="ts">
  import { generateSvg } from 'sfn-diagram';

  let { definition } = $props();
  const svg = $derived(generateSvg({ aslDefinition: definition }).svg);
</script>

{@html svg}
```

**Vue 3**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { generateSvg } from 'sfn-diagram';
import type { AslDefinition } from 'sfn-diagram';

const props = defineProps<{ definition: AslDefinition | string }>();
const svg = computed(() => generateSvg({ aslDefinition: props.definition }).svg);
</script>

<template>
  <div v-html="svg" />
</template>
```

**Solid**

```tsx
import { createMemo } from 'solid-js';
import { generateSvg } from 'sfn-diagram';
import type { AslDefinition } from 'sfn-diagram';

export function SfnDiagram(props: { definition: AslDefinition | string }) {
  const svg = createMemo(() => generateSvg({ aslDefinition: props.definition }).svg);
  return <div innerHTML={svg()} />;
}
```

**Angular**

`[innerHTML]` strips SVG unless the value is marked trusted, so the sanitizer bypass is required.

```ts
import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { generateSvg } from 'sfn-diagram';
import type { AslDefinition } from 'sfn-diagram';

@Component({
  selector: 'sfn-diagram',
  template: `<div [innerHTML]="svg()"></div>`,
})
export class SfnDiagramComponent {
  readonly definition = input.required<AslDefinition | string>();
  private readonly sanitizer = inject(DomSanitizer);

  readonly svg = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      generateSvg({ aslDefinition: this.definition() }).svg
    )
  );
}
```

**Astro**

Astro runs the frontmatter at build time, so the diagram ships as static markup with
**zero client-side JavaScript** — the DOM-free core at its best. (Astro also hosts React
islands, so `sfn-diagram-react` works there too if you need interactivity.)

```astro
---
import { generateSvg } from 'sfn-diagram';
// `?raw` gives the file as a string, which `aslDefinition` accepts directly
import definition from '../workflows/order-processing.asl.json?raw';

const { svg } = generateSvg({ aslDefinition: definition, theme: 'light' });
---

<Fragment set:html={svg} />
```

**Vanilla JS / htmx / anything else**

```js
import { generateSvg } from 'sfn-diagram';

const response = await fetch('/workflows/order-processing.asl.json');
const { svg } = generateSvg({ aslDefinition: await response.text() });
document.querySelector('#diagram').innerHTML = svg;
```

> **On the "unsafe HTML" APIs.** Every snippet above uses its framework's raw-HTML escape
> hatch (`{@html}`, `v-html`, `innerHTML`, `dangerouslySetInnerHTML`). The SVG builder
> HTML-escapes every attribute and text value it emits, following the HTML serialization
> algorithm, so state names, comments, and choice conditions taken from your ASL are
> escaped before they reach the string.
