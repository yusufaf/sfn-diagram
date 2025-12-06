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
- D3.js + JSDOM for Node.js SVG rendering
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

## Notes
- Feel free to use the aws-knowledge MCP tool for AWS Step Functions info
- HelloWorldStateMachine.asl.json in root can be used for testing
- Package is Node.js-only (uses JSDOM, node-html-to-image)

