# Contributing to sfn-diagram

Thank you for considering contributing to sfn-diagram! This document provides guidelines and instructions for contributing to the project.

## Development Setup

### Prerequisites

- **Node.js >= 22 to develop the repo.** `pnpm run build` runs `tsdown`, which declares
  `engines.node: ^22.18.0 || ^24.11.0 || >=26` and calls `Promise.withResolvers`
  (Node 22.0+), so on Node 20 the build fails outright with
  `TypeError: Promise.withResolvers is not a function`.

  That is a *toolchain* floor, higher than the package's own. The published package
  declares **Node >= 20** in `package.json#engines` and means it: `tsdown` compiles
  `dist/` for `node20.0.0`, and the `node: '20'` leg of `unit-test.yml` proves it by
  building under 22, switching back to 20, and running the suite and the packed CLI
  there. Node >= 20 covers core, the CLI, and PNG export through the default
  `@resvg/resvg-js` rasterizer; only the opt-in `html-to-image` PNG engine raises the
  runtime floor, to Node >= 22.12.0, because `node-html-to-image` v6 requires it. See
  [`site/src/content/docs/guides/runtimes.md`](site/src/content/docs/guides/runtimes.md).
- **pnpm** — this is a pnpm workspace whose packages depend on each other through the
  `workspace:*` protocol, so `npm install` at the root fails. The version is pinned in
  `package.json#packageManager`; `corepack enable` makes your shell honour it.

### Installation

1. Fork and clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/sfn-diagram.git
cd sfn-diagram
```

2. Install dependencies:
```bash
pnpm install --frozen-lockfile
```

3. Run the development build:
```bash
pnpm run dev
```

## Development Workflow

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Build the viewer script and manifest, then the library with tsdown (ESM + CJS) |
| `pnpm run dev` | Watch mode for development |
| `pnpm test` | Run the Vitest suites (`unit`, `element`, `perf`) |
| `pnpm run typecheck` | TypeScript type checking (no emit) |
| `pnpm run lint` | Lint with ESLint |
| `pnpm run examples` | Run the visual output tests |
| `pnpm run build:viewer-script` | Regenerate the bundled interactive viewer script |
| `pnpm run test:coverage` | Run the `unit` project with coverage |
| `pnpm turbo run typecheck` | Typecheck the root package and every workspace package |

The packages under `packages/` have their own suites; run one with
`pnpm --filter <package> test`, or all three with
`pnpm --filter './packages/*' test`. Note that `pnpm turbo run test` is wider than
that — `.` and `site` are workspace members too, so it also runs the root's full
three-project Vitest run and the docs site's suite.

Run `pnpm run build:viewer-script` after touching anything the viewer bundles. That
is `src/renderers/viewer/`, but **also** the modules the in-browser relayout bundle
inlines: `src/config/`, `src/constants/`, `src/graph/`, `src/layout/`, `src/styles/`,
`src/types/`, `src/renderers/SvgRenderer.ts`, `src/renderers/svgBuilder.ts` and three
files under `src/utils/`. `RELAYOUT_ALLOWED_PREFIXES` in
`scripts/build-viewer-script.mjs` is the authoritative list. The bundled output is
committed, so editing (say) `src/layout/DagreLayout.ts` and skipping the rebuild makes
`pnpm test` fail in its first step with a stale-bundle error rather than a test failure.

### Making Changes

1. Create a new branch, named `<type>/<short-description>` with the same type
   keywords as the commit convention below:
```bash
git checkout -b feat/custom-node-shapes
```

2. Make your changes following the code style guidelines below

3. **Always run tests after making changes:**
```bash
pnpm test
```

4. Ensure type checking passes:
```bash
pnpm run typecheck
```

5. Verify the build succeeds:
```bash
pnpm run build
```

6. Commit your changes with a clear message:
```bash
git commit -m "feat: add support for custom node shapes"
```

## Code Style Guidelines

### General Principles

- **Single Source of Truth**: Avoid duplication. Use barrel exports and shared utilities.
- **Type Safety**: No `any` types. Use proper TypeScript types throughout.
- **Simplicity**: Keep solutions focused and minimal. Avoid over-engineering.

### TypeScript Guidelines

#### 1. Alphabetize Type Properties

Always alphabetize properties in interfaces and type definitions:

```typescript
// ✅ Good
interface DiagramOptions {
  edgeStyle?: EdgeStyle;
  layout?: LayoutDirection;
  nodeHeight?: number;
  nodeWidth?: number;
  padding?: number;
  theme?: Theme | CustomTheme;
}

// ❌ Bad
interface DiagramOptions {
  theme?: Theme | CustomTheme;
  layout?: LayoutDirection;
  padding?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  edgeStyle?: EdgeStyle;
}
```

#### 2. Use Object Parameters

Prefer object parameters over separate function arguments:

```typescript
// ✅ Good
function generateSvg(params: GenerateSvgParams): SvgOutput {
  const { aslDefinition, theme, layout } = params;
  // ...
}

