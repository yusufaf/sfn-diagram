# sfn-diagram Playground

An interactive browser-based editor for exploring AWS Step Functions ASL definitions and previewing the generated diagrams in real time. Built with [Vite](https://vite.dev), React, and the [Monaco](https://microsoft.github.io/monaco-editor/) editor, wired directly to the local [`sfn-diagram`](../) core.

Paste any ASL JSON, switch between SVG and Mermaid output, change the theme, and see the diagram update instantly.

## Running locally

From the repository root (installs the whole workspace) or from this directory:

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (default http://localhost:5173).

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the Vite dev server with hot reload |
| `pnpm build` | Type-check (`tsc`) and produce a static build in `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run the component tests (Vitest) |
| `pnpm typecheck` | Type-check without emitting |

## Deployment

The playground is deployed to GitHub Pages by the [`Deploy Playground`](../.github/workflows/playground.yml) workflow on every push to `main`. Its Vite `base` is set to `/sfn-diagram/` to match the project Pages path.

This package is private (`"private": true`) and is not published to npm.
