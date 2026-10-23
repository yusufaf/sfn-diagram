---
title: GitLab CI
description: Comment a Step Functions diagram and diff on every merge request.
---

Comment a Step Functions diagram on every merge request that touches an ASL file, from a plain CI job — no marketplace listing, no separate install. `new` and `deleted` files get a plain diagram; `changed` files get a diff-highlighted diagram plus a change-summary table, and any [`lintAsl`](/reference/index/functions/lintasl/) findings for the new revision appear in a collapsed **🔍 Lint** section. The note is upserted (updated in place) on each push.

```yaml
# .gitlab-ci.yml
sfn-preview:
  stage: test
  image: ghcr.io/yusufaf/sfn-diagram:1
  variables:
    GIT_DEPTH: 0   # needed to diff the merge request's base commit
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - sfn-diagram comment gitlab
  artifacts:
    expose_as: 'Step Functions diagram'
    paths: [sfn-diagram-artifacts/]
    when: on_success
```

Options: `--asl-glob` (comma-separated globs, default `**/*.asl.json,**/*.asl`), `--comment-tag` (marker used to find/update the note, default `sfn-diagram-preview`), `--theme`, `--layout`, `--collapse` (bare for every container, or `--collapse=GroupA,GroupB`), `--no-collapse`, `--hide-catch`, `--show-catch`, `--config` (see [Project defaults](#project-defaults)), `--out-dir` (default `sfn-diagram-artifacts`; `--output-dir` still works). Every value flag also takes the `--flag=value` form. Run `sfn-diagram comment gitlab --help` for the full list, including the `execution-mode` / `state-machine-arn` overlay (same idea as the GitHub Action's). The overlay needs the optional `@aws-sdk/client-sfn` peer. The [standalone binary](/guides/cli/#standalone-binary) refuses it, and the Docker image above does not include the peer either, so the job posts the note without the overlay and logs a warning; run it from the npm package with the peer installed instead.

## Project defaults

To set the render options once instead of in every job, add a `commentGitlab` block to the project's `sfn-diagram.config.yaml` (or `.json`, `.yml`, `.sfn-diagramrc`):

```yaml
commentGitlab:
  theme: dark
  catchHandling: hide
```

The block takes `theme`, `layout`, `catchHandling` and `collapse`; a flag in the job still wins. The subcommand ignores the file's top-level fields, and a key the block does not support fails the job. See [`comment gitlab` reads its own block](/guides/cli/#comment-gitlab-reads-its-own-block) for the details.

## The Mermaid size limit

GitLab renders Mermaid natively in merge request notes, but caps it at roughly **2000 characters shared across the whole page** — every Mermaid block on it, not just this one. A moderately sized state machine can use most of that budget by itself. Once the combined diagrams in a report cross it, this command drops the inline Mermaid and instead writes an SVG per changed file to `--out-dir`; the `artifacts: expose_as` line above surfaces those as a labelled link on the merge request widget, no comment needed. `--hide-catch` and `--collapse` can shrink a plain added/deleted file's diagram back under the limit; neither affects a diff diagram, which the underlying library renders without size-affecting options (`--layout` does apply to diffs).

## Posting the comment

Unlike GitHub's `${{ github.token }}`, `CI_JOB_TOKEN` cannot post merge request notes — GitLab's job-token allowlist is read-only for the Notes API. Set `GITLAB_TOKEN` (or `SFN_DIAGRAM_GITLAB_TOKEN`) as a masked CI/CD variable, scoped to a [project or group access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/) with the `api` scope and Developer role. Without it, the job still renders diagrams and writes artifacts — it just skips posting the note and exits `0`, so the snippet above works with zero setup and gains commenting once you add the token.
