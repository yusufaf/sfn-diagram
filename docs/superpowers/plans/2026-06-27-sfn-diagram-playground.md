# sfn-diagram Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live interactive playground deployed to GitHub Pages where anyone can paste ASL JSON and see SVG/Mermaid diagrams instantly, no installation required.

**Architecture:** Standalone Vite + React app in `playground/` at repo root. Imports `sfn-diagram` from npm. All rendering is client-side — the DOM-free SVG renderer already supports browsers. GitHub Actions deploys to GitHub Pages on push to `main` when `playground/**` changes.

**Tech Stack:** React 18, Vite 6, TypeScript (strict), `@monaco-editor/react` 4, `sfn-diagram` ^0.4.1, Vitest 3, @testing-library/react 16

## Global Constraints

- React 18+
- Vite 6 (standalone playground — does not inherit root pnpm overrides)
- `sfn-diagram` imported from npm `^0.4.1` (local workspace link happens in Phase 2)
- GitHub Pages base path: `/sfn-diagram/`
- No backend, no external API calls
- TypeScript strict mode
- Properties in TS interfaces/types alphabetized (project convention)
- Object parameter style for functions with >1 arg (project convention)

---

## File Structure

```
playground/
  package.json                   — deps, scripts
  pnpm-lock.yaml                 — committed lock file (needed by CI cache)
  vite.config.ts                 — React plugin, base path, vitest jsdom env
  tsconfig.json                  — React JSX, strict, bundler module resolution
  index.html                     — HTML shell
  src/
    main.tsx                     — ReactDOM.createRoot entry point
    App.tsx                      — root state (asl/theme/layout/format), layout
    index.css                    — global styles, CSS custom properties for theming
    test-setup.ts                — @testing-library/jest-dom import
    samples/
      index.ts                   — 4 sample ASL strings (helloWorld, choice, parallel, map)
    components/
      Editor.tsx                 — @monaco-editor/react wrapper (UI only, no logic)
      Preview.tsx                — calls generateSvg/generateMermaid, renders error banner
      Preview.test.tsx           — unit tests for Preview rendering and error handling
      Toolbar.tsx                — sample selector + theme/layout/format dropdowns
.github/
  workflows/
    playground.yml               — build + deploy to GitHub Pages
```

---

### Task 1: Scaffold playground project

**Files:**
- Create: `playground/package.json`
- Create: `playground/vite.config.ts`
- Create: `playground/tsconfig.json`
- Create: `playground/index.html`
- Create: `playground/src/main.tsx` (minimal)
- Create: `playground/src/test-setup.ts`

**Interfaces:**
- Produces: `pnpm dev` starts dev server on `http://localhost:5173/sfn-diagram/`; `pnpm test` runs vitest; `pnpm build` outputs `playground/dist/`

- [ ] **Step 1: Create `playground/package.json`**

```json
{
  "name": "sfn-diagram-playground",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc && vite build",
    "dev": "vite",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "sfn-diagram": "^0.4.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.0",
    "vite": "^6.3.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `playground/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    base: '/sfn-diagram/',
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test-setup.ts'],
    },
})
```

- [ ] **Step 3: Create `playground/tsconfig.json`**

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2020",
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `playground/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>sfn-diagram playground</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `playground/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Create minimal `playground/src/main.tsx`** (will be replaced in Task 5)

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <div>playground</div>
    </React.StrictMode>
)
```

- [ ] **Step 7: Install dependencies**

```bash
cd playground && pnpm install
```

Expected: `node_modules/` and `pnpm-lock.yaml` created, no errors.

- [ ] **Step 8: Verify dev server starts**

```bash
cd playground && pnpm dev
```

