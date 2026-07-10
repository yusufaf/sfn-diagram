# Execution Overlay — Follow-up Work (Handoff)

This document hands off the remaining work after the **execution overlay** feature
landed in [PR #19](https://github.com/yusufaf/sfn-diagram/pull/19). It's written for
an agent/developer picking this up cold. Read the "Shared context" section first —
it applies to all three follow-ups.

## What already shipped (PR #19)

The core library can now render a real Step Functions **execution** onto an ASL
diagram (which path ran, what succeeded/failed/was caught/never reached, plus
per-state duration & retries). Public API (in `src/execution.ts`, exported from
`src/index.ts`):

| Function | Returns | Purpose |
| --- | --- | --- |
| `parseExecutionHistory({ events })` | `ExecutionOverlay` | Pure model: per-state status/attempts/duration + `takenEdges`. No rendering. |
| `generateExecution({ aslDefinition, history, ...options })` | `ExecutionOutput` | SVG overlay (colours, dimmed untaken edges, annotations). |
| `generateMermaidExecution({ aslDefinition, history })` | `MermaidExecutionOutput` | Mermaid overlay (node classes + label annotations). |

The React component (`packages/sfn-diagram-react`) and the playground already
consume these — look at `SfnDiagram.tsx` and `playground/src/components/Preview.tsx`
as reference integrations.

## Shared context (read before starting any task)

- **`history` input** (`ExecutionHistoryInput`) accepts: a `HistoryEvent[]` array,
  a raw `GetExecutionHistoryCommandOutput`, `{ events }`, **or a JSON string** of any
  of those. All AWS SDK types are imported **types-only** — the core adds no runtime
  dependency and stays browser-safe.
- **Type gotcha:** the array branch uses the AWS SDK `HistoryEvent`, whose
  `timestamp` is a `Date`. A history you `JSON.parse` from a file/string has **string**
  timestamps and will NOT typecheck as `HistoryEvent[]`. So: **pass the JSON string
  directly** (don't parse it first) unless you have genuine SDK `Date` objects. The
  runtime handles Date | string | number timestamps.
- **Mermaid limitation:** `stateDiagram-v2` can't style individual transitions, so
  the Mermaid overlay expresses the taken path via node colours + label annotations
  only. The SVG overlay dims untaken edges.
- **v1 simplification:** a state entered multiple times (Map iterations) aggregates
  to one worst-case status with summed duration / total attempts. Nested per-iteration
  breakdown is out of scope.
- **Statuses:** `succeeded | failed | caught | running | notReached`.

### Repo gotchas that will bite you

- **GitHub Action bundle must be rebuilt when core exports change.** The action
  bundles the whole core lib into `packages/github-action-sfn-diagram/dist/index.js`
  via esbuild. CI has a "Verify GitHub Action bundle is up to date" step that fails if
  it's stale. After changing anything the action imports, run
  `pnpm --filter github-action-sfn-diagram build` and commit the `dist`. (PR #19
  needed a `build(github-action): rebuild bundle` commit for exactly this.)
- **Pre-commit hook runs the full suite** (`pnpm test && pnpm lint`), including
  headless-Chromium PNG tests and wall-clock perf-budget tests. These flake under CPU
  load. Kill stray browser/dev-server processes before committing. **Do not
  `pkill -f vite`** — it matches `vitest` and kills your own test run (use
  `pkill -f 'vite dev'`).
- **Tooling:** node is via `mise` (not on PATH); use `npx pnpm@9 ...` for everything.
- **Commits:** Conventional Commits, no `Co-Authored-By` trailer (see CLAUDE.md).
  Never manually bump versions — release-please handles releases.

---

## Follow-up 1 — VS Code extension overlay (recommended first; self-contained)

**Goal:** let the VS Code preview render an execution overlay, not just the static
definition.

**Where:** `packages/vscode-sfn-diagram/src/DiagramPanel.ts` (the webview panel;
currently calls `generateSvg`), `extension.ts` (commands), `package.json`
(command/menu contributions).

**Current state:** `DiagramPanel.update(aslContent)` calls `generateSvg({ aslDefinition, layout, theme })`
and stuffs the SVG into the webview. Layout/theme are switched via `postMessage` from
the webview toolbar.

**Approach:**
1. Add a command `sfn-diagram.previewExecution` (and/or a toggle in the webview
   toolbar) that prompts for / accepts an execution-history file.
2. Store an optional `_history?: string` on `DiagramPanel`. In `update()`, when set,
   call `generateExecution({ aslDefinition: aslContent, history: this._history, layout, theme })`
   instead of `generateSvg`. Pass the history as a **string** (see type gotcha).
3. Simplest UX: a command "Step Functions: Preview Execution" that opens a file
   picker for the history JSON (filter `json`), reads it, and shows the overlay for
   the active ASL editor. A "clear overlay" command returns to the plain diagram.
4. Consider a small legend in the webview HTML (green=succeeded, red=failed,
   orange=caught, grey=not reached).

**Gotchas:** the webview loads the SVG string directly (already trusted/nonce'd HTML
in `_getHtml`). No CSP change needed since the overlay is still just an SVG string.

**Verify:** build the extension (`pnpm --filter vscode-sfn-diagram package`), install
the VSIX (`code --install-extension …`), open an `.asl.json` with a matching history
file, run the command, and confirm the run's path lights up. Reuse the history
fixtures in `tests/fixtures/execution-*.json` paired with the ASL fixtures
(e.g. `error-handling.asl.json` + `execution-caught.json`).

---

## Follow-up 2 — GitHub Action last/failed-execution comment (highest effort; needs AWS creds)

**Goal:** on a PR, optionally post the most recent (or most recent *failed*)
execution of a changed state machine as a Mermaid execution overlay, next to the
existing diff preview.

**Where:** `packages/github-action-sfn-diagram/src/run.ts` (main logic),
`action.template.yml` (inputs — note it is deliberately NOT `action.yml`; see the
header comment and `scripts/sync-action-mirror.sh`).

**Current state:** the action matches ASL files by glob, computes a Mermaid diff via
`generateMermaidDiff`, and upserts a PR comment (tagged by `comment-tag`). It does not
touch AWS at runtime.

**Approach:**
1. New optional inputs: `state-machine-arn` (or a mapping from file→ARN),
   `execution-mode` (`off` | `latest` | `latest-failed`), and AWS auth (rely on the
   standard `aws-actions/configure-aws-credentials` upstream step + env, don't
   reinvent).
2. When enabled: use `@aws-sdk/client-sfn` to `ListExecutions` (filter by status for
   `latest-failed`), take the newest, then **paginate `GetExecutionHistory`** (see the
   fetch helper in Follow-up 3 — build that first and reuse it) to get all events.
3. Render with `generateMermaidExecution({ aslDefinition, history: events })` and add
   it as a section in the PR comment (below the diff).
4. `@aws-sdk/client-sfn` is currently a **devDependency** of the root; the action
   bundles everything via esbuild, so add it to the action's bundle inputs as needed
   and **rebuild the bundle** (see repo gotchas).

**Gotchas:** credentials in CI are the user's responsibility (document the required
IAM: `states:ListExecutions`, `states:GetExecutionHistory`, `states:DescribeStateMachine`).
Keep it strictly opt-in (`execution-mode: off` default) so the action stays usable
without AWS access. Rebuild + commit `dist`. Add unit tests to `run.test.ts` mocking
the SFN client.

---

## Follow-up 3 — `sfn-diagram/aws` fetch helper (small; unblocks #2)

**Goal:** a convenience, Node-only helper that paginates `GetExecutionHistory` so
callers don't hand-roll the loop. Keeps the core credential-free by living on a
separate subpath (mirrors how `sfn-diagram/png` isolates the Node-only PNG exporter).

**Where:** new `src/aws.ts` + a new export subpath in `package.json` (`"./aws"`,
alongside `"."` and `"./png"`), plus a `tsdown` entry. Make `@aws-sdk/client-sfn` an
**optional peer dependency**.

**API sketch:**
```ts
// sfn-diagram/aws  (Node-only)
export async function fetchExecutionHistory(params: {
  client: SFNClient;          // caller constructs it (their creds/region)
  executionArn: string;
  maxResults?: number;        // default 1000
}): Promise<HistoryEvent[]> { /* loop GetExecutionHistoryCommand on nextToken */ }
```
The README already documents the manual pagination loop (see the "Execution overlay"
section) — this just packages it. Reference that snippet.

**Gotchas:** don't import `@aws-sdk/client-sfn` from the core entry (`src/index.ts`) —
only from `src/aws.ts`, so `sfn-diagram` core stays dependency-free and browser-safe.
Add module-format tests mirroring `tests/module-formats.test.ts` (the `/png` subpath
is the template).

**Verify:** import from the built `dist` in both ESM and CJS; optionally an
integration test against a mocked `SFNClient`.

---

## Suggested order

1. **Follow-up 3** (fetch helper) — small, and Follow-up 2 depends on it.
2. **Follow-up 1** (VS Code) — self-contained, no CI/creds, best visible payoff.
3. **Follow-up 2** (Action) — largest, needs the creds story; do last.

Each should be its own branch + PR (`feat/…` or `build/…` per Conventional Commits).
