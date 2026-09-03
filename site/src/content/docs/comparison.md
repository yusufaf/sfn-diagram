---
title: sfn-diagram vs. other ways to visualize Step Functions
description: "How sfn-diagram compares to the AWS Console visualizer and the Mermaid Live Editor — input, output, CI integration, and execution overlays."
---

There's no shortage of ways to look at a state machine. Here's where sfn-diagram fits versus
the other two most common options:

| | **sfn-diagram** | AWS Console visualizer | Mermaid Live Editor |
|---|---|---|---|
| Input | ASL, CloudFormation/SAM/CDK templates, live AWS state machines | Deployed state machine only | Manual Mermaid you write by hand |
| Output | SVG, Mermaid, PNG, interactive HTML | Static graph in-browser | Mermaid diagram only |
| CI / PR integration | [GitHub Action](/ecosystem/github-action/) posts a diff overlay on every PR that touches ASL | None | None |
| Execution overlays | Paints a real run's path/status/duration onto the diagram | Basic per-execution highlighting, console-only | Not applicable |
| Runs where | CLI, Node, browser, edge runtimes | AWS Console only | Web app only |
| Automation | Full programmatic API (`generateSvg`, `generateMermaid`, etc.) | None — UI only | None — UI only |

In short: reach for the AWS Console visualizer to eyeball a state machine you already
deployed, reach for Mermaid Live if you're hand-drawing a diagram from scratch — reach for
sfn-diagram when you want diagrams generated automatically from your actual definition,
checked into CI, and diffed on every pull request.

## Why not just export from the Console?

The Console visualizer only ever shows what's already deployed. It can't render a
CloudFormation/SAM/CDK template before you deploy it, can't diff a pull request against
production, and has no CLI or API — every diagram is a manual click through the UI. That's
fine for a one-off look at a state machine you own; it doesn't fit into a review process.

## Why not just draw it in Mermaid Live?

Hand-drawn Mermaid is disconnected from the actual definition. It drifts the first time
someone edits the state machine and forgets to update the diagram — there's no source of
truth tying the picture to the ASL. sfn-diagram generates the same Mermaid syntax, but
*from* the definition, so it can never go stale.

See the full feature list on the [introduction page](/introduction/), or jump straight to
the [quick start](/quick-start/).
