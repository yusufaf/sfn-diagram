# Bundle Size Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce sfn-diagram's bundled footprint by removing an unused dependency, splitting PNG export into a sub-path entry so Puppeteer is only paid for by users who need it, and switching d3 to direct sub-package imports for reliable tree-shaking.

**Architecture:** Three independent changes applied in sequence. `src/index.ts` becomes the Puppeteer-free core. A new `src/png.ts` entry imports `generateSvg` from the core and `PngExporter` from the exporters layer — clean one-direction dependency. The `d3` umbrella import is replaced by two focused sub-package imports.

**Tech Stack:** TypeScript, tsdown (rollup-based bundler), pnpm, vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Remove `mermaid`; replace `d3` with `d3-selection` + `d3-shape`; add `./png` export path |
| `tsdown.config.ts` | Modify | Add second entry point `png: './src/png.ts'` |
| `src/index.ts` | Modify | Remove `exportPng` function, `PngExporter` class export, and the `PngExporter` import |
| `src/png.ts` | Create | New sub-path entry — exports `exportPng` and `PngExporter` |
| `src/renderers/SvgRenderer.ts` | Modify | Switch `from 'd3'` to sub-package imports |
| `tests/module-formats.test.ts` | Modify | Remove assertion that `exportPng` lives in the main entry |
| `tests/PngExporter.test.ts` | Modify | Update import path to `../src/png` |

---

### Task 1: Remove unused `mermaid` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove `mermaid` from `dependencies` in `package.json`**

  Open `package.json`. In the `"dependencies"` block, delete the `"mermaid"` line entirely:

  ```json
  "dependencies": {
    "@dagrejs/dagre": "^2.0.0",
    "@types/jsdom": "^27.0.0",
    "d3": "^7.8.5",
    "jsdom": "^27.2.0",
    "node-html-to-image": "^5.0.0"
  }
  ```

  (`mermaid` was never imported in source or tests — `MermaidRenderer` only generates Mermaid syntax strings, it does not call the library.)

- [ ] **Step 2: Update the lockfile**

  ```bash
  pnpm install
  ```

  Expected: lockfile updates, `mermaid` removed from resolved deps.