// ❌ Bad
function generateSvg(
  aslDefinition: AslDefinition,
  theme?: Theme,
  layout?: LayoutDirection
): SvgOutput {
  // ...
}
```

#### 3. Function Parameter Type Naming

For types used by individual functions, follow the pattern: `FunctionNameParams`

```typescript
// Function: calculateValue
interface CalculateValueParams {
  input: number;
  multiplier: number;
}

// Function: generateSvg
interface GenerateSvgParams {
  aslDefinition: AslDefinition;
  theme?: Theme | CustomTheme;
}
```

#### 4. Avoid Single-Letter Variable Names

Use descriptive variable names except for common iterators:

```typescript
// ✅ Good
nodes.forEach((node) => {
  console.log(node.id);
});

for (let i = 0; i < items.length; i++) {
  // Iterator is fine
}

// ❌ Bad
nodes.forEach((n) => {
  console.log(n.id);
});
```

### File Organization

#### Barrel Exports

Use `index.ts` files in folders for cleaner imports:

```typescript
// src/renderers/index.ts
export { SvgRenderer } from './SvgRenderer';
export { MermaidRenderer } from './MermaidRenderer';

// Usage
import { SvgRenderer, MermaidRenderer } from './renderers';
```

### Documentation

#### JSDoc for Public API

Add detailed JSDoc to all public functions:

```typescript
/**
 * Generate an SVG diagram from an AWS Step Functions ASL definition
 *
 * This function parses an ASL definition and renders it as an SVG diagram using D3.js
 * with automatic graph layout via Dagre. The output is a complete SVG string that can
 * be saved to a file or embedded in HTML.
 *
 * @param params - Configuration object
 * @param params.aslDefinition - ASL definition as an object or JSON string
 * @param params.theme - Color theme: 'light' (default), 'dark', or a CustomTheme object
 * @param params.layout - Layout direction: 'TB' (top-bottom, default), 'LR', 'RL', or 'BT'
 *
 * @returns SVG output containing the diagram string, dimensions, and metadata
 *
 * @throws {SyntaxError} If params.asl is a string with invalid JSON
 * @throws {Error} If the ASL definition structure is invalid
 *
 * @example
 * ```typescript
 * import { generateSvg } from 'sfn-diagram';
 *
 * const { svg, width, height } = generateSvg({
 *   aslDefinition: asl,
 *   theme: 'dark',
 *   layout: 'LR'
 * });
 * ```
 */
