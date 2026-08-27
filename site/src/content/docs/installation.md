---
title: Installation
description: Install sfn-diagram and its optional peer dependencies.
---

```bash
npm install sfn-diagram
```

The core package pulls in **no browser engine** — SVG and Mermaid generation stay lightweight. PNG export relies on a headless browser, provided by the optional peer dependency `node-html-to-image`. Install it only if you use `sfn-diagram/png`:

```bash
npm install sfn-diagram node-html-to-image
```
