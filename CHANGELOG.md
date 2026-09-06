# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.5.1...sfn-diagram-v1.6.0) (2026-09-06)


### Features

* add GitLab merge request integration via sfn-diagram/ci ([#108](https://github.com/yusufaf/sfn-diagram/issues/108)) ([60c1e38](https://github.com/yusufaf/sfn-diagram/commit/60c1e3893a3043b3d621d1cbd4aef9ccd46f38a2))
* **cli:** ship standalone binaries for linux, macos, and windows ([#126](https://github.com/yusufaf/sfn-diagram/issues/126)) ([dab19ce](https://github.com/yusufaf/sfn-diagram/commit/dab19ce5aa4a714e87d987e790cef77c741bebd3)), closes [#123](https://github.com/yusufaf/sfn-diagram/issues/123)
* **parser:** surface Wait duration and Distributed Map tolerance on the node ([#117](https://github.com/yusufaf/sfn-diagram/issues/117)) ([ca62222](https://github.com/yusufaf/sfn-diagram/commit/ca62222cf9fab71d7816b4b4eabd545e894d6642))
* **viewer:** open a detail panel for the clicked edge ([#114](https://github.com/yusufaf/sfn-diagram/issues/114)) ([2176768](https://github.com/yusufaf/sfn-diagram/commit/21767687e6e507e585e307ee269d77273c94df1a))


### Bug Fixes

* address code review findings on gallery, sitemap, and scripts ([9689acf](https://github.com/yusufaf/sfn-diagram/commit/9689acf3f7828edba92a8a0947329791ed5435c3))
* **jsr:** add the missing ./ci export to jsr.json ([#115](https://github.com/yusufaf/sfn-diagram/issues/115)) ([44e1a15](https://github.com/yusufaf/sfn-diagram/commit/44e1a155236e9930d44f2127c4c54a1673dd009d))
* **layout:** keep a container's header inside the gap left for it ([#120](https://github.com/yusufaf/sfn-diagram/issues/120)) ([5d5e67a](https://github.com/yusufaf/sfn-diagram/commit/5d5e67a5359bc60e194bbdf2e881683beeec69e5))
* **parser:** scope node ids by nesting so duplicate names stop colliding ([#122](https://github.com/yusufaf/sfn-diagram/issues/122)) ([8a258fc](https://github.com/yusufaf/sfn-diagram/commit/8a258fcef306727de23799291bc9943960b01a5c))
* **parser:** validate nested Parallel branches and Map processors ([#116](https://github.com/yusufaf/sfn-diagram/issues/116)) ([10a7462](https://github.com/yusufaf/sfn-diagram/commit/10a7462f189089d921aa5115e349cf12a20a4570))

## [1.5.1](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.5.0...sfn-diagram-v1.5.1) (2026-09-03)


### Bug Fixes

* **docker:** copy scripts/ into the build stage ([0ef1e9d](https://github.com/yusufaf/sfn-diagram/commit/0ef1e9d9c92d23fcb4551c184c6093d2762f14dd))
* **docker:** copy scripts/ into the build stage ([c2ec329](https://github.com/yusufaf/sfn-diagram/commit/c2ec32912518b4acf8556f4779ca1b0a04dcd7e9))

## [1.5.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.4.1...sfn-diagram-v1.5.0) (2026-09-03)


### Features

* **svg-renderer:** emit data-edge-id on edge paths ([84d0b61](https://github.com/yusufaf/sfn-diagram/commit/84d0b61cf41a7d59e3b1bd55d80843098ea03c63))
* **svg-renderer:** emit data-edge-id on rendered edge paths ([4042b47](https://github.com/yusufaf/sfn-diagram/commit/4042b47c93734277292d242a71fdad4fa56e7de3)), closes [#93](https://github.com/yusufaf/sfn-diagram/issues/93)


### Bug Fixes

* **execution:** match caller bare edge-override keys structurally-safely ([91ad4bd](https://github.com/yusufaf/sfn-diagram/commit/91ad4bd8c30f61ce398f2e2bc5b1fe5231b1a01b))
* **execution:** merge caller override maps instead of replacing them ([4410dc2](https://github.com/yusufaf/sfn-diagram/commit/4410dc2b78707cdf7ee2798b20859843ee93d56d))
* give graph edges a stable identity and stop the execution overlay discarding caller overrides ([796fd14](https://github.com/yusufaf/sfn-diagram/commit/796fd149ec595a18e7ab05667fb8ace5bd2fc362))
* **index:** merge record-valued options in setOptions ([fc03cd9](https://github.com/yusufaf/sfn-diagram/commit/fc03cd99e18b132585010662d6e13c10ec6e16c0)), closes [#84](https://github.com/yusufaf/sfn-diagram/issues/84)
* **layout:** fan stacked self-loops into nested arcs ([242471b](https://github.com/yusufaf/sfn-diagram/commit/242471b8dc3a0606c28b4143b6bff6b6d2ad2493))
* **layout:** route parallel edges as distinct dagre edges ([7188069](https://github.com/yusufaf/sfn-diagram/commit/71880698c787ff0ce2a4319fb5a740a83613a15b))
* merge record-valued options in setOptions ([541b4cf](https://github.com/yusufaf/sfn-diagram/commit/541b4cf9b0d72d914394626322e4a29e9fa4dace))
* **parser:** give every graph edge a stable unique id ([9045b12](https://github.com/yusufaf/sfn-diagram/commit/9045b124a9f3784e7c97096f7527dd67471edb42))
* **svg-renderer:** key edge overrides by edge id with legacy fallback ([848ba62](https://github.com/yusufaf/sfn-diagram/commit/848ba62f0160a620f675d5016afb2e29cce3750b))
* **svg-renderer:** stagger LR self-loop labels by max sibling width ([6db9e6d](https://github.com/yusufaf/sfn-diagram/commit/6db9e6ded972b13413e2615315523713b2b6c1f9))
* **svg-renderer:** stagger LR self-loop labels by max sibling width ([7a9528a](https://github.com/yusufaf/sfn-diagram/commit/7a9528a0f7cfc28fd12da3fb854e5379d144830b)), closes [#92](https://github.com/yusufaf/sfn-diagram/issues/92)
* **svg-renderer:** stagger nested self-loop labels by loop index ([68cc059](https://github.com/yusufaf/sfn-diagram/commit/68cc059317e729657ff3f7585b0cc4500be332eb))

## [1.4.1](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.4.0...sfn-diagram-v1.4.1) (2026-09-01)


### Bug Fixes

* **jsr:** move DOM lib triple-slash directive out of published sources ([#88](https://github.com/yusufaf/sfn-diagram/issues/88)) ([36d3f2e](https://github.com/yusufaf/sfn-diagram/commit/36d3f2e5ee17a9ea9867724762579bdcb5e8b1af))

## [1.4.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.3.0...sfn-diagram-v1.4.0) (2026-08-31)


### Features

* add the &lt;sfn-diagram&gt; framework-agnostic custom element ([#69](https://github.com/yusufaf/sfn-diagram/issues/69)) ([92b08fd](https://github.com/yusufaf/sfn-diagram/commit/92b08fd3685d8bd09690b7b5fedca1ae75097a56))
* collapse Parallel/Map containers into placeholder nodes before layout ([#70](https://github.com/yusufaf/sfn-diagram/issues/70)) ([945df70](https://github.com/yusufaf/sfn-diagram/commit/945df70e7adc312b8b09b9cdfaf00051d8359946))
* **playground:** serve at custom domain root instead of /sfn-diagram/ ([7313ee9](https://github.com/yusufaf/sfn-diagram/commit/7313ee948cf166021c781a5d40cd25ca5152dc12))
* **viewer:** add a minimap for navigating large diagrams ([#66](https://github.com/yusufaf/sfn-diagram/issues/66)) ([9a82e83](https://github.com/yusufaf/sfn-diagram/commit/9a82e83472e7e9b765e6223ae1c6357f494b91f7))
* **viewer:** add state search and click-a-state detail panel ([#56](https://github.com/yusufaf/sfn-diagram/issues/56)) ([446b52f](https://github.com/yusufaf/sfn-diagram/commit/446b52f54aaba042cf731783fbf3fc77e03b8b5f))


### Bug Fixes

* address issue [#72](https://github.com/yusufaf/sfn-diagram/issues/72) follow-ups from collapse review ([#74](https://github.com/yusufaf/sfn-diagram/issues/74)) ([0cf56ce](https://github.com/yusufaf/sfn-diagram/commit/0cf56ceb62ec10702899740ed2918523567592b5))
* **playground:** align toolbar dropdowns ([#64](https://github.com/yusufaf/sfn-diagram/issues/64)) ([861eeee](https://github.com/yusufaf/sfn-diagram/commit/861eeeec888b3800a72ce7285e604a469b02b942))
* **test:** isolate perf tests from the puppeteer suite ([#65](https://github.com/yusufaf/sfn-diagram/issues/65)) ([b2ffe4e](https://github.com/yusufaf/sfn-diagram/commit/b2ffe4e04db3aa15460fde6d40631fb4e959a1d2)), closes [#50](https://github.com/yusufaf/sfn-diagram/issues/50)
* three self-loop rendering bugs surfaced by [#75](https://github.com/yusufaf/sfn-diagram/issues/75) (v1.4.0 milestone) ([#86](https://github.com/yusufaf/sfn-diagram/issues/86)) ([ce23a99](https://github.com/yusufaf/sfn-diagram/commit/ce23a998bf52a84d45e9c6972225ec0740c46c0b))
* two v1.4.1 milestone bugs (self-loop routing, diff nodeOverrides merge) ([#80](https://github.com/yusufaf/sfn-diagram/issues/80)) ([ef5fd90](https://github.com/yusufaf/sfn-diagram/commit/ef5fd908913cd146548e8bd2aca0c40d601f9d3f)), closes [#76](https://github.com/yusufaf/sfn-diagram/issues/76)

## [1.3.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.2.0...sfn-diagram-v1.3.0) (2026-08-02)


### Features

* **cli:** add --diff, --execution and icon flags ([cc15e37](https://github.com/yusufaf/sfn-diagram/commit/cc15e379e3913e46db72e5dca2b2ace274d4bf82))
* **parser:** render ASL Variables and Distributed Map details ([2ae20ce](https://github.com/yusufaf/sfn-diagram/commit/2ae20ced9a4a66be67ad154de8b5b07cbf13b05f))


### Bug Fixes

* **graph:** keep Distributed Map I/O satellites when hiding catch branches ([5337434](https://github.com/yusufaf/sfn-diagram/commit/533743484f9e01ea84bbe4e706d6e6f12a3f8574))

## [1.2.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.1.1...sfn-diagram-v1.2.0) (2026-08-01)

**No functional changes to the `sfn-diagram` package.** This version was cut alongside the first npm release of the companion [`sfn-diagram-react`](https://www.npmjs.com/package/sfn-diagram-react) wrapper; the release tooling attributed part of that work to the core package as well.


### Documentation

* add framework usage snippets for Svelte, Vue, Solid, Angular, and Astro ([#45](https://github.com/yusufaf/sfn-diagram/issues/45)) ([5a02f8a](https://github.com/yusufaf/sfn-diagram/commit/5a02f8a))

## [1.1.1](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.1.0...sfn-diagram-v1.1.1) (2026-07-25)


### Bug Fixes

* **ci:** anchor docker tag regex and gate job to sfn-diagram releases ([#36](https://github.com/yusufaf/sfn-diagram/issues/36)) ([c93b84f](https://github.com/yusufaf/sfn-diagram/commit/c93b84f01a8e897fb9d7739e66dcc96ec17055ff))
* **github-action-sfn-diagram:** rebuild stale action bundle ([#38](https://github.com/yusufaf/sfn-diagram/issues/38)) ([ebb6825](https://github.com/yusufaf/sfn-diagram/commit/ebb68253b33b458e9d121e465eb9e694b774c056))

## [1.1.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v1.0.0...sfn-diagram-v1.1.0) (2026-07-25)


### Features

* improve edge label sizing with per-character width heuristic ([2c03d08](https://github.com/yusufaf/sfn-diagram/commit/2c03d088a97077c94ea84938e8da60cfdbbfac60))


### Bug Fixes

* **deps:** bump js-yaml and postcss to patch newly-flagged vulns ([d342114](https://github.com/yusufaf/sfn-diagram/commit/d34211403b38761ce38af5aa312b62e77b6929bd))
* **deps:** bump transitive deps to patch DoS/host-confusion vulns ([67d23c2](https://github.com/yusufaf/sfn-diagram/commit/67d23c2301bd162c368e435a1613f6f07860d9ea))

## [1.0.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.7.0...sfn-diagram-v1.0.0) (2026-07-18)


### ⚠ BREAKING CHANGES

* **deps:** PNG export now requires node-html-to-image ^6.0.0, which requires Node >=22.12.0.

### Features

* **cfn:** accept CloudFormation/SAM/CDK templates as input ([#33](https://github.com/yusufaf/sfn-diagram/issues/33)) ([e485fe1](https://github.com/yusufaf/sfn-diagram/commit/e485fe1be24eb0bedcdee095c61ac33fdb43b91e))
* readability options for large state machines ([#32](https://github.com/yusufaf/sfn-diagram/issues/32)) ([dcc5d88](https://github.com/yusufaf/sfn-diagram/commit/dcc5d881014062a50dc20d6908891bd0a6b5cca8))


### Bug Fixes

* **deps:** require node-html-to-image v6 to clear handlebars CVEs ([#27](https://github.com/yusufaf/sfn-diagram/issues/27)) ([eca8118](https://github.com/yusufaf/sfn-diagram/commit/eca811871f9cf0dc49176894c54bd0cbcfbe2e2b))
* **mermaid:** prevent silent node merge on id collision ([#31](https://github.com/yusufaf/sfn-diagram/issues/31)) ([a2b1263](https://github.com/yusufaf/sfn-diagram/commit/a2b126323bc6b267dfd3791c2b9c5ebd343700ba))


### Performance Improvements

* **parser:** use a Set for state name lookups in validateAsl ([#28](https://github.com/yusufaf/sfn-diagram/issues/28)) ([a6423f8](https://github.com/yusufaf/sfn-diagram/commit/a6423f87b2144423daa98c44911cff6f86364ac6))

## [0.7.0](https://github.com/yusufaf/sfn-diagram/compare/sfn-diagram-v0.6.0...sfn-diagram-v0.7.0) (2026-07-10)


### Features

* **aws:** add fetchExecutionHistory helper on sfn-diagram/aws subpath ([#21](https://github.com/yusufaf/sfn-diagram/issues/21)) ([6123c2a](https://github.com/yusufaf/sfn-diagram/commit/6123c2a22a4d618978c92ec71e2a66fa4f753fd0))
* execution overlay — render a real run onto the diagram ([#19](https://github.com/yusufaf/sfn-diagram/issues/19)) ([8ce3d82](https://github.com/yusufaf/sfn-diagram/commit/8ce3d82da6b834bc63ddbcd5b7078fe9bcca0024))
* **github-action:** optional execution-overlay PR comment ([#23](https://github.com/yusufaf/sfn-diagram/issues/23)) ([5fd4f33](https://github.com/yusufaf/sfn-diagram/commit/5fd4f3376eeaff446495936e20bc6d5b0b25b4fc))
* **github-action:** render colour-highlighted mermaid diff on PRs ([70c81c9](https://github.com/yusufaf/sfn-diagram/commit/70c81c9d90f2069aeeb4dd800d28b87a761334ce))
* **mermaid:** add generateMermaidDiff for highlighted diff diagrams ([0cc5f26](https://github.com/yusufaf/sfn-diagram/commit/0cc5f26ce94a3d524125b21590a041e0136aeb67))
* **vscode:** add execution overlay preview ([#22](https://github.com/yusufaf/sfn-diagram/issues/22)) ([80799ec](https://github.com/yusufaf/sfn-diagram/commit/80799ec3893b390c95d86dbf2032e21c9282e3af))


### Bug Fixes

* **github-action:** avoid Marketplace name collision with mirror repo ([#17](https://github.com/yusufaf/sfn-diagram/issues/17)) ([279cdf1](https://github.com/yusufaf/sfn-diagram/commit/279cdf1193a11e79432b70b56a59858cf8ace83b))
* **github-action:** stop monorepo from being detected as the action ([#18](https://github.com/yusufaf/sfn-diagram/issues/18)) ([166b0cd](https://github.com/yusufaf/sfn-diagram/commit/166b0cde9e1acd964d6577de810c8b3a2be7dfdb))

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
