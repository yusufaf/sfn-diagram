# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