- [ ] **Step 3: Run tests to confirm nothing broke**

  ```bash
  npm test
  ```

  Expected: all tests pass. No test referenced the `mermaid` package.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "chore(deps): remove unused mermaid dependency"
  ```

---

### Task 2: Split PNG export into `sfn-diagram/png` sub-path

**Files:**
- Create: `src/png.ts`
- Modify: `src/index.ts`
- Modify: `tsdown.config.ts`
- Modify: `package.json`
- Modify: `tests/module-formats.test.ts`
- Modify: `tests/PngExporter.test.ts`

- [ ] **Step 1: Update `tests/module-formats.test.ts` to reflect the new module shape**

  The existing test asserts `exportPng` is importable from the main entry. After the split it should not be. Update the test:

  ```typescript
  import { describe, expect, it } from 'vitest';
  import type { AslDefinition } from '../src/types';

  describe('Module Format Compatibility', () => {
      describe('ESM imports', () => {
          it(
              'should import named exports from main entry (no PNG)',
              async () => {
                  const { generateSvg, generateMermaid, generateDiagram, SfnDiagramGenerator } =
                      await import('../src/index');

                  expect(generateSvg).toBeDefined();
                  expect(generateMermaid).toBeDefined();
                  expect(generateDiagram).toBeDefined();
                  expect(SfnDiagramGenerator).toBeDefined();
              },
              15000
          );

          it('should import exportPng from png sub-path', async () => {
              const { exportPng, PngExporter } = await import('../src/png');

              expect(exportPng).toBeDefined();
              expect(typeof exportPng).toBe('function');
              expect(PngExporter).toBeDefined();
          }, 15000);

          it('should work with ESM import for generating SVG', async () => {
              const { generateSvg } = await import('../src/index');

              const asl: AslDefinition = {
                  StartAt: 'Test',
                  States: {
                      Test: { End: true, Type: 'Pass' },
                  },
              };

              const result = generateSvg({ aslDefinition: asl });

              expect(result.svg).toBeDefined();
              expect(result.svg).toContain('<svg');
              expect(result.metadata.nodeCount).toBeGreaterThan(0);
          });

          it('should work with ESM default import fallback', async () => {
              const mod = await import('../src/index');

              expect(mod.generateSvg).toBeDefined();
              expect(mod.SfnDiagramGenerator).toBeDefined();
          });
      });

      describe('Type definitions', () => {
          it('should have correct TypeScript types for ESM', async () => {
              const { generateSvg } = await import('../src/index');

              const asl: AslDefinition = {
                  StartAt: 'Test',
                  States: {
                      Test: { End: true, Type: 'Pass' },
                  },
              };

              const result = generateSvg({
                  aslDefinition: asl,
                  edgeStyle: 'curved',
                  layout: 'TB',
                  nodeHeight: 60,
                  nodeWidth: 120,
                  theme: 'light',
              });

              expect(result).toHaveProperty('svg');
              expect(result).toHaveProperty('height');
              expect(result).toHaveProperty('metadata');
              expect(result).toHaveProperty('width');
              expect(result.metadata).toHaveProperty('nodeCount');
              expect(result.metadata).toHaveProperty('edgeCount');
          });
      });

      describe('Class-based API', () => {
          it('should instantiate SfnDiagramGenerator from ESM', async () => {
              const { SfnDiagramGenerator } = await import('../src/index');

              const asl: AslDefinition = {
                  StartAt: 'Test',
                  States: {
                      Test: { End: true, Type: 'Pass' },
                  },
              };

              const generator = new SfnDiagramGenerator({ theme: 'dark' });
              expect(generator).toBeDefined();
              expect(generator.generateSvg).toBeDefined();

              const result = generator.generateSvg({ aslDefinition: asl });
              expect(result.svg).toBeDefined();
              expect(result.svg).toContain('<svg');
          });
      });
  });
  ```

- [ ] **Step 2: Update `tests/PngExporter.test.ts` to import from the new sub-path**

  Change line 2 from:
  ```typescript
  import { PngExporter } from '../src/exporters';
  ```
  To:
  ```typescript
  import { PngExporter } from '../src/png';
  ```

- [ ] **Step 3: Run tests — expect failures because `src/png.ts` doesn't exist yet**

  ```bash
  npm test -- tests/module-formats.test.ts tests/PngExporter.test.ts
  ```

  Expected: import errors for `../src/png` — confirms tests are wired to the right path.

- [ ] **Step 4: Create `src/png.ts`**

  ```typescript
  import { generateSvg } from './index';
  import { PngExporter } from './exporters';
  import type { ExportPngParams, PngOutput } from './types';

  export { PngExporter } from './exporters';
  export type { ExportPngParams, PngOutput } from './types';

  export async function exportPng(params: ExportPngParams): Promise<PngOutput> {
      const { aslDefinition, ...options } = params;
      const svgOutput = generateSvg({ aslDefinition, ...options });

      const exporter = new PngExporter(options);
      return exporter.convert({
          height: svgOutput.height,
          svg: svgOutput.svg,
          width: svgOutput.width,
      });
  }
  ```

- [ ] **Step 5: Remove `exportPng` and `PngExporter` from `src/index.ts`**

  Remove these lines from `src/index.ts`:

  ```typescript
  import { PngExporter } from './exporters';
  ```

  Remove the `exportPng` function definition — the entire async function block starting with:
  ```typescript
  export async function exportPng(params: ExportPngParams): Promise<PngOutput> {
  ```

  Remove the `exportPng` method from `SfnDiagramGenerator` — the entire method block:
  ```typescript
  async exportPng(params: { aslDefinition: AslDefinition | string }): Promise<PngOutput> {
      return exportPng({ ...params, ...this.options });
  }
  ```

  Remove these from the type/value export block at the bottom:
  ```typescript
  export { PngExporter } from './exporters';
  ```
  And remove `ExportPngParams` and `PngOutput` from the `export type { ... }` block.

- [ ] **Step 6: Run tests — expect all to pass now**

  ```bash
  npm test
  ```

  Expected: all tests pass including `PngExporter.test.ts` and `module-formats.test.ts`.

- [ ] **Step 7: Add `png` entry to `tsdown.config.ts`**

  ```typescript
  import { defineConfig } from 'tsdown';

  export default defineConfig([
      {
          clean: true,
          dts: {
              resolve: true,
          },
          entry: {
              index: './src/index.ts',
          },
          format: ['cjs', 'esm'],
          hash: false,
          outDir: './dist',
          platform: 'neutral',
      },
      {
          dts: {
              resolve: true,
          },
          entry: {
              png: './src/png.ts',
          },
          format: ['cjs', 'esm'],
          hash: false,
          outDir: './dist',
          platform: 'neutral',
      },
  ]);
  ```

- [ ] **Step 8: Add the `./png` export path to `package.json`**

  In the `"exports"` block, add the `./png` sub-path after the root `.` entry:

  ```json
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./png": {
      "import": {
        "types": "./dist/png.d.ts",
        "default": "./dist/png.js"
      },
      "require": {
        "types": "./dist/png.d.cts",
        "default": "./dist/png.cjs"
      }
    }
  }
  ```

- [ ] **Step 9: Build and verify the dist output**

  ```bash
  npm run build
  ```

  Expected: `dist/` now contains `index.js`, `index.cjs`, `png.js`, `png.cjs`, and their `.d.ts` counterparts. No errors.

  Verify `dist/index.js` does NOT import `node-html-to-image`:
  ```bash
  grep "node-html-to-image" dist/index.js
  ```
  Expected: no output (empty).

  Verify `dist/png.js` DOES import `node-html-to-image`:
  ```bash
  grep "node-html-to-image" dist/png.js
  ```
  Expected: one matching line.

- [ ] **Step 10: Commit**

  ```bash
  git add src/png.ts src/index.ts tsdown.config.ts package.json tests/module-formats.test.ts tests/PngExporter.test.ts
  git commit -m "feat: split PNG export into sfn-diagram/png sub-path entry"
  ```

---

### Task 3: Switch d3 imports to sub-packages

**Files:**
- Modify: `src/renderers/SvgRenderer.ts`
- Modify: `package.json`

- [ ] **Step 1: Run existing SVG renderer tests as a baseline**

  ```bash
  npm test -- tests/SvgRenderer.test.ts tests/integration.test.ts
  ```

  Expected: all pass. This is the before-state to compare against after the change.

- [ ] **Step 2: Update `package.json` — swap `d3` for sub-packages**

  In `"dependencies"`, replace:
  ```json
  "d3": "^7.8.5",
  ```
  With:
  ```json
  "d3-selection": "^3.0.0",
  "d3-shape": "^3.2.0",
  ```

  In `"devDependencies"`, remove:
  ```json
  "@types/d3": "^7.4.3",
  ```

  (`d3-selection` v3 and `d3-shape` v3 ship their own TypeScript declarations — no separate `@types` packages needed.)

- [ ] **Step 3: Update imports in `src/renderers/SvgRenderer.ts`**

  Replace line 1:
  ```typescript
  import { select, line, curveBasis } from 'd3';
  ```
  With:
  ```typescript
  import { select } from 'd3-selection';
  import { line, curveBasis } from 'd3-shape';
  ```

- [ ] **Step 4: Install to update lockfile**

  ```bash
  pnpm install
  ```

  Expected: `d3-selection` and `d3-shape` move from transitive to explicit deps. `@types/d3` removed.

- [ ] **Step 5: Run typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 6: Run tests to confirm SVG rendering is unchanged**

  ```bash
  npm test
  ```

  Expected: all tests pass. SVG output is identical — same functions, just imported from sub-packages.

- [ ] **Step 7: Commit**

  ```bash
  git add src/renderers/SvgRenderer.ts package.json pnpm-lock.yaml
  git commit -m "chore(deps): switch d3 to sub-package imports for reliable tree-shaking"
  ```
