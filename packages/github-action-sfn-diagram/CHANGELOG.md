# Changelog

## [1.3.1](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.3.0...github-action-sfn-diagram-v1.3.1) (2026-08-31)


### Bug Fixes

* address issue [#72](https://github.com/yusufaf/sfn-diagram/issues/72) follow-ups from collapse review ([#74](https://github.com/yusufaf/sfn-diagram/issues/74)) ([0cf56ce](https://github.com/yusufaf/sfn-diagram/commit/0cf56ceb62ec10702899740ed2918523567592b5))
* three self-loop rendering bugs surfaced by [#75](https://github.com/yusufaf/sfn-diagram/issues/75) (v1.4.0 milestone) ([#86](https://github.com/yusufaf/sfn-diagram/issues/86)) ([ce23a99](https://github.com/yusufaf/sfn-diagram/commit/ce23a998bf52a84d45e9c6972225ec0740c46c0b))

## [1.3.0](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.2.1...github-action-sfn-diagram-v1.3.0) (2026-08-02)


### Features

* **parser:** render ASL Variables and Distributed Map details ([2ae20ce](https://github.com/yusufaf/sfn-diagram/commit/2ae20ced9a4a66be67ad154de8b5b07cbf13b05f))


### Bug Fixes

* **graph:** keep Distributed Map I/O satellites when hiding catch branches ([5337434](https://github.com/yusufaf/sfn-diagram/commit/533743484f9e01ea84bbe4e706d6e6f12a3f8574))

## [1.2.1](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.2.0...github-action-sfn-diagram-v1.2.1) (2026-07-25)


### Bug Fixes

* **github-action-sfn-diagram:** rebuild stale action bundle ([#38](https://github.com/yusufaf/sfn-diagram/issues/38)) ([ebb6825](https://github.com/yusufaf/sfn-diagram/commit/ebb68253b33b458e9d121e465eb9e694b774c056))

## [1.2.0](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.1.0...github-action-sfn-diagram-v1.2.0) (2026-07-18)


### Features

* readability options for large state machines ([#32](https://github.com/yusufaf/sfn-diagram/issues/32)) ([dcc5d88](https://github.com/yusufaf/sfn-diagram/commit/dcc5d881014062a50dc20d6908891bd0a6b5cca8))


### Bug Fixes

* **mermaid:** prevent silent node merge on id collision ([#31](https://github.com/yusufaf/sfn-diagram/issues/31)) ([a2b1263](https://github.com/yusufaf/sfn-diagram/commit/a2b126323bc6b267dfd3791c2b9c5ebd343700ba))


### Performance Improvements

* **parser:** use a Set for state name lookups in validateAsl ([#28](https://github.com/yusufaf/sfn-diagram/issues/28)) ([a6423f8](https://github.com/yusufaf/sfn-diagram/commit/a6423f87b2144423daa98c44911cff6f86364ac6))

## [1.1.0](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.0.0...github-action-sfn-diagram-v1.1.0) (2026-07-11)


### Features

* **github-action:** optional execution-overlay PR comment ([#23](https://github.com/yusufaf/sfn-diagram/issues/23)) ([5fd4f33](https://github.com/yusufaf/sfn-diagram/commit/5fd4f3376eeaff446495936e20bc6d5b0b25b4fc))