export function generateSvg(params: GenerateSvgParams): SvgOutput {
  // Implementation
}
```

JSDoc should include:
- Clear description
- Parameter descriptions with types
- Return value description
- Example usage
- Edge cases or important notes
- Throws documentation if applicable

## Testing Requirements

### Test Coverage

- Write unit tests for new functionality
- Update existing tests when modifying behavior
- Ensure tests pass before committing:
```bash
pnpm test
```

### Test Organization

Tests live in `tests/`. There is no `unit/` vs `integration/` split — most suites sit
flat at the top level, next to a few topic directories:

- `tests/*.test.ts` — the bulk of the suites, one per module or feature
  (`AslParser.test.ts`, `cli.test.ts`, `diff.test.ts`, `integration.test.ts`,
  `visual-outputs.test.ts`, …)
- `tests/fixtures/` — ASL definition fixtures and execution-history JSON
  (`execution-*.json`)
- `tests/__snapshots__/` — committed Vitest snapshots
- `tests/cfn/`, `tests/ci/`, `tests/config/`, `tests/element/`, `tests/graph/`,
  `tests/viewer/` — topic-scoped suites
- `tests/performance/` — wall-clock performance assertions and a Vitest bench

`vitest.config.ts` splits those into three projects: `element`
(`tests/element/elementRuntime.test.ts` alone), `perf` (`tests/performance/**`) and
`unit` (everything else, including the rest of `tests/element/`). The first two launch
their own Chromium or measure wall-clock time, so they run as separate single-worker
invocations; `pnpm test` runs all three in order.

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { generateSvg } from '../src';

describe('generateSvg', () => {
  it('should generate valid SVG from ASL definition', () => {
    const asl = {
      StartAt: 'HelloWorld',
      States: {
        HelloWorld: { Type: 'Pass', End: true }
      }
    };

    const result = generateSvg({ aslDefinition: asl });

    expect(result.svg).toContain('<svg');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});
```

## Pull Request Process

1. **Update Documentation**: Update README.md and the docs under `site/` if you've
   added or changed features
2. **Leave the changelog and version alone**: `CHANGELOG.md` and the version in
   `package.json` are written by
   [release-please](https://github.com/googleapis/release-please) from the commit
   history. Never edit either by hand, and never create a release tag or publish.
3. **Run All Checks**: Ensure tests, type checking, and linting pass
4. **Commit Message Format**: Use conventional commits format:
   - `feat:` - New feature (semver MINOR)
   - `fix:` - Bug fix (semver PATCH)
   - `perf:` - Performance improvement (semver PATCH)
   - `docs:` - Documentation only
   - `refactor:` - Code change that is neither a fix nor a feature
   - `test:` - Adding/updating tests
   - `build:` - Build system or dependency changes
   - `ci:` - CI/CD config changes
   - `chore:` - Maintenance tasks

   Append `!` (or a `BREAKING CHANGE:` footer) for a breaking change, which release-please
   turns into a MAJOR bump.

5. **Create Pull Request**:
   - Provide clear description of changes
   - Reference any related issues
   - Include screenshots for visual changes

6. **Code Review**: Address feedback and update PR as needed

## Issue Reporting

### Bug Reports

When reporting bugs, please include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- ASL definition that triggers the bug (if applicable)
- Environment details (Node version, OS)
- Error messages or stack traces

### Feature Requests

For feature requests, please include:
- Clear description of the feature
- Use case and motivation
- Example usage (if possible)
- Any alternatives you've considered

## Project Structure

```
sfn-diagram/
├── src/
│   ├── index.ts                # Public API (generateDiagram, generateSvg, ...)
│   ├── AslParser.ts            # ASL -> graph parsing and validation
│   ├── pipeline.ts             # Shared parse -> layout -> render pipeline
│   ├── cli.ts                  # CLI command surface
│   ├── bin.ts                  # CLI entry point (the `sfn-diagram` binary)
│   ├── aws.ts                  # `sfn-diagram/aws` entry (AWS SDK input)
│   ├── cfn.ts                  # `sfn-diagram/cfn` entry (CloudFormation/SAM/CDK)
│   ├── png.ts                  # `sfn-diagram/png` entry (Node-only)
│   ├── html.ts                 # Self-contained HTML documents
│   ├── diff.ts                 # Definition diffing
│   ├── execution.ts            # Execution-history overlays
│   ├── lint.ts                 # ASL lint rules
│   ├── redact.ts               # Redaction hooks for inlined payloads
│   ├── cfn/                    # Template parsing and state-machine extraction
│   ├── ci/                     # `sfn-diagram/ci` entry (PR/MR comment reports)
│   ├── config/                 # Themes, style presets and option defaults
│   ├── constants/              # Shared constant values
│   ├── element/                # The `<sfn-diagram>` custom element
│   ├── exporters/              # PNG exporters (resvg, html-to-image)
│   ├── graph/                  # Container collapse, catch handling, edge identity
│   ├── layout/                 # Graph layout (Dagre)
│   ├── renderers/              # SVG, Mermaid, HTML and interactive viewer
│   ├── services/               # AWS service detection for Task states
│   ├── styles/                 # Node and edge styling
│   ├── types/                  # TypeScript type definitions
│   ├── utils/                  # Icon embedding, text measurement, JSONata helpers
│   ├── dagre.d.ts              # Type augmentation for @dagrejs/dagre
│   └── dom-globals.d.ts        # DOM globals for the browser-side viewer code
├── tests/                      # Vitest suites (see Test Organization above)
├── packages/
│   ├── github-action-sfn-diagram/  # GitHub Action (private; bundled dist/ is committed)
│   ├── sfn-diagram-react/          # React wrapper, published to npm
│   └── vscode-sfn-diagram/         # VS Code extension
├── site/                       # Astro Starlight documentation site
├── scripts/                    # Build, release and image-generation scripts
├── examples/                   # Example ASL definitions
├── docs/images/                # Generated README and gallery images (committed)
├── custom-elements.json        # Custom-elements manifest (generated, committed)
├── jsr.json                    # JSR publish config (no-slow-types applies to src/)
├── Dockerfile                  # CLI container image
├── dist/                       # Library build output (generated, not committed)
├── pnpm-workspace.yaml         # Workspace package globs
├── turbo.json                  # Cross-package task graph
├── tsdown.config.ts            # Build configuration
├── tsconfig.json               # TypeScript configuration
└── vitest.config.ts            # Test projects (unit, element, perf)
```

## Build System

The project uses **tsdown** for building:
- Generates dual format outputs (ESM + CJS)
- Auto-generates TypeScript declarations
- Bundles dependencies appropriately
- Platform-neutral output for Node.js

The library's own build output goes to `dist/` and is not committed. A few generated
files **are** committed on purpose, though, because something outside the build needs
them:

- `packages/github-action-sfn-diagram/dist/` — GitHub runs an Action straight from the
  repository, with no install step, so its bundle has to be in git. Rebuild it with
  `pnpm run build:action-bundle` and commit the result.
- `custom-elements.json` — the custom-elements manifest consumed by editors and the
  docs site. Regenerate it with `pnpm run build:manifest`.
- `src/renderers/viewer/viewerScript.generated.ts` and `viewerRelayout.generated.ts` —
  the bundled viewer code, inlined into generated HTML. Regenerate with
  `pnpm run build:viewer-script`; `pnpm test` checks both are current. The second one
  bundles the layout/render pipeline, so its inputs reach well outside the viewer
  directory — see the note under [Available Commands](#available-commands).
- `docs/images/` — rendered README and gallery images. Regenerate with
  `pnpm run docs:images` and `pnpm run gallery:images`.

So: nothing generated is committed unless it is on that list, and anything on it must
be regenerated and committed in the same change.

## Questions?

If you have questions about contributing, please:
- Open an issue for discussion
- Review existing issues for similar questions
- Check the documentation in README.md

Thank you for contributing to sfn-diagram!