Expected: Vite dev server starts. Browser at `http://localhost:5173/sfn-diagram/` shows "playground". Stop server with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add playground/
git commit -m "feat(playground): scaffold vite + react project"
```

---

### Task 2: Sample ASL definitions

**Files:**
- Create: `playground/src/samples/index.ts`

**Interfaces:**
- Produces:
  - `type SampleKey = 'choice' | 'helloWorld' | 'map' | 'parallel'`
  - `SAMPLES: Record<SampleKey, string>` — each value is a pretty-printed JSON string
  - `SAMPLE_KEYS: SampleKey[]` — ordered list for the dropdown
  - `SAMPLE_LABELS: Record<SampleKey, string>` — display names

- [ ] **Step 1: Create `playground/src/samples/index.ts`**

```ts
export type SampleKey = 'choice' | 'helloWorld' | 'map' | 'parallel'

export const SAMPLE_KEYS: SampleKey[] = ['helloWorld', 'choice', 'parallel', 'map']

export const SAMPLE_LABELS: Record<SampleKey, string> = {
    choice: 'Choice',
    helloWorld: 'Hello World',
    map: 'Map',
    parallel: 'Parallel',
}

export const SAMPLES: Record<SampleKey, string> = {
    choice: JSON.stringify(
        {
            Comment: 'Choice state example',
            StartAt: 'CheckValue',
            States: {
                CheckValue: {
                    Choices: [
                        { Next: 'HighPath', NumericGreaterThan: 10, Variable: '$.value' },
                        { Next: 'LowPath', NumericLessThanEquals: 10, Variable: '$.value' },
                    ],
                    Type: 'Choice',
                },
                HighPath: { End: true, Result: 'high', Type: 'Pass' },
                LowPath: { End: true, Result: 'low', Type: 'Pass' },
            },
        },
        null,
        2
    ),

    helloWorld: JSON.stringify(
        {
            Comment: 'A simple Hello World state machine',
            StartAt: 'HelloWorld',
            States: {
                HelloWorld: {
                    End: true,
                    Result: 'Hello, World!',
                    Type: 'Pass',
                },
            },
        },
        null,
        2
    ),

    map: JSON.stringify(
        {
            Comment: 'Map state example',
            StartAt: 'ProcessItems',
            States: {
                Done: { End: true, Type: 'Succeed' },
                ProcessItems: {
                    ItemsPath: '$.items',
                    Iterator: {
                        StartAt: 'ProcessItem',
                        States: {
                            ProcessItem: { End: true, Type: 'Pass' },
                        },
                    },
                    Next: 'Done',
                    Type: 'Map',
                },
            },
        },
        null,
        2
    ),

    parallel: JSON.stringify(
        {
            Comment: 'Parallel state example',
            StartAt: 'ParallelWork',
            States: {
                Done: { End: true, Type: 'Succeed' },
                ParallelWork: {
                    Branches: [
                        {
                            StartAt: 'BranchA',
                            States: { BranchA: { End: true, Type: 'Pass' } },
                        },
                        {
                            StartAt: 'BranchB',
                            States: { BranchB: { End: true, Type: 'Pass' } },
                        },
                    ],
                    Next: 'Done',
                    Type: 'Parallel',
                },
            },
        },
        null,
        2
    ),
}
```

- [ ] **Step 2: Commit**

```bash
git add playground/src/samples/
git commit -m "feat(playground): add sample ASL definitions"
```

---

### Task 3: Preview component (TDD)

**Files:**
- Create: `playground/src/components/Preview.test.tsx`
- Create: `playground/src/components/Preview.tsx`

**Interfaces:**
- Consumes: `generateMermaid({ aslDefinition })`, `generateSvg({ aslDefinition, layout, theme })` from `sfn-diagram`
- Produces: `Preview` component — `({ asl: string, format: 'mermaid' | 'svg', layout: LayoutDirection, theme: ThemeOption }) => JSX.Element`

- [ ] **Step 1: Write the failing test — create `playground/src/components/Preview.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Preview } from './Preview'

const SIMPLE_ASL = JSON.stringify({
    StartAt: 'Hello',
    States: {
        Hello: { End: true, Type: 'Pass' },
    },
})

