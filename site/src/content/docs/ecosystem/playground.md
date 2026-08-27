---
title: Playground
description: An interactive browser editor for ASL definitions and execution overlays.
---

An interactive browser-based editor for exploring ASL definitions and previewing
diagrams in real time. **[Open the live playground →](/playground/)** — no
install required.

Paste any ASL JSON, switch themes and layouts, and see the SVG diagram update
instantly. Switch **Mode** to _Execution overlay_ to paste an execution history
alongside the definition and watch the run's path light up.

## Running it locally

The playground is part of the documentation site, so it runs with the site's dev
server:

```bash
pnpm install
pnpm run build          # build the library the playground imports
pnpm --filter sfn-diagram-site dev
```

The editor is then served at `/playground`. Its source lives in
[`site/src/components/playground/`](https://github.com/yusufaf/sfn-diagram/tree/main/site/src/components/playground/).
