---
title: Using sfn-diagram from AI agents (MCP)
description: Run sfn-diagram as a Model Context Protocol server so coding agents can render, diff and lint Step Functions definitions.
sidebar:
  label: MCP server
---

`sfn-diagram mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server on stdio. A coding agent such as Claude Code can then render, diff and lint state machine definitions by calling tools, without shelling out to the CLI or knowing its flags.

It exposes three tools:

- **`render`** draws a definition as svg, mermaid, html or png, optionally with an execution history overlay.
- **`diff`** draws the changes between a baseline and a definition.
- **`lint`** checks a definition for structural problems and returns the findings as JSON.

Inputs can be ASL JSON, CloudFormation/SAM/CDK templates or Terraform, the same as the [command line](/guides/cli/).

## Setup

### Claude Code

```bash
claude mcp add sfn-diagram -- npx -y sfn-diagram mcp
```

On native Windows (not WSL), `npx` needs the `cmd /c` wrapper:

```bash
claude mcp add sfn-diagram -- cmd /c npx -y sfn-diagram mcp
```

### Other clients

Most clients take a JSON entry like this:

```json
{
  "mcpServers": {
    "sfn-diagram": {
      "command": "npx",
      "args": ["-y", "sfn-diagram", "mcp"]
    }
  }
}
```

The server reads paths relative to the directory it starts in, so start it in your project, or pass absolute paths.

For `format: "png"`, the optional `@resvg/resvg-js` peer must be installed: `npx -y --package sfn-diagram --package @resvg/resvg-js sfn-diagram mcp`.

### Standalone binary

The [standalone binary](/guides/cli/#standalone-binary) runs the server with no Node.js: use `sfn-diagram mcp` as the command. It cannot rasterize, so `render` refuses `format: "png"` there.

### Docker

```bash
docker run -i --rm -v "$PWD":/work ghcr.io/yusufaf/sfn-diagram:latest mcp
```

`-i` keeps stdin open, which the server reads requests from. Your project is mounted at `/work`, so give the tools absolute `/work/...` paths. Don't pass `-w`: the image's entrypoint is relative to its own working directory.

## Tools

Every tool takes the definition as exactly one of:

| Argument | Meaning |
| --- | --- |
| `path` | A file to read, relative to the server's working directory |
| `source` | The definition text itself |

plus `resolveCfn` (read the input as a template even when it is not detected as one, as YAML templates need) and `resource` (the state machine to extract when a template or Terraform config declares several: its logical ID, its CDK construct path such as `OrderWorkflow`, or its Terraform resource name). Prefer `path` for files on disk: the agent doesn't have to send the text.

### `render`

| Argument | Meaning |
| --- | --- |
| `format` | Required. `svg`, `mermaid`, `html` or `png` |
| `outputPath` | Write the diagram to this file and return only a summary. Required for `html` |
| `history` / `historyPath` | Execution history JSON (`GetExecutionHistory` output) to overlay, inline or from a file |
| `scale` | PNG pixel density, above 0 and at most 10 |

### `diff`

| Argument | Meaning |
| --- | --- |
| `format` | Required. `svg`, `mermaid` or `html` |
| `baseline` / `baselinePath` | Required. The definition to compare against, inline or from a file |
| `outputPath` | As for `render` |

`resolveCfn` and `resource` apply to both sides.

### Display options

`render` and `diff` also take `layout` (`TB`, `LR`, `RL`, `BT`), `theme` (`light`, `dark`, `auto`), `collapse` (`true`, or the names of the Parallel and Map states to collapse), `catchHandling` (`show`, `hide`), `catchLabelStyle`, `edgeStyle`, `stylePreset`, `showIcons`, `showStateTypes`, `showVariables`, `includeComments` and `diagramTitle`. They mean what the [CLI flags](/guides/cli/) of the same name mean.

Anything else, such as node sizes, colours and redaction, comes from the config file.

### `lint`

Takes only the definition arguments. It returns the same entry that [`--check --check-format json`](/guides/cli/#machine-readable-output) writes for one file, without `file`:

```json
{ "kind": "lint", "diagnostics": [{ "code": "dangling-transition", "message": "...", "path": "...", "severity": "error" }], "warnings": [] }
```

Findings at error severity are not a tool error. `kind: "error"`, for a definition that can't be read or extracted, is.

## The config file

The server reads the [configuration file](/guides/cli/#configuration-file) once when it starts, looking for it from its working directory as the CLI does, or from `--config <path>`. Tool arguments override it. Restart the server to pick up an edit.

## Result shape and size

`render` and `diff` return the diagram as the first content block and a JSON summary as the last: the byte count, the output path or `null`, extraction warnings, and the execution or diff summary. A png comes back as an image block.

Agents work in a limited context, and Claude Code caps a tool result at 25,000 tokens by default. So inline output has limits:

- `html` always needs `outputPath`: the self-contained viewer document is several hundred kilobytes.
- svg and mermaid over 40,000 characters are refused. svg takes roughly 0.7 to 1.5 KB per state, so a machine of 30 to 60 states can reach it; mermaid is far more compact.
- png over 750,000 bytes is refused. Lower `scale`, or pass `outputPath`.

A refusal says which of these applies, so the agent can retry.

`render` and `diff` send no `structuredContent`. Some clients, Claude Code among them, show the model only `structuredContent` when a result has it, which would hide the diagram. `lint` sends its JSON both as text and as `structuredContent`, so the model sees the same thing either way.

## What it can touch

The server reads the files that tools name, and `outputPath` writes, and overwrites, files. It does both with your permissions, as the CLI would if the agent ran it. It doesn't create missing directories.

It makes no network requests, except to fetch service icons when `showIcons` is set for html or png. It has no `--from-aws` equivalent: export a definition or history to a file and pass its path.
