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
| **Wait** | Rectangle | Delays execution for specified time |
| **Succeed** | Circle | Terminates successfully |
| **Fail** | Circle | Terminates with failure |
| **Parallel** | Rectangle | Executes branches in parallel |
| **Map** | Rectangle | Iterates over array items (legacy `Iterator` and modern `ItemProcessor`/Distributed Map) |

## Error handling & retries

- **`Catch`** blocks render as dashed error edges to their handler states.
- **`Retry`** policies render as a labelled self-loop on the state (e.g. `↻ States.Timeout (4x); States.ALL (2x)`) — a self-transition in Mermaid output.

## Query languages

Both JSONPath and JSONata (`QueryLanguage: "JSONata"`) definitions are supported. Choice branch labels are derived from JSONPath comparison operators (`$.score >= 90`, `And`/`Or`/`Not`, `Is*` checks) or from JSONata `Condition` expressions, whichever the state uses.
