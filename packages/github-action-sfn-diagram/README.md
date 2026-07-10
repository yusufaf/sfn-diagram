# Step Functions Diagram Preview — GitHub Action

Post AWS Step Functions ASL diagram previews and diffs as a pull-request comment whenever ASL files change. On each PR the action finds changed ASL files, compares the base and head revisions, and posts (or updates) a single comment with per-file **added / modified / removed** state tables and a Mermaid diagram in which changed states are colour-highlighted (added = green, modified = yellow, removed = red) — rendered natively by GitHub, no images to host.

Built on [`sfn-diagram`](https://www.npmjs.com/package/sfn-diagram) (`generateMermaidDiff` + `generateMermaid`).

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
      - uses: yusufaf/sfn-diagram-action@v1
```

> Consume the action from its standalone, Marketplace-published repo
> [`yusufaf/sfn-diagram-action`](https://github.com/yusufaf/sfn-diagram-action),
> pinned to the moving major tag `@v1` (or an exact release like `@v1.0.0`). That
> repo is generated from this package — see [Releasing](#releasing) below.

> The action needs `pull-requests: write` to post the comment, and the full history (`fetch-depth: 0`) to diff the base and head revisions. It only runs on `pull_request` events.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to post/update the PR comment |
| `asl-glob` | `**/*.asl.json,**/*.asl` | Comma-separated glob patterns matching ASL files |
| `comment-tag` | `sfn-diagram-preview` | Marker used to find and update an existing comment |
| `execution-mode` | `off` | `off`, `latest`, or `latest-failed` — overlay a real execution (needs AWS creds; only when exactly one ASL file changed) |
| `state-machine-arn` | `''` | State machine ARN to fetch executions for (required unless `execution-mode: off`) |
| `aws-region` | `''` | Region for the SFN client (defaults to the environment, e.g. `AWS_REGION`) |

When `execution-mode` is enabled, add an AWS auth step (e.g. `aws-actions/configure-aws-credentials`) before this action and grant `states:ListExecutions` + `states:GetExecutionHistory`. See the Marketplace README for a full workflow example.

## Development

The action ships a bundled `dist/index.js` (committed, since GitHub runs the action without installing dependencies). After changing `src/` or bumping the core, rebuild and commit the bundle:

```bash
pnpm --filter github-action-sfn-diagram build
```

CI verifies the committed bundle is up to date, so a stale `dist/` will fail the build.

## Releasing

The action is published to the GitHub Marketplace from a **standalone mirror repo**,
[`yusufaf/sfn-diagram-action`](https://github.com/yusufaf/sfn-diagram-action) — GitHub
only lists an action when its `action.yml` is at the repository root, which this
monorepo subdirectory cannot satisfy. This package is the single source of truth;
the mirror is fully generated from it (`action.yml`, `dist/`, `LICENSE`, and
`README.marketplace.md` → the mirror's `README.md`).

To cut a release:

1. Bump `version` in this package's `package.json` (e.g. `1.0.0` → `1.1.0`).
2. From the repo root, run the sync script (needs `gh` with push access to the mirror):
   ```bash
   pnpm sync:action
   ```
   It rebuilds the bundle, pushes the generated payload to the mirror's `main`,
   creates the immutable `vX.Y.Z` tag, and moves the major `vX` tag that users pin to.
3. Create a GitHub Release for the new `vX.Y.Z` tag in the mirror repo. **First release only:**
   tick *"Publish this Action to the GitHub Marketplace"* (requires accepting the
   Marketplace Developer Agreement once).

Users always pin `@v1`, so moving that major tag ships the update without them changing anything.
