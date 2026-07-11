# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Library for generating diagrams from AWS Step Functions ASL (Amazon States Language) definitions. Supports dual output: D3.js-based SVG and Mermaid.js diagram code, plus PNG export.

## Documentation Location

- **Implementation Plan**: `C:\Users\Yusuf\basic-memory\sfn-diagram\AWS Step Functions Diagram Generator - Implementation Plan.md`
- **Progress Tracking**: `C:\Users\Yusuf\basic-memory\sfn-diagram\SFN-Diagram Implementation Progress.md`

## Build & Development

- **Build**: `npm run build` - Uses tsdown to generate dual ESM/CJS outputs with declarations
- **Dev**: `npm run dev` - Watch mode
- **Test**: `npm test` - Vitest runner
- **Typecheck**: `npm run typecheck` - No emit, validation only
- **Lint**: `npx eslint .` - TypeScript ESLint + Prettier config

## Architecture

### Core Components

**src/index.ts** - Public API
- Function-based API: `generateDiagram()`, `generateSvg()`, `generateMermaid()`, `exportPng()`
- Class-based API: `SfnDiagramGenerator` with fluent interface
- AWS SDK integration: `generateFromAwsResponse()`

**src/AslParser.ts** - ASL parsing
- `parseAsl()`: Converts ASL definition to graph representation (nodes + edges)
- Handles all state types: Pass, Task, Choice, Wait, Succeed, Fail, Parallel, Map
- Extracts edges for transitions (Next, Choice, Parallel branches, Map iterators, Catch blocks)
- Uses proper TypeScript types (no `any`)

**src/layout/DagreLayout.ts** - Graph layout
- Uses `@dagrejs/dagre` for automatic graph positioning
- Supports multiple layout directions: TB, LR, RL, BT
- Calculates node positions and edge routing

**src/renderers/SvgRenderer.ts** - SVG generation
- DOM-free SVG string builder (`svgBuilder.ts`) + d3-shape for edge paths; runs in Node, browser, and edge runtimes
- Theme-based styling (AWS light/dark themes)
- Supports different node shapes (rect, diamond, circle)
- Curved or straight edge paths

**src/renderers/MermaidRenderer.ts** - Mermaid syntax
- Generates Mermaid state diagram code
- Includes state styling classes
- Proper start/end state handling

**src/exporters/PngExporter.ts** - PNG export
- Converts SVG to PNG using node-html-to-image
- Configurable quality and background

