# Step Functions Diagram Preview — GitHub Action

Post AWS Step Functions ASL diagram previews and diffs as a pull-request comment whenever ASL files change. On each PR the action finds changed ASL files, compares the base and head revisions, and posts (or updates) a single comment with per-file **added / modified / removed** state tables and collapsible Mermaid diagrams.

Built on [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram) (`generateDiff` + `generateMermaid`).

## Usage

```yaml
# .github/workflows/sfn-preview.yml
name: Step Functions Preview
on:
  pull_request:
    paths: ['**/*.asl.json', '**/*.asl']

permissions:
  contents: read
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0   # needed to diff base vs head
      - uses: yusufaf/sfn-diagram/packages/github-action-sfn-diagram@main
        with:
          theme: light
```

> The action needs `pull-requests: write` to post the comment, and the full history (`fetch-depth: 0`) to diff the base and head revisions. It only runs on `pull_request` events.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to post/update the PR comment |
| `asl-glob` | `**/*.asl.json,**/*.asl` | Comma-separated glob patterns matching ASL files |
| `comment-tag` | `sfn-diagram-preview` | Marker used to find and update an existing comment |
| `theme` | `light` | Theme hint (`light` or `dark`) for Mermaid color classes |

## Development

The action ships a bundled `dist/index.js` (committed, since GitHub runs the action without installing dependencies). After changing `src/` or bumping the core, rebuild and commit the bundle:

```bash
pnpm --filter github-action-sfn-diagram build
```

CI verifies the committed bundle is up to date, so a stale `dist/` will fail the build.
