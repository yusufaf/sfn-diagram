# sfn-diagram Ecosystem Roadmap

**Date:** 2026-06-27  
**Status:** Approved  
**Approach:** Playground first, monorepo on React package

## Goal

Grow sfn-diagram from a solid core library into a full ecosystem: live playground, React component, VS Code extension, and CI/CD integration. Maximize performance and versatility across library consumers, end users, and platform/CI tooling.

## Strategy

Ship user-visible value fast (playground), then expand ecosystem reach (React component + monorepo), then developer workflow (VS Code), then automation (GitHub Action + diff mode). Each phase builds on the previous without blocking it.

---

## Phase 1: Playground

**Deliverable:** Live interactive playground at GitHub Pages.

**Location:** `playground/` in current repo root.

**Stack:** Vite + React. Deployed via GitHub Actions to GitHub Pages on push to `main`.

**Layout:** Split-pane — Monaco editor (left) for ASL JSON input, live SVG/Mermaid preview (right).

**Toolbar controls:**
- Theme toggle: `light` / `dark`
- Layout direction: `TB` / `LR` / `RL` / `BT`
- Format toggle: `SVG` / `Mermaid` (Mermaid mode shows syntax-highlighted code)
- Sample dropdown: HelloWorld, Choice, Parallel, Map (sourced from existing test fixtures)

**Error handling:** Error banner below toolbar for invalid ASL JSON.

**Rendering:** Imports `sfn-diagram` from npm. SVG renders entirely in-browser — no backend. Works because the DOM-free core refactor (`5ed1333`) already supports browser/edge runtimes.

**No monorepo yet.** Playground uses published npm package until Phase 2.

---

## Phase 2: React Component + Monorepo

**Deliverable:** `sfn-diagram-react` on npm. Monorepo conversion.

**Monorepo structure:**
```
packages/core/     ← current sfn-diagram (published as sfn-diagram)
packages/react/    ← new (published as sfn-diagram-react)
playground/        ← switches to use packages/core via workspace link
```

**Tooling:** pnpm workspaces + Turborepo for build/test/lint pipelines. Release-please updated to handle independent versioning per package.

**`sfn-diagram-react` API:**
```tsx
<SfnDiagram
  asl={definition}         // AslDefinition | string
  theme="light"            // 'light' | 'dark' | CustomTheme
  layout="TB"              // 'TB' | 'LR' | 'RL' | 'BT'
  options={...}            // Partial<DiagramOptions>
  onError={(err) => {}}    // optional error handler
/>
```

- Renders SVG inline as a React component
- Peer dep: React 18+
- Zero runtime deps beyond `sfn-diagram` core

---

## Phase 3: VS Code Extension

**Deliverable:** `sfn-diagram-vscode` on VS Code Marketplace.

**Location:** `packages/vscode/` in monorepo.

**Features:**

1. **Preview panel** — "Open Diagram Preview" command available when an `.asl.json` file is active. Opens a `WebviewPanel` alongside the editor showing live SVG. Updates on file save. Theme follows VS Code light/dark mode.

2. **Status bar** — shows state count (e.g. `⬡ 12 states`) when an ASL file is active.

**Implementation:** Uses `sfn-diagram` core directly. WebviewPanel injects the SVG string into a minimal HTML template. No external network requests from the extension.

**Distribution:** GitHub Actions builds and publishes via `vsce` on tag push.

---

## Phase 4: GitHub Action + Diff Mode

**Deliverables:** `sfn-diagram-action` on GitHub Marketplace. `generateDiff()` API in core.

**GitHub Action (`packages/github-action/`):**
- Inputs: ASL file glob, output directory, format, theme
- On push: generates diagrams, commits them to branch
- On PR: detects ASL changes, posts SVG diff as PR comment

**Diff mode (new core API):**
```ts
generateDiff({ before: AslDefinition, after: AslDefinition, ...options })
// Returns SvgOutput with:
//   added states → green highlight
//   removed states → red highlight
//   changed states → yellow highlight
```

**CLI:** `sfn-diagram --diff before.asl.json after.asl.json -o diff.svg`

**Out of scope:** CDK construct (library users can call core directly; revisit if demand exists).

---

## Non-Goals

- CDK construct (Phase 4 covers CI use case sufficiently)
- Paid hosting / backend
- Support for non-ASL state machine formats

## Open Questions

None — all design decisions resolved.
