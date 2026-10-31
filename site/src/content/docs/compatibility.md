---
title: Compatibility policy
description: "What sfn-diagram's version numbers promise from 2.0 on: which APIs, CLI behaviour and output hooks semver covers, and which it does not."
---

:::note[Takes effect in 2.0]
This policy is drafted in 1.10 and becomes the contract with 2.0.0
([#523](https://github.com/yusufaf/sfn-diagram/issues/523)). Until then, 1.x keeps
following semver as it has. For what 2.0 changes, see
[Upcoming in 2.0](/upgrading-to-v2/).
:::

sfn-diagram follows [semantic versioning](https://semver.org/). A breaking change to
anything covered below ships only in a major release.

## Covered by semver

- The exported functions, classes, constants and types of `sfn-diagram`,
  `sfn-diagram/aws`, `sfn-diagram/cfn`, `sfn-diagram/terraform`, `sfn-diagram/png`,
  `sfn-diagram/element` and `sfn-diagram/element/auto`.
- The `sfn-diagram/package.json` and `sfn-diagram/config.schema.json` export paths.
- Documented CLI flags, [exit codes](/guides/cli/#exit-codes) and config-file keys.
- Documented `data-*` attributes on rendered output (`data-state-id`,
  `data-edge-id`) and documented CSS classes.
- Marker and element ids, once they are prefixed
  ([#527](https://github.com/yusufaf/sfn-diagram/issues/527)).
- The `<sfn-diagram>` element's documented
  [attributes and properties](/ecosystem/web-component/#attributes-and-properties),
  and its `sfn-error` event.
- Documented environment variables: `SFN_DIAGRAM_PNG_FONT_DIRS`,
  `SFN_DIAGRAM_PNG_FONT_FAMILY`, `SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS` and
  `SFN_DIAGRAM_GITLAB_TOKEN`.
- Warning codes such as `SFN_DIAGRAM_DEP_HTML_TO_IMAGE`, which you can filter on with
  Node's `--disable-warning`.

## Not covered

- Rendered geometry: node positions and sizes. A layout fix may move pixels in a patch
  release. Snapshotting exact SVG output is your call.
- `sfn-diagram/ci`, which is marked `@experimental`. Its supported consumers are the
  GitHub Action and the `sfn-diagram comment gitlab` subcommand; pin an exact version
  if you build on it directly.
- The interactive viewer's embedded JSON blobs (`#sfn-state-data` and the others) and
  any DOM not listed above as a hook.
- The message text of warnings and errors. The warning codes are covered.

## Output unions may grow in a minor

Adding a member to a union that sfn-diagram *returns* is not a breaking change. That
applies to `ExecutionStateStatus`, `LintCode` and `EdgeType`. If you switch on one,
give the switch a `default:` branch:

```ts
import type { ExecutionStateStatus } from 'sfn-diagram';

function label(status: ExecutionStateStatus): string {
    switch (status) {
        case 'succeeded':
            return 'OK';
        case 'failed':
            return 'Failed';
        default:
            return status;
    }
}
```

## Runtime support

An end-of-life Node line may be dropped in a minor release. When that happens,
`engines.node` rises and the changelog says so. See [Runtime support](/guides/runtimes/)
for what each entry point needs today.

## Deprecations

An API is marked `@deprecated` in at least one minor release before a major release
removes it, and listed on [Upcoming in 2.0](/upgrading-to-v2/) or its successor.

## Other packages

The GitHub Action, `sfn-diagram-react` and the VS Code extension have their own
versions and changelogs.
