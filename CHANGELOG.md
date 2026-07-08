# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.5.1...sfn-diagram-v0.6.0) (2026-07-08)


### Features

* **parser:** expand Choice condition operator labels ([913a0dc](https://github.com/yusufaf/sfn-diagram/commit/913a0dcfe60d74dbdbcfe17bdb038e9cf77a4e56))
* **parser:** support JSONata query language ([33a7642](https://github.com/yusufaf/sfn-diagram/commit/33a764249d23c813f41988b0f456ee0ca08ff5ba))
* **parser:** support JSONata query language ([73a10d2](https://github.com/yusufaf/sfn-diagram/commit/73a10d252aada9bf6fb0799efc4307730c9f44f1))
* **renderer:** render Retry policies as labelled self-loops ([4fd29fd](https://github.com/yusufaf/sfn-diagram/commit/4fd29fdbc4e5b374a2962538838304e36a96abb3))


### Bug Fixes

* **diff:** compare states with an order-insensitive structural equality ([713f0e3](https://github.com/yusufaf/sfn-diagram/commit/713f0e39f6efedfc481cd7c52d9051ac5bedabb9))
* **layout:** correct NaN dimensions for Map/Parallel container edges ([b3519a7](https://github.com/yusufaf/sfn-diagram/commit/b3519a7d29c4988f196162687fb67bb4b7b1cf17))
* **parser:** honor includeComments option for node labels ([ab20933](https://github.com/yusufaf/sfn-diagram/commit/ab2093344094cb8867c30f2c81ca430c0654cbc4))
* **parser:** render Distributed Map ItemProcessor states ([6e29e6c](https://github.com/yusufaf/sfn-diagram/commit/6e29e6cd215bbeab005a29de0c8e9bd65432c44c))

## [0.5.1](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.5.0...sfn-diagram-v0.5.1) (2026-07-06)


### Bug Fixes

* **react:** declare core devDependency and drop stale ts-expect-error ([37c1c3e](https://github.com/yusufaf/sfn-diagram/commit/37c1c3e382bda48d58aa1f4ff4ca6f6b474f9571))
* **vscode:** re-render preview on layout/theme change ([bf68996](https://github.com/yusufaf/sfn-diagram/commit/bf689966c5b950a79d281575df6f20b1b4c1ebb3))

## [0.5.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.4.1...sfn-diagram-v0.5.0) (2026-06-28)


### Features

* add generateDiff API and GitHub Action for PR diagram previews ([c1a193b](https://github.com/yusufaf/sfn-diagram/commit/c1a193b7a3091ce17d529cbea57e5621a9a5e257))
* **playground:** add Preview component with tests ([208b693](https://github.com/yusufaf/sfn-diagram/commit/208b6936baace69f59584acffba88c6d2262389d))
* **playground:** add sample ASL definitions ([bf3e16b](https://github.com/yusufaf/sfn-diagram/commit/bf3e16bd1efe6821afba6a175ce7a3de38ed47fb))
* **playground:** add Toolbar and Editor components ([2ea2fa6](https://github.com/yusufaf/sfn-diagram/commit/2ea2fa63f31b37a18dfb5a3707c902146bffaef9))
* **playground:** scaffold vite + react project ([42b1b4c](https://github.com/yusufaf/sfn-diagram/commit/42b1b4c2438c9a31fd4e20b3eefe1b7a17310895))
* **playground:** wire up App root, styles, and dev tooling ([d81462e](https://github.com/yusufaf/sfn-diagram/commit/d81462e26c82ed05dceebacd85d4f3199ce2dc35))
* **react:** add sfn-diagram-react package and monorepo setup ([62ffad0](https://github.com/yusufaf/sfn-diagram/commit/62ffad09e66af218c9fa68d4b4575852dd025468))
* **svg-renderer:** make core DOM-free for browser and edge runtimes ([5ed1333](https://github.com/yusufaf/sfn-diagram/commit/5ed1333c29cf4c9dc7c999662638811a6d7b4b5d))
* **vscode:** add Step Functions Diagram VS Code extension ([a8c7008](https://github.com/yusufaf/sfn-diagram/commit/a8c700893ec1eb1f0ca5f9f4ced65f44a04f362c))


### Bug Fixes

* **ci:** add playground to pnpm workspace and use workspace:* protocol ([067658e](https://github.com/yusufaf/sfn-diagram/commit/067658e3efc5aa141de444f4784d67b78ada9923))
* **types:** add nodeOverrides to DEFAULT_DIAGRAM_OPTIONS to satisfy Required&lt;&gt; ([da06a70](https://github.com/yusufaf/sfn-diagram/commit/da06a7000ed86b2f9311bfe741b3f4f32ccac874))
* **vscode:** open file picker when no active editor instead of showing error ([5b31a7e](https://github.com/yusufaf/sfn-diagram/commit/5b31a7ec0a387a0f58efcb7db84ee7efb201afb8))


### Performance Improvements

* eliminate O(n^2) scans in parser, layout, and SVG renderer ([85c89de](https://github.com/yusufaf/sfn-diagram/commit/85c89de9daa0a72bf99efc492396d5a608da4906))

## [0.4.1](https://github.com/yusufaf/sfn-diagram/compare/v0.4.0...v0.4.1) (2026-05-23)


### Bug Fixes

* drop leading ./ from bin path ([88b2b42](https://github.com/yusufaf/sfn-diagram/commit/88b2b4205cd2b8542932cd939ee865122e5e815a))

## [0.4.0](https://github.com/yusufaf/sfn-diagram/compare/v0.3.0...v0.4.0) (2026-05-23)


### Features

* add CLI entrypoint and docker image ([5768018](https://github.com/yusufaf/sfn-diagram/commit/57680181fb041f8044ad0a2c5caf09bf774710b0))

## [Unreleased]

## [0.3.0] - 2026-05-02

### Added
- New `sfn-diagram/png` sub-path entry point for PNG export — import `exportPng` and `PngExporter` from `sfn-diagram/png`

### Changed
- `exportPng` and `PngExporter` moved from the main `sfn-diagram` entry to `sfn-diagram/png` — users who only need SVG or Mermaid output no longer pay the Puppeteer install cost
- Replaced `d3` umbrella package with direct `d3-selection` and `d3-shape` sub-package imports for reliable tree-shaking
- Removed unused `mermaid` package from dependencies

## [0.2.0] - 2026-01-31

### Added
- Initial implementation of sfn-diagram library
- SVG diagram generation using D3.js and Dagre layout engine
- Mermaid syntax code generation for state diagrams
- PNG export functionality with configurable quality and transparency
- AWS SDK integration via `generateFromAwsResponse()` function
- Support for all ASL state types:
  - Pass: Data transformation states
  - Task: Lambda, Activity, and service integration states
  - Choice: Conditional branching logic
  - Wait: Time-based delays
  - Succeed: Successful termination states
  - Fail: Error termination states
  - Parallel: Concurrent branch execution
  - Map: Array iteration states
- AWS light and dark themes with customization support
- Configurable graph layouts: top-bottom (TB), left-right (LR), right-left (RL), bottom-top (BT)
- Multiple edge path styles: curved, straight, orthogonal
- Function-based API for simple usage patterns
- Class-based API (`SfnDiagramGenerator`) with fluent interface
- Full TypeScript type definitions with zero `any` types
- Comprehensive JSDoc documentation for public API
- Dual ESM/CJS module format support
- Node.js-only package optimized for server-side rendering
- AWS service icons for Task states (opt-in via `showIcons` option)
  - Support for 30+ AWS services (Lambda, DynamoDB, S3, SQS, SNS, ECS, etc.)
  - Configurable icon positioning (left, top, right)
  - Customizable icon size
  - Custom icon resolver support for user-provided icon URLs
  - Icons sourced from jsDelivr CDN (aws-icons package)
  - Automatic service detection from ARN patterns:
    - Direct service ARNs (e.g., `arn:aws:lambda:...`)
    - Service integration ARNs (e.g., `arn:aws:states:::lambda:invoke`)
    - SDK integration ARNs (e.g., `arn:aws:states:::aws-sdk:dynamodb:getItem`)
  - Graceful fallback for unsupported services
- ASL validation with helpful error messages for missing/invalid fields

### Documentation
- Comprehensive README with installation, usage examples, and API reference
- Contributing guidelines with code style standards
- MIT License

## [0.1.1] - 2025-12-25

### Added
- Package validation tools: publint and @arethetypeswrong/cli
- Module format compatibility tests for ESM/CJS
- Automated validation in CI/CD and prepublish lifecycle
- Validation scripts: `validate`, `validate:publint`, `validate:types`

### Fixed
- ESLint configuration now properly ignores dist/ folder during linting
- PNG exporter tests timeout increased to 10s to handle headless browser initialization
- GitHub Actions workflow now uses NPM_TOKEN for npm registry authentication
- Package.json type declaration paths now use stable names (index.d.ts, index.d.cts) via tsdown `hash: false` option
- Package.json exports now use correct "default" key for conditional exports
- Repository URL now uses git+ prefix per npm best practices

### Changed
- Bumped ESLint from v8 to v9
- Disabled tsdown filename hashing for predictable build outputs
- Added prepublishOnly hook to ensure validation before publishing

## [0.1.0] - 2025-12-06

### Added
- Initial release

[Unreleased]: https://github.com/yusufaf/sfn-diagram/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/yusufaf/sfn-diagram/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/yusufaf/sfn-diagram/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/yusufaf/sfn-diagram/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yusufaf/sfn-diagram/releases/tag/v0.1.0
