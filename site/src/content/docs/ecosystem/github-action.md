---
title: GitHub Action
description: Comment a Step Functions diagram and diff on every pull request.
---

Comment a Step Functions diagram on every pull request that touches an ASL file. For **changed** files the comment highlights the diff — added states green, modified yellow, removed red — plus a summary table of what changed; **new** and **deleted** files get a plain diagram. Everything is Mermaid, so it renders inline in the PR with no image hosting. The comment is upserted (updated in place) on each push.

Available on the [GitHub Marketplace](https://github.com/marketplace/actions/step-functions-diagram-preview) as [`yusufaf/sfn-diagram-action`](https://github.com/yusufaf/sfn-diagram-action) — pin the moving major tag `@v1`. (Source lives here in [`packages/github-action-sfn-diagram/`](https://github.com/yusufaf/sfn-diagram/tree/main/packages/github-action-sfn-diagram/); the Marketplace repo is generated from it.)

```yaml
# .github/workflows/sfn-preview.yml
name: Step Functions Preview
on:
  pull_request:
    paths: ['**/*.asl.json', '**/*.asl']

permissions:
  contents: read
  pull-requests: write   # required to post the comment

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }   # needed to diff base vs head
      - uses: yusufaf/sfn-diagram-action@v1
```

Inputs: `github-token` (defaults to `${{ github.token }}`), `asl-glob` (comma-separated globs, default `**/*.asl.json,**/*.asl`), `comment-tag` (marker used to find/update the comment, default `sfn-diagram-preview`), `hide-catch` (drop Catch branches, default `false`), `theme` (`light`/`dark`, default `light`), `layout` (`TB`/`LR`/`RL`/`BT`, default `TB`), and `collapse` (`true` to collapse every Parallel/Map container, or a comma-separated list of names, default empty). `hide-catch`, `layout`, `theme`, and `collapse` apply to new/deleted-file diagrams; a modified file's diff diagram honours `layout`/`theme` but ignores `hide-catch`/`collapse` — it renders a merged before/after graph with a per-state status map that dropping or collapsing states would desynchronise.

Optionally overlay a real run: set `execution-mode` (`latest` or `latest-failed`) and `state-machine-arn` to append the most recent (or most recent failed) execution as a Mermaid overlay beneath the diff. This is opt-in (`off` by default), needs AWS credentials (`states:ListExecutions` + `states:GetExecutionHistory`), and applies when exactly one ASL file changed — see the [action README](https://github.com/yusufaf/sfn-diagram/blob/main/packages/github-action-sfn-diagram/README.marketplace.md) for a full workflow.

Outputs: `changed-count`, `changed-files` (a JSON array of the changed paths), `comment-id`, and `comment-url`. Give the step an `id` to read them downstream, e.g. `if: steps.preview.outputs.changed-count != '0'` to gate a later step on whether any diagram actually changed.
