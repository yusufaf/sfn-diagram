# Changelog

## [1.4.0](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.3.2...github-action-sfn-diagram-v1.4.0) (2026-09-06)


### Features

* add GitLab merge request integration via sfn-diagram/ci ([#108](https://github.com/yusufaf/sfn-diagram/issues/108)) ([60c1e38](https://github.com/yusufaf/sfn-diagram/commit/60c1e3893a3043b3d621d1cbd4aef9ccd46f38a2))
* **parser:** surface Wait duration and Distributed Map tolerance on the node ([#117](https://github.com/yusufaf/sfn-diagram/issues/117)) ([ca62222](https://github.com/yusufaf/sfn-diagram/commit/ca62222cf9fab71d7816b4b4eabd545e894d6642))
* **viewer:** open a detail panel for the clicked edge ([#114](https://github.com/yusufaf/sfn-diagram/issues/114)) ([2176768](https://github.com/yusufaf/sfn-diagram/commit/21767687e6e507e585e307ee269d77273c94df1a))


### Bug Fixes

* **parser:** scope node ids by nesting so duplicate names stop colliding ([#122](https://github.com/yusufaf/sfn-diagram/issues/122)) ([8a258fc](https://github.com/yusufaf/sfn-diagram/commit/8a258fcef306727de23799291bc9943960b01a5c))
* **parser:** validate nested Parallel branches and Map processors ([#116](https://github.com/yusufaf/sfn-diagram/issues/116)) ([10a7462](https://github.com/yusufaf/sfn-diagram/commit/10a7462f189089d921aa5115e349cf12a20a4570))

## [1.3.2](https://github.com/yusufaf/sfn-diagram/compare/github-action-sfn-diagram-v1.3.1...github-action-sfn-diagram-v1.3.2) (2026-09-03)


### Bug Fixes

* **action:** rebuild bundle with edge identity fixes ([424ed5c](https://github.com/yusufaf/sfn-diagram/commit/424ed5c532b12dcd8618e7c75c66c6bd0738bf79))
* give graph edges a stable identity and stop the execution overlay discarding caller overrides ([796fd14](https://github.com/yusufaf/sfn-diagram/commit/796fd149ec595a18e7ab05667fb8ace5bd2fc362))
* merge record-valued options in setOptions ([541b4cf](https://github.com/yusufaf/sfn-diagram/commit/541b4cf9b0d72d914394626322e4a29e9fa4dace))

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
