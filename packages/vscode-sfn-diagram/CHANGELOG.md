# Changelog

All notable changes to the Step Functions Diagram VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0](https://github.com/yusufaf/sfn-diagram/compare/vscode-sfn-diagram-v0.1.1...vscode-sfn-diagram-v0.2.0) (2026-09-13)


### Features

* **vscode:** add a configuration contribution for theme, layout, icons, and auto-preview ([#219](https://github.com/yusufaf/sfn-diagram/issues/219)) ([f7b3008](https://github.com/yusufaf/sfn-diagram/commit/f7b30083e5eb0172b167eb6d114a04afd792aae3))
* **vscode:** render the interactive viewer instead of a static svg ([#223](https://github.com/yusufaf/sfn-diagram/issues/223)) ([1a95972](https://github.com/yusufaf/sfn-diagram/commit/1a95972c04b11cdbea211d2a7ecd16d92c86c89e))


### Bug Fixes

* **viewer:** drop the detail panel to a bottom sheet below 640px ([#247](https://github.com/yusufaf/sfn-diagram/issues/247)) ([771204b](https://github.com/yusufaf/sfn-diagram/commit/771204b8f6b58b1fc3c60599f81da9776b177468))
* **vscode:** debounce edits and patch the viewer instead of rebuilding it ([#227](https://github.com/yusufaf/sfn-diagram/issues/227)) ([06ae3f3](https://github.com/yusufaf/sfn-diagram/commit/06ae3f3b63b5b1a2219ce84c33e9d9a984615aa9))
* **vscode:** show preview buttons only for asl files ([#220](https://github.com/yusufaf/sfn-diagram/issues/220)) ([df11243](https://github.com/yusufaf/sfn-diagram/commit/df11243dbc886d445fbac08c69560c3a2f30cd2d))

## [0.1.1](https://github.com/yusufaf/sfn-diagram/compare/vscode-sfn-diagram-v0.1.0...vscode-sfn-diagram-v0.1.1) (2026-09-06)


### Bug Fixes

* **vscode:** restore asl keyword, drop aws instead ([46f59ac](https://github.com/yusufaf/sfn-diagram/commit/46f59ace53dabfdae254e3ec73e918f45007d53c))

## [Unreleased]

### Fixed

- The preview toolbar's Layout and Theme dropdowns now re-render the diagram immediately, and the selected values persist across re-renders.

## [0.1.0]

### Added

- Live SVG preview of Step Functions ASL definitions in a side panel.
- `sfn-diagram.preview` command and an editor-title button for `.json` / `.asl` files.
- Layout and theme selectors in the preview toolbar.
- Automatic refresh of the preview as the underlying file changes.
