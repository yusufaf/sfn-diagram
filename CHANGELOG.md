# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.4.1...sfn-diagram-v0.5.0) (2026-06-07)


### Features

* add ASL validation and prepare v0.2.0 release ([077fb11](https://github.com/yusufaf/sfn-diagram/commit/077fb11c5e18a62eed2240d80b4b8f106ceedd87))
* Add AWS service icons, JSDoc defaults, and edge handling improvements ([58fb237](https://github.com/yusufaf/sfn-diagram/commit/58fb2379416c4e9c2ccdc46ed5a58b40f3f8029a))
* add CLI entrypoint and docker image ([5768018](https://github.com/yusufaf/sfn-diagram/commit/57680181fb041f8044ad0a2c5caf09bf774710b0))
* split PNG export into sfn-diagram/png sub-path entry ([4b23d0c](https://github.com/yusufaf/sfn-diagram/commit/4b23d0c7e2343d2bb30fa21e76fa24002be0cbbf))


### Bug Fixes

* add typesVersions for sfn-diagram/png node10 resolution ([342335f](https://github.com/yusufaf/sfn-diagram/commit/342335f611e6620bc198d2b2a47b71189a6ca578))
* clean up png entry options spread and tsdown config ([cafc661](https://github.com/yusufaf/sfn-diagram/commit/cafc661ac97bc8a95c15673e2c7837dbf8b2a290))
* correct d3 imports and add explicit type annotations ([54070be](https://github.com/yusufaf/sfn-diagram/commit/54070be8cde9f3703a2bcf994e6afd8a41a54adf))
* drop leading ./ from bin path ([88b2b42](https://github.com/yusufaf/sfn-diagram/commit/88b2b4205cd2b8542932cd939ee865122e5e815a))
* improve npm package compatibility and validation ([ef5c871](https://github.com/yusufaf/sfn-diagram/commit/ef5c871b055fb4dbbe72a3e35bb4216baeda43d6))
* install Chrome for Puppeteer in CI workflows ([3d6d3e9](https://github.com/yusufaf/sfn-diagram/commit/3d6d3e9adad8fc2259cab8263fd77fe30da055ed))
* specify pnpm version in GitHub Actions workflows ([47a041f](https://github.com/yusufaf/sfn-diagram/commit/47a041f5e2b234138649bf51a88557910def91b7))
* use browser-actions/setup-chrome for Puppeteer ([b1c19ae](https://github.com/yusufaf/sfn-diagram/commit/b1c19ae1e5df97afbe74875db6200d4c044e5f98))
* use official @puppeteer/browsers for Chrome installation in CI ([6ad3a70](https://github.com/yusufaf/sfn-diagram/commit/6ad3a7080384f6b038ece2c8ce95c85ffa6eb041))
* use pnpm exec instead of npx for @puppeteer/browsers ([c1d2c95](https://github.com/yusufaf/sfn-diagram/commit/c1d2c958110bd8e58f829d4c0aec768cab254c4d))
* use system Chromium via apt for Puppeteer in CI ([2d8f28c](https://github.com/yusufaf/sfn-diagram/commit/2d8f28c5e81c57cf71d011ffb4da32ee4a142819))

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
