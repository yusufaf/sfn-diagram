# Contributing to sfn-diagram

Thank you for considering contributing to sfn-diagram! This document provides guidelines and instructions for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 18+ or 20+
- pnpm (recommended) or npm

### Installation

1. Fork and clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/sfn-diagram.git
cd sfn-diagram
```

2. Install dependencies:
```bash
pnpm install
# or
npm install
```

3. Run the development build:
```bash
npm run dev
```

## Development Workflow

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build library with tsdown (ESM + CJS) |
| `npm run dev` | Watch mode for development |
| `npm test` | Run test suite with Vitest |
| `npm run typecheck` | TypeScript type checking (no emit) |
| `npm run lint` | Lint code with ESLint |
| `npm run examples` | Run visual output tests |

### Making Changes

1. Create a new branch for your feature or bugfix:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes following the code style guidelines below

3. **Always run tests after making changes:**
```bash
npm test
```

4. Ensure type checking passes:
```bash
npm run typecheck
```

5. Verify the build succeeds:
```bash
npm run build
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
npm test
```

### Test Organization

Place tests in the `tests/` directory:
- `tests/fixtures/` - ASL definition fixtures
- `tests/unit/` - Unit tests for individual modules
- `tests/integration/` - Integration tests for full workflows
- `tests/visual-outputs.test.ts` - Visual output verification

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

1. **Update Documentation**: Update README.md if you've added/changed features
2. **Update Changelog**: Add entry to CHANGELOG.md under `[Unreleased]`
3. **Run All Checks**: Ensure tests, type checking, and linting pass
4. **Commit Message Format**: Use conventional commits format:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Adding/updating tests
   - `chore:` - Maintenance tasks

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
│   ├── index.ts              # Public API exports
│   ├── AslParser.ts          # ASL parsing logic
│   ├── config/               # Configuration and defaults
│   ├── constants/            # Constant values
│   ├── exporters/            # PNG export functionality
│   ├── layout/               # Graph layout (Dagre)
│   ├── renderers/            # SVG and Mermaid renderers
│   ├── styles/               # Styling logic
│   ├── types/                # TypeScript type definitions
│   └── dagre.d.ts            # Type augmentation for dagre
├── tests/                    # Test files
├── dist/                     # Build output (generated)
├── tsdown.config.ts          # Build configuration
├── tsconfig.json             # TypeScript configuration
└── vitest.config.ts          # Test configuration
```

## Build System

The project uses **tsdown** for building:
- Generates dual format outputs (ESM + CJS)
- Auto-generates TypeScript declarations
- Bundles dependencies appropriately
- Platform-neutral output for Node.js

Build artifacts are generated in `dist/` and should never be committed to source control.

## Questions?

If you have questions about contributing, please:
- Open an issue for discussion
- Review existing issues for similar questions
- Check the documentation in README.md

Thank you for contributing to sfn-diagram!
