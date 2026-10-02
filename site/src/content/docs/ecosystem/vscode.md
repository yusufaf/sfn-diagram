---
title: VS Code extension
description: Preview Step Functions diagrams inside VS Code, Cursor, Windsurf, VSCodium, and Theia.
---

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yusufaf.vscode-sfn-diagram?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=yusufaf.vscode-sfn-diagram)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yusufaf.vscode-sfn-diagram)](https://marketplace.visualstudio.com/items?itemName=yusufaf.vscode-sfn-diagram)
[![Open VSX](https://img.shields.io/open-vsx/v/yusufaf/vscode-sfn-diagram?label=open%20vsx)](https://open-vsx.org/extension/yusufaf/vscode-sfn-diagram)

Preview Step Functions diagrams directly inside your editor. Source in [`packages/vscode-sfn-diagram/`](https://github.com/yusufaf/sfn-diagram/tree/main/packages/vscode-sfn-diagram/).

**Install:** search for **Step Functions Diagram** in the Extensions panel, or:
```bash
code --install-extension yusufaf.vscode-sfn-diagram
```

Published to both the VS Code Marketplace and [Open VSX](https://open-vsx.org/extension/yusufaf/vscode-sfn-diagram), so the Extensions panel finds it in **Cursor, Windsurf, VSCodium, Gitpod, and Eclipse Theia** as well.

The two registries are not always on the same version. Open VSX is published automatically whenever a new extension version is released; the Marketplace is published by hand, because `vsce publish` needs an Azure DevOps credential this repository does not hold, so its listing can trail Open VSX by a release or two. The version badges above report what each registry has right now. [Issue #40](https://github.com/yusufaf/sfn-diagram/issues/40) tracks automating the Marketplace side.

**Usage:** Open any `.json` or `.asl` file and run **Step Functions: Preview Step Functions Diagram** from the command palette, or click the diagram icon in the editor title bar.
