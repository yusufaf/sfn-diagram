# Step Functions Diagram — VS Code Extension

Preview AWS Step Functions ASL definitions as diagrams directly inside VS Code, powered by [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram).

## Features

- **Live preview** of the state machine as an SVG diagram in a side panel.
- Opens from the command palette or a button in the editor title bar for `.json` / `.asl` files.
- **Layout** (Top→Bottom, Left→Right, Right→Left, Bottom→Top) and **Theme** (light/dark) selectors in the preview toolbar that re-render instantly.
- The preview updates automatically as you edit the underlying file.
- **Execution overlay**: paint a real execution's history onto the diagram — succeeded / failed / caught / not-reached states light up, with a colour legend in the toolbar and a one-click **Clear overlay**.

## Usage

1. Open a Step Functions ASL file (`.json` or `.asl`).
2. Run **Step Functions: Preview Step Functions Diagram** from the command palette (`Ctrl/Cmd+Shift+P`), or click the diagram button in the editor title bar.
3. Use the toolbar dropdowns to change layout and theme.

To overlay a real run, run **Step Functions: Preview Execution Overlay** and pick an execution-history JSON file (a `GetExecutionHistory` response, `{ events: [...] }`, or a raw `HistoryEvent[]`). The run's path lights up on top of the definition; **Clear Execution Overlay** (or the toolbar button) returns to the plain diagram.

## Commands

| Command | Title |
| --- | --- |
| `sfn-diagram.preview` | Preview Step Functions Diagram |
| `sfn-diagram.previewExecution` | Preview Execution Overlay |
| `sfn-diagram.clearExecution` | Clear Execution Overlay |

## Install from source

The extension is not yet published to the Marketplace. To build and install a local `.vsix`:

```bash
cd packages/vscode-sfn-diagram
pnpm install
pnpm package                       # produces vscode-sfn-diagram-<version>.vsix
code --install-extension vscode-sfn-diagram-*.vsix
```

## Development

```bash
pnpm build        # bundle with esbuild -> out/extension.js
pnpm dev          # rebuild on change
pnpm typecheck    # tsc --noEmit
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

Requires VS Code `^1.85.0`.
