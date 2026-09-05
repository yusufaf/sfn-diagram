---
title: Supported state types
description: Every ASL state type sfn-diagram renders, plus error handling and query languages.
---

All AWS Step Functions state types are fully supported:

| State Type | Shape | Description |
|------------|-------|-------------|
| **Pass** | Rectangle | Passes input to output, optionally with transformation |
| **Task** | Rectangle | Performs work via Lambda, Activity, or service integration |
| **Choice** | Diamond | Adds branching logic based on input |
| **Wait** | Rectangle | Delays execution for a specified time, shown on the node |
| **Succeed** | Circle | Terminates successfully |
| **Fail** | Circle | Terminates with failure |
| **Parallel** | Rectangle | Executes branches in parallel |
| **Map** | Rectangle | Iterates over array items (legacy `Iterator` and modern `ItemProcessor`/Distributed Map) |

## What a node shows beyond its name

Several fields that change how a state actually behaves would otherwise be invisible
in a diagram, so they render as a `·`-separated second line under the node's name.

| State | Shows |
|-------|-------|
| **Wait** | how long it waits — `5s` from `Seconds`, or the `SecondsPath` / `Timestamp` / `TimestampPath` it reads. A JSONata `Seconds` is shown as the bare expression, with the `{% %}` delimiters stripped |
| **Map** | `Distributed` for a Distributed Map, `max N` from `MaxConcurrency`, `tolerate 5%` / `tolerate 100 failures` from `ToleratedFailurePercentage` / `ToleratedFailureCount`, and `batches of 50` / `batches ≤ 256KB` from `ItemBatcher` |
| **any** | the state type itself, when `showStateTypes` is enabled |

Failure tolerance is worth calling out: it is the difference between one bad item
failing a hundred-thousand-item run and an accepted loss rate, and the AWS console's
own graph view does not surface it either.

The line is trimmed to the node's width, so a long JSONata expression on a narrow
node is elided rather than drawn over its neighbours.

## Error handling & retries

- **`Catch`** blocks render as dashed error edges to their handler states.
- **`Retry`** policies render as a labelled self-loop on the state (e.g. `↻ States.Timeout (4x); States.ALL (2x)`) — a self-transition in Mermaid output.

## Query languages

Both JSONPath and JSONata (`QueryLanguage: "JSONata"`) definitions are supported. Choice branch labels are derived from JSONPath comparison operators (`$.score >= 90`, `And`/`Or`/`Not`, `Is*` checks) or from JSONata `Condition` expressions, whichever the state uses.