**src/config/** - Configuration
- `themes.ts`: AWS_LIGHT_THEME, AWS_DARK_THEME, custom theme support
- `defaults.ts`: Default diagram options

**src/styles/** - Styling logic
- `NodeStyles.ts`: State-type-specific styling (moved from AslParser)

### Type System (types/index.ts)

Fully typed with no `any`:
- **AslDefinition/AslState**: Complete ASL type definitions
- **StateType**: Union of all state types
- **ChoiceRule/CatchBlock/RetryBlock**: State-specific types
- **StateNode**: Internal graph node with position, style
- **GraphEdge**: Connections with type (normal/error/choice)
- **DiagramOptions**: Comprehensive configuration options
- **SvgOutput/MermaidOutput/PngOutput**: Output types
- **CustomTheme**: Theme customization interface

### State Types Supported

Pass, Task, Choice, Wait, Succeed, Fail, Parallel, Map - each with distinct visual styling and shapes.

## Build Configuration

- **tsdown.config.ts**: Dual format (ESM + CJS), neutral platform
- **tsconfig.json**: Strict mode, ESNext target, isolated modules
- **src/dagre.d.ts**: Custom type declarations for @dagrejs/dagre
- Package exports support both import/require with proper type declarations

## Current Status

✅ **Core Implementation Complete**
- All rendering engines implemented (SVG, Mermaid, PNG)
- Full type safety (no `any` types)
- Public API finalized
- Build succeeds (~54KB gzipped)

🚧 **In Progress**
- Comprehensive test suite needed
- Documentation and examples needed
- Consider barrel exports (index.ts in folders)
- Enhance JSDoc annotations for public API

## Development Guidelines

### Code Style
- Use barrel exports (index.ts) in folders for cleaner imports
- Prefer object parameters for public functions (improves API ergonomics)
- Add detailed JSDoc to all public functions including:
  - Description
  - Parameter descriptions with types
  - Return value description
  - Example usage
  - Edge cases or important notes
- Always alphabetize the properties in Typescript types (in both interfaces and type definitions)
- Prefer using object parameters instead of separate function arguments for Typescript/Javascript functions (Ex: function(params: ParamsType) instead of function(param1, param2) )
- For Typescript types/interfaces being defined for use by an individual function, it should follow the naming convention of the PascalCase version of the function name followed by the "Params" suffix. Example: (For a Typescript function calculateValue, the corresponding type would be named CalculateValueParams)
- Please avoid single letter variable names for things where it isnt explicitly necessary. So places like iterators are fine for naming the index variable, but its not ok to name the variable "n" for a forEach() call on an array named "nodes", each item variable name should instead be named "node", just as an example.

### Testing
- Create fixtures in `tests/fixtures/` for various ASL patterns
- Unit test each module independently
- Integration tests for full workflows
- Snapshot tests for SVG/Mermaid output
- After making changes, please always run the tests afterwards.

## Git Conventions

### Commit Messages — Conventional Commits
Follow the [Conventional Commits](https://www.conventionalcommits.org/) spec:

```
<type>(<optional scope>): <subject>

<optional body>
```

**Types:**
- `feat` — new feature (semver MINOR)
- `fix` — bug fix (semver PATCH)
- `docs` — documentation only
- `refactor` — code change that is neither a fix nor a feature
- `perf` — performance improvement
- `test` — adding or updating tests
- `build` — build system / dependency changes
- `ci` — CI/CD config changes
- `chore` — maintenance tasks (version bumps, config tweaks)

**Rules:**
- Subject is lowercase, imperative mood, no trailing period
- Keep subject under 72 chars
- Never add a `Co-Authored-By` trailer

**Examples:**
```
feat(parser): add support for Map state retry blocks
fix(svg-renderer): correct edge path for self-referencing states
docs: add JSDoc to generateDiagram public API
chore: bump version to 0.3.0
```

### Branch Naming
```
<type>/<short-description>
```
Examples: `feat/map-state-retry`, `fix/svg-edge-path`, `chore/release-0.3.0`

### Changelog
- Sections map to commit types: **Features** (`feat`), **Bug Fixes** (`fix`), **Performance** (`perf`)
- Minor types (`docs`, `refactor`, `test`, `build`, `ci`, `chore`) omitted from public changelog unless notable
- Format each entry as: `- <subject> ([#PR](url))`

### Release Flow — release-please (IMPORTANT)

**Never manually bump `package.json` version, edit `CHANGELOG.md`, create release tags, or run `npm publish`.** The release process is fully automated:

1. Conventional commits on `main` are parsed by [release-please](https://github.com/googleapis/release-please)
2. release-please opens/updates a release PR (e.g. `chore(main): release sfn-diagram 0.5.0`) that bumps the version and writes the changelog
3. Merging that PR triggers the publish workflow — it creates the git tag and publishes to npm automatically

**To ship a release:** merge the open release PR. Nothing else needed.

Commit types that increment the version:
- `feat` → MINOR bump
- `fix` / `perf` → PATCH bump
- `feat!` or `BREAKING CHANGE:` footer → MAJOR bump

**Two packages are release-managed** (see `release-please-config.json`), each with its own version, changelog, and tag:
- `.` — the `sfn-diagram` npm package. Merging the release PR publishes to npm.
- `packages/github-action-sfn-diagram` — the GitHub Action (versioned independently, `private`, not on npm). Commits under that path — including a rebuilt `dist/` bundle from a core change — attribute to it. Merging the release PR runs the `mirror-sync` job, which syncs `scripts/sync-action-mirror.sh` to the Marketplace mirror repo (`yusufaf/sfn-diagram-action`), tags it, and publishes the Release automatically. No manual version bump or `sync:action` run is needed.

release-please emits **one combined release PR** covering both packages. The `mirror-sync` job requires the release GitHub App to be installed on the mirror repo with **Contents: write** (one-time setup). `sync:action` remains available for manual recovery.

## Notes
- Feel free to use the aws-knowledge MCP tool for AWS Step Functions info
- HelloWorldStateMachine.asl.json in root can be used for testing
- Core (`sfn-diagram`: SVG/Mermaid) is platform-agnostic — runs in Node, browser, and edge. Only `sfn-diagram/png` (node-html-to-image) and the CLI are Node-only

