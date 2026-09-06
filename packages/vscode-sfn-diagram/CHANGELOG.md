# Changelog

All notable changes to the Step Functions Diagram VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