describe('Preview', () => {
    it('renders an SVG element for valid ASL in svg format', () => {
        const { container } = render(
            <Preview asl={SIMPLE_ASL} format="svg" layout="TB" theme="light" />
        )
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('shows error alert for invalid JSON', () => {
        render(<Preview asl="not valid json" format="svg" layout="TB" theme="light" />)
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('displays error message text for invalid ASL', () => {
        render(<Preview asl="{" format="svg" layout="TB" theme="light" />)
        const alert = screen.getByRole('alert')
        expect(alert.textContent).toBeTruthy()
    })

    it('renders a pre element containing mermaid code for mermaid format', () => {
        const { container } = render(
            <Preview asl={SIMPLE_ASL} format="mermaid" layout="TB" theme="light" />
        )
        const pre = container.querySelector('pre')
        expect(pre).toBeTruthy()
        expect(pre?.textContent).toContain('stateDiagram-v2')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd playground && pnpm test
```

Expected: FAIL — `Cannot find module './Preview'`

- [ ] **Step 3: Create `playground/src/components/Preview.tsx`**

```tsx
import { useMemo } from 'react'
import { generateMermaid, generateSvg } from 'sfn-diagram'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'

interface PreviewProps {
    asl: string
    format: 'mermaid' | 'svg'
    layout: LayoutDirection
    theme: ThemeOption
}

interface RenderResult {
    code?: string
    error?: string
    svg?: string
    type: 'error' | 'mermaid' | 'svg'
}

interface RenderDiagramParams {
    asl: string
    format: 'mermaid' | 'svg'
    layout: LayoutDirection
    theme: ThemeOption
}

function renderDiagram(params: RenderDiagramParams): RenderResult {
    const { asl, format, layout, theme } = params
    try {
        if (format === 'mermaid') {
            const { code } = generateMermaid({ aslDefinition: asl })
            return { code, type: 'mermaid' }
        }
        const { svg } = generateSvg({ aslDefinition: asl, layout, theme })
        return { svg, type: 'svg' }
    } catch (err) {
        return {
            error: err instanceof Error ? err.message : String(err),
            type: 'error',
        }
    }
}

export function Preview({ asl, format, layout, theme }: PreviewProps) {
    const result = useMemo(
        () => renderDiagram({ asl, format, layout, theme }),
        [asl, format, layout, theme]
    )

    if (result.type === 'error') {
        return (
            <div className="error-banner" role="alert">
                {result.error}
            </div>
        )
    }

    if (result.type === 'mermaid') {
        return <pre className="mermaid-code">{result.code}</pre>
    }

    return (
        <div
            className="svg-preview"
            dangerouslySetInnerHTML={{ __html: result.svg! }}
        />
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd playground && pnpm test
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add playground/src/components/
git commit -m "feat(playground): add Preview component with tests"
```

---

### Task 4: Toolbar and Editor components

**Files:**
- Create: `playground/src/components/Toolbar.tsx`
- Create: `playground/src/components/Editor.tsx`

**Interfaces:**
- Consumes:
  - `SAMPLES`, `SAMPLE_KEYS`, `SAMPLE_LABELS`, `SampleKey` from `../samples`
  - `LayoutDirection`, `ThemeOption` from `sfn-diagram`
- Produces:
  - `Toolbar` — `({ format, layout, onFormatChange, onLayoutChange, onSampleSelect, onThemeChange, theme }) => JSX.Element`
  - `Editor` — `({ monacoTheme: string, onChange: (value: string) => void, value: string }) => JSX.Element`

- [ ] **Step 1: Create `playground/src/components/Toolbar.tsx`**

```tsx
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { SAMPLE_KEYS, SAMPLE_LABELS, SAMPLES } from '../samples'
import type { SampleKey } from '../samples'

interface ToolbarProps {
    format: 'mermaid' | 'svg'
    layout: LayoutDirection
    onFormatChange: (format: 'mermaid' | 'svg') => void
    onLayoutChange: (layout: LayoutDirection) => void
    onSampleSelect: (asl: string) => void
    onThemeChange: (theme: ThemeOption) => void
    theme: ThemeOption
}

export function Toolbar({
    format,
    layout,
    onFormatChange,
    onLayoutChange,
    onSampleSelect,
    onThemeChange,
    theme,
}: ToolbarProps) {
    return (
        <div className="toolbar">
            <span className="toolbar-title">sfn-diagram</span>

            <label className="toolbar-group">
                Sample:
                <select onChange={(e) => onSampleSelect(SAMPLES[e.target.value as SampleKey])}>
                    {SAMPLE_KEYS.map((key) => (
                        <option key={key} value={key}>
                            {SAMPLE_LABELS[key]}
                        </option>
                    ))}
                </select>
            </label>

            <label className="toolbar-group">
                Theme:
                <select onChange={(e) => onThemeChange(e.target.value as ThemeOption)} value={theme}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
            </label>

            <label className="toolbar-group">
                Layout:
                <select
                    onChange={(e) => onLayoutChange(e.target.value as LayoutDirection)}
                    value={layout}
                >
                    <option value="TB">Top → Bottom</option>
                    <option value="LR">Left → Right</option>
                    <option value="RL">Right → Left</option>
                    <option value="BT">Bottom → Top</option>
                </select>
            </label>

            <label className="toolbar-group">
                Format:
                <select
                    onChange={(e) => onFormatChange(e.target.value as 'mermaid' | 'svg')}
                    value={format}
                >
                    <option value="svg">SVG</option>
                    <option value="mermaid">Mermaid</option>
                </select>
            </label>
        </div>
    )
}
```

- [ ] **Step 2: Create `playground/src/components/Editor.tsx`**

```tsx
import MonacoEditor from '@monaco-editor/react'

interface EditorProps {
    monacoTheme: string
    onChange: (value: string) => void
    value: string
}

export function Editor({ monacoTheme, onChange, value }: EditorProps) {
    return (
        <MonacoEditor
            height="100%"
            language="json"
            loading={<div className="editor-loading">Loading editor…</div>}
            onChange={(val) => onChange(val ?? '')}
            options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
            }}
            theme={monacoTheme}
            value={value}
        />
    )
}
```

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
cd playground && pnpm test
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add playground/src/components/Toolbar.tsx playground/src/components/Editor.tsx
git commit -m "feat(playground): add Toolbar and Editor components"
```

---

### Task 5: App root, styles, and wiring

**Files:**
- Create: `playground/src/index.css`
- Create: `playground/src/App.tsx`
- Modify: `playground/src/main.tsx`

**Interfaces:**
- Consumes: `Preview`, `Toolbar`, `Editor` from `./components/`, `SAMPLES` from `./samples`, `LayoutDirection`, `ThemeOption` from `sfn-diagram`
- Produces: fully functional playground — split-pane layout, all controls wired, dark mode propagated to Monaco and SVG renderer

- [ ] **Step 1: Create `playground/src/index.css`**

```css
:root {
    --bg: #ffffff;
    --border: #e2e8f0;
    --error-bg: #fff5f5;
    --error-text: #c53030;
    --text: #1a202c;
    --toolbar-bg: #f7fafc;
}

[data-theme='dark'] {
    --bg: #1a202c;
    --border: #2d3748;
    --error-bg: #742a2a;
    --error-text: #feb2b2;
    --text: #e2e8f0;
    --toolbar-bg: #2d3748;
}

*,
*::before,
*::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

html,
body,
#root {
    height: 100%;
    overflow: hidden;
}

.app {
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
    font-family: system-ui, sans-serif;
    height: 100%;
}

.toolbar {
    align-items: center;
    background: var(--toolbar-bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-shrink: 0;
    gap: 16px;
    padding: 8px 16px;
}

.toolbar-title {
    font-size: 15px;
    font-weight: 600;
    margin-right: 8px;
}

.toolbar-group {
    align-items: center;
    display: flex;
    font-size: 13px;
    gap: 6px;
}

.toolbar-group select {
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    padding: 3px 6px;
}

.panes {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1fr;
    overflow: hidden;
}

.editor-pane {
    border-right: 1px solid var(--border);
    overflow: hidden;
}

.editor-loading {
    align-items: center;
    color: var(--text);
    display: flex;
    font-size: 13px;
    height: 100%;
    justify-content: center;
    opacity: 0.5;
}

.preview-pane {
    align-items: flex-start;
    display: flex;
    justify-content: center;
    overflow: auto;
    padding: 16px;
}

.svg-preview svg {
    height: auto;
    max-width: 100%;
}

.mermaid-code {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 13px;
    white-space: pre;
}

.error-banner {
    background: var(--error-bg);
    border-radius: 4px;
    color: var(--error-text);
    font-family: monospace;
    font-size: 13px;
    padding: 12px 16px;
    width: 100%;
}
```

- [ ] **Step 2: Create `playground/src/App.tsx`**

```tsx
import { useState } from 'react'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { Toolbar } from './components/Toolbar'
import { SAMPLES } from './samples'

type Format = 'mermaid' | 'svg'

export function App() {
    const [asl, setAsl] = useState(SAMPLES.helloWorld)
    const [format, setFormat] = useState<Format>('svg')
    const [layout, setLayout] = useState<LayoutDirection>('TB')
    const [theme, setTheme] = useState<ThemeOption>('light')

    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs-light'

    return (
        <div className="app" data-theme={theme}>
            <Toolbar
                format={format}
                layout={layout}
                onFormatChange={setFormat}
                onLayoutChange={setLayout}
                onSampleSelect={setAsl}
                onThemeChange={setTheme}
                theme={theme}
            />
            <div className="panes">
                <div className="editor-pane">
                    <Editor monacoTheme={monacoTheme} onChange={setAsl} value={asl} />
                </div>
                <div className="preview-pane">
                    <Preview asl={asl} format={format} layout={layout} theme={theme} />
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Update `playground/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
```

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
cd playground && pnpm test
```

Expected: 4 tests pass.

- [ ] **Step 5: Start dev server and verify manually**

```bash
cd playground && pnpm dev
```

Open `http://localhost:5173/sfn-diagram/`. Verify all of:
- Monaco editor shows HelloWorld ASL JSON
- SVG diagram renders on the right
- Switching Theme to Dark updates diagram colors and app background; Monaco switches to dark theme
- Changing Layout direction re-renders the diagram
- Selecting a sample from the dropdown loads its ASL into the editor and re-renders
- Switching Format to Mermaid shows `stateDiagram-v2` code in a `<pre>`
- Pasting invalid JSON (e.g. `{bad`) shows a red error banner
- Fixing the JSON clears the error and shows the diagram

Stop server with Ctrl+C.

- [ ] **Step 6: Build to verify production output is clean**

```bash
cd playground && pnpm build
```

Expected: `playground/dist/` created, no TypeScript or Vite errors.

- [ ] **Step 7: Commit**

```bash
git add playground/src/
git commit -m "feat(playground): wire app root with all components and styles"
```

---

### Task 6: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/playground.yml`

**Interfaces:**
- Produces: automatic deployment to `https://yusufaf.github.io/sfn-diagram/` on push to `main` when `playground/**` changes

- [ ] **Step 1: Enable GitHub Pages in repo settings**

Navigate to the GitHub repo → Settings → Pages → Source → select **"GitHub Actions"**. Save.

- [ ] **Step 2: Create `.github/workflows/playground.yml`**

```yaml
name: Deploy Playground

on:
  push:
    branches: [main]
    paths:
      - 'playground/**'
  workflow_dispatch:

permissions:
  contents: read
  id-token: write
  pages: write

concurrency:
  cancel-in-progress: false
  group: pages

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          cache: pnpm
          cache-dependency-path: playground/pnpm-lock.yaml
          node-version: 20
      - run: pnpm install
        working-directory: playground
      - run: pnpm build
        working-directory: playground
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: playground/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Run final tests**

```bash
cd playground && pnpm test
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/playground.yml
git commit -m "ci: deploy playground to GitHub Pages"
git push
```

Expected: GitHub Actions "Deploy Playground" workflow triggers. After it completes, `https://yusufaf.github.io/sfn-diagram/` shows the live playground.
