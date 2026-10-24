---
title: Preview Step Functions diagram changes on pull requests
description: "Put a before-and-after diagram of every changed AWS Step Functions state machine into each pull request: the GitHub Action for ASL files, and a tested workflow for CDK and CloudFormation or SAM templates."
sidebar:
  label: Pull request previews
---

A pull request that changes a Step Functions workflow is hard to review. If the definition
is an ASL file, the diff is a wall of JSON. If it lives in the AWS CDK, the diff is
TypeScript: a few chained `.next()` calls moved around. Either way, the reviewer can't
easily see whether a Choice branch now goes somewhere else or a Catch lost its target.

A diagram of the change answers that at a glance. This guide sets up a pull request comment
that shows each changed state machine as a diagram, with added states in green, modified
ones in yellow and removed ones in red, plus a table of what changed. It needs no deploy and
no AWS credentials, and the comment updates itself on every push.

## Pick your setup

| Where the definition lives | What to use |
|---|---|
| An ASL file in the repository (`*.asl.json`), including one that SAM loads with `DefinitionUri` or CDK with `DefinitionBody.fromFile` | [The GitHub Action](#asl-files-the-github-action) |
| A CDK app that builds the definition in code (`DefinitionBody.fromChainable`) | [The CDK workflow](#aws-cdk) |
| A SAM or CloudFormation template with the definition inline | [The template workflow](#sam-or-cloudformation-with-an-inline-definition) |
| ASL files, on GitLab | [`sfn-diagram comment gitlab`](#gitlab) |

## ASL files: the GitHub Action

If the definitions are ASL files, the [sfn-diagram GitHub Action](/ecosystem/github-action/)
does everything. Add this workflow:

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
      - uses: yusufaf/sfn-diagram-action@v1
```

The `paths` filter keeps it from running on pull requests that don't touch a definition.
If your files use another extension, change `paths` and set the Action's `asl-glob` input.
The [Action page](/ecosystem/github-action/) lists its inputs.

A CDK state machine built with `DefinitionBody.fromFile` belongs here too. Point the Action
at that file, because the synthesized template holds only an S3 location for it. The CDK
workflow below skips such a machine and says so in the job log.

## AWS CDK

The Action can't help when the definition is built in code, because there's no ASL file to
read. This workflow does the following on each pull request:
1. checks out both the pull request and its base branch;
2. runs `cdk synth` on each;
3. compares every state machine in the two `cdk.out` folders;
4. posts one comment, and edits that same comment on later pushes.

It uses a small Node script built on sfn-diagram's
[`extractAslFromTemplate`](/reference/cfn/functions/extractaslfromtemplate/) and the comment
helpers the Action uses, so the comment looks the same as the Action's.

### 1. Add the comment script

From the root of your CDK app, install the script's dependencies into their own folder:

```bash
npm install --prefix .github/sfn-diagram sfn-diagram@1 yaml@2
```

This creates `.github/sfn-diagram/package.json` and `package-lock.json`. Commit both, so CI
installs exactly the versions you tested. `sfn-diagram@1` takes the newest 1.x release and
never crosses a major version. The `node_modules` folder it creates is already ignored by
the `.gitignore` that `cdk init` writes.

Then save this as `.github/sfn-diagram/comment.mjs`:

```js
// Usage: node comment.mjs <base> <head> > comment.md
// Each argument is a cdk.out folder or a single CloudFormation/SAM template. A missing path counts as empty.
// Prints nothing when no state machine definition differs and everything could be read.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { extractAslFromTemplate } from 'sfn-diagram/cfn';
import { assembleCommentBody, buildAslFileSection, renderAslFileSection } from 'sfn-diagram/ci';

const MARKER = `<!-- sfn-diagram-preview:${process.env.GITHUB_WORKFLOW ?? 'local'} -->`;
const MAX_COMMENT_CHARS = 65536;
const STATE_MACHINE_TYPES = ['AWS::StepFunctions::StateMachine', 'AWS::Serverless::StateMachine'];
const OMITTED_NOTE =
    "> 📎 Diagram omitted: it would push this comment past GitHub's 65,536-character limit. " +
    'Render it locally with `npx sfn-diagram <template> --resolve-cfn --resource <logical ID> -o diagram.svg`, ' +
    'using a template that contains the state machine. For a state machine that changed, ' +
    'add `--diff <base template>` to highlight the changes. The logical ID is the last part of the section name.';

function listTemplates(path) {
    if (!existsSync(path)) return [];
    if (!statSync(path).isDirectory()) return [{ file: path, label: '', name: basename(path) }];
    return readdirSync(path, { recursive: true })
        .map((relative) => relative.replaceAll('\\', '/'))
        .filter((relative) => relative.endsWith('.template.json'))
        .filter((relative) => !relative.split('/').some((part) => part.startsWith('asset.')))
        .map((relative) => ({
            file: join(path, relative),
            label: `${relative.replace(/\.template\.json$/, '')}/`,
            name: relative,
        }));
}

// Returns the readable state machines, plus what it had to skip: `template` for a file that
// isn't valid YAML/JSON, `machine` for one that failed to extract, and `external` for a
// definition kept in a separate file.
function readStateMachines(path) {
    const machines = new Map();
    const skipped = [];
    for (const { file, label, name: templateName } of listTemplates(path)) {
        const text = readFileSync(file, 'utf8');
        let resources;
        try {
            // 'error' still accepts CloudFormation tags such as !GetAtt, but throws on invalid YAML.
            resources = parse(text, { logLevel: 'error' })?.Resources ?? {};
        } catch (error) {
            skipped.push({ kind: 'template', name: templateName, reason: error.message });
            continue;
        }
        for (const [logicalId, resource] of Object.entries(resources)) {
            if (!STATE_MACHINE_TYPES.includes(resource?.Type)) continue;
            const name = `${label}${logicalId}`;
            const properties = resource?.Properties ?? {};
            if (!('Definition' in properties) && !('DefinitionString' in properties)) {
                skipped.push({ kind: 'external', name, reason: 'its definition is in a separate file. Use the GitHub Action on that file.' });
                continue;
            }
            try {
                machines.set(name, extractAslFromTemplate({ resourceId: logicalId, template: text }).aslDefinition);
            } catch (error) {
                skipped.push({ kind: 'machine', name, reason: error.message });
            }
        }
    }
    return { machines, skipped };
}

// Formats names as `a`, `b`, … within a character budget, ending with "and N more" when cut short.
function listNames(names, budget) {
    let text = '';
    for (const [index, name] of names.entries()) {
        const next = `${text}${index === 0 ? '' : ', '}\`${name}\``;
        if (next.length > budget) return `${text} and ${names.length - index} more`;
        text = next;
    }
    return text;
}

const [basePath, headPath] = process.argv.slice(2);
const before = readStateMachines(basePath);
const after = readStateMachines(headPath);

const skipped = [...before.skipped, ...after.skipped];
for (const { name, reason } of skipped) console.error(`Skipped ${name}: ${reason.split('\n')[0]}`);
// A machine skipped on either side is left out on both, so it can't show up as "New file" or "File deleted".
const skippedNames = new Set(skipped.map(({ name }) => name));
// Anything that failed to read is reported, so the comment never claims that nothing changed.
const unreadable = [...new Set(skipped.filter(({ kind }) => kind !== 'external').map(({ name }) => name))];
const errorNote =
    unreadable.length === 0
        ? []
        : [`> ⚠️ Couldn't read ${listNames(unreadable, 2000)}, so changes there aren't shown. See the job log.\n`];
// If a whole template couldn't be parsed, its state machines are unknown on that side,
// so comparing the rest could report them as new or deleted. Show only the note.
const templateFailed = skipped.some(({ kind }) => kind === 'template');

const sections = templateFailed
    ? []
    : [...new Set([...before.machines.keys(), ...after.machines.keys()])]
          .sort()
          .filter((name) => !skippedNames.has(name))
          .filter((name) => JSON.stringify(before.machines.get(name)) !== JSON.stringify(after.machines.get(name)))
          .map((name) =>
              buildAslFileSection({
                  afterAsl: after.machines.get(name) ?? null,
                  beforeAsl: before.machines.get(name) ?? null,
                  filename: name,
              }),
          );

if (sections.length > 0 || errorNote.length > 0) {
    const omitted = new Set();
    const render = () =>
        assembleCommentBody({
            marker: MARKER,
            sections: [
                ...errorNote,
                ...sections.map((section) =>
                    renderAslFileSection(section, { includeDiagram: !omitted.has(section), omissionNote: OMITTED_NOTE }),
                ),
            ],
        });
    let body = render();
    for (const section of [...sections].sort((a, b) => b.mermaidCode.length - a.mermaidCode.length)) {
        if (body.length <= MAX_COMMENT_CHARS) break;
        omitted.add(section);
        body = render();
    }
    if (body.length > MAX_COMMENT_CHARS) {
        // Even without diagrams the state tables are too long, so list the changed machines instead.
        const names = listNames(sections.map((section) => section.filename), 30000);
        body = assembleCommentBody({
            marker: MARKER,
            sections: [
                ...errorNote,
                `> 📎 These state machines changed, but the details are too long for one comment: ${names}. ` +
                    'Run this script locally against the base and head templates to see the full report.\n',
            ],
        });
    }
    process.stdout.write(body);
}
```

### 2. Add the workflow

Save this as `.github/workflows/sfn-preview-cdk.yml`:

```yaml
name: Step Functions preview (CDK)
on:
  pull_request:
    paths: ['bin/**', 'lib/**', 'cdk.json', 'cdk.context.json', 'package-lock.json', '.github/sfn-diagram/**']
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          path: head
          persist-credentials: false
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: base
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            head/package-lock.json
            head/.github/sfn-diagram/package-lock.json
      - name: Synthesize the pull request
        working-directory: head
        run: npm ci && npx cdk synth --quiet --no-lookups
      - name: Synthesize the base branch
        working-directory: base
        run: if [ -f cdk.json ]; then npm ci && npx cdk synth --quiet --no-lookups; fi
      - name: Build the comment
        run: |
          npm ci --prefix head/.github/sfn-diagram
          node head/.github/sfn-diagram/comment.mjs base/cdk.out head/cdk.out > comment.md
          cat comment.md >> "$GITHUB_STEP_SUMMARY"
      - name: Post or update the comment
        if: github.event.pull_request.head.repo.full_name == github.repository
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          marker="<!-- sfn-diagram-preview:$GITHUB_WORKFLOW -->"
          id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate --slurp \
            | jq -r --arg marker "$marker" 'add | map(select(.user.login == "github-actions[bot]" and (.body | startswith($marker)))) | first | .id // empty')
          if [ ! -s comment.md ]; then
            [ -z "$id" ] && exit 0
            printf '%s\nNo state machine definitions differ from the base branch.\n' "$marker" > comment.md
          fi
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@comment.md > /dev/null
          else
            gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -F body=@comment.md > /dev/null
          fi
```

### What the comment shows

Each changed state machine gets its own section, named after its template and logical ID,
for example `OrdersStack/OrderWorkflow0015CDD9`. A machine in a CDK Stage or nested stack
gets that path instead, such as `assembly-Prod/ProdOrdersStack2EDBF9CE/OrderWorkflow0015CDD9`.
- **Modified:** a table of added, modified and removed states, plus the diagram with the
  changes highlighted.
- **Added in the pull request:** labelled "New file".
- **Removed:** labelled "File deleted". The labels come from the Action, which works on
  files.
- **Unchanged:** left out.
- **Changed only outside its states**, for example `TimeoutSeconds` or `Comment`: the
  machine still gets a section, but its table says "No changes", because only states are
  compared there.
- **Couldn't be read on either side:** left out, with a "Couldn't read" note at the top of
  the comment and a `Skipped` line in the job log that says why. So a comment never claims
  nothing changed when part of a template couldn't be read. If a whole template isn't valid
  YAML or JSON, the comment shows only that note, since the script can't tell which state
  machines it holds.
- **Definition in a separate file** (`DefinitionUri`, `DefinitionS3Location` or CDK's
  `DefinitionBody.fromFile`): left out on both sides, with a `Skipped` line in the job log.
  The GitHub Action covers those files.

When a later push makes every definition match the base branch again, the comment is
rewritten to say so instead of being left out of date. If no state machine changed and no
comment exists yet, nothing is posted.

The same Markdown also goes to the run's job summary.

### No AWS credentials needed

`cdk synth` needs no credentials for an environment-agnostic stack, which is a stack with no
`env`. The workflow passes `--no-lookups`, so a stack that does need a lookup fails with a
clear message instead of trying to reach AWS:

```text
Context lookups have been disabled. Make sure all necessary context is already in 'cdk.context.json' by running 'cdk synth' on a machine with sufficient AWS credentials and committing the result. Missing context keys: 'ssm:account=123456789012:parameterName=/orders/queue-name:region=us-east-1'
```

Run `cdk synth` once locally with credentials and commit `cdk.context.json`. CI then reads
the cached values.

### Large state machines

A diagram that would push the comment over the size limit is left out, largest first. A note
in its place explains how to render it locally. A 1,500-state machine came out as a
702-character comment. If the tables of changed states are still too long without any
diagrams, the comment lists only the names of the state machines that changed.

The script stops at 65,536 characters, the number in GitHub's error message. In our tests
GitHub actually accepted up to 262,144 bytes of UTF-8 and rejected one byte more with
`Body is too long (maximum is 65536 characters)`. So the script's cap is always safe, with
room to spare.

### How long it takes

On `ubuntu-latest`, a stack with two state machines took 24 to 31 seconds per run. Most of
that is the two `cdk synth` runs, at 8 and 6 seconds. `setup-node` caches npm downloads,
keyed on both lockfiles.

### Adapting it

- **Paths:** the paths assume the CDK app is at the repository root, with code in `bin/` and
  `lib/`. Change `paths`, the `cache-dependency-path` lines and the `cdk.out` arguments if
  yours differs.
- **Other languages:** the script only reads `cdk.out`, so it works the same for CDK apps in
  Python, Java, C# and Go. The workflow's synth steps and `cache-dependency-path` assume a
  Node app, though, so replace them with your language's setup and install commands. Only
  the TypeScript version was tested for this guide.
- **Later pushes:** for a pull request, GitHub compares the whole pull request with its base
  to decide whether `paths` matches, not just the latest push
  ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)).
  If a later push undoes every change under `paths`, the workflow doesn't run, and the
  previous comment stays as it was.

## SAM or CloudFormation with an inline definition

When the state machine is defined inline in a template that's already in the repository,
there's nothing to synthesize. Use the same `comment.mjs` and dependencies from
[step 1](#1-add-the-comment-script), and point the script at the template on each side.
Save this as `.github/workflows/sfn-preview-sam.yml`:

```yaml
name: Step Functions preview (SAM)
on:
  pull_request:
    paths: ['template.yaml', '.github/sfn-diagram/**']
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          path: head
          persist-credentials: false
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: base
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: head/.github/sfn-diagram/package-lock.json
      - name: Build the comment
        run: |
          npm ci --prefix head/.github/sfn-diagram
          node head/.github/sfn-diagram/comment.mjs base/template.yaml head/template.yaml > comment.md
          cat comment.md >> "$GITHUB_STEP_SUMMARY"
      - name: Post or update the comment
        if: github.event.pull_request.head.repo.full_name == github.repository
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          marker="<!-- sfn-diagram-preview:$GITHUB_WORKFLOW -->"
          id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate --slurp \
            | jq -r --arg marker "$marker" 'add | map(select(.user.login == "github-actions[bot]" and (.body | startswith($marker)))) | first | .id // empty')
          if [ ! -s comment.md ]; then
            [ -z "$id" ] && exit 0
            printf '%s\nNo state machine definitions differ from the base branch.\n' "$marker" > comment.md
          fi
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@comment.md > /dev/null
          else
            gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -F body=@comment.md > /dev/null
          fi
```

Change `template.yaml` in `paths` and in the script arguments if your template has another
name. Each section is named after the state machine's logical ID. A machine that loads its
definition with `DefinitionUri` is skipped with a note in the job log. Use the
[GitHub Action](#asl-files-the-github-action) on that file instead.

## Pull requests from forks

For a pull request from a fork, GitHub gives the workflow a read-only token, so it can't
post a comment
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)).
That's why the post step only runs when the pull request comes from the same repository. For
a fork, the comment's Markdown is still in the run's job summary. Dependabot pull requests
aren't affected: their token is read-only by default too, but the workflow's `permissions`
block raises it
([Dependabot on GitHub Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions)).

Don't switch to `pull_request_target` to get a write token. GitHub's docs say to avoid that
event "if you need to build or run code from the pull request", and `cdk synth` runs the
pull request's code.

The safe pattern is two workflows:
1. The unprivileged `pull_request` workflow builds the comment and uploads it as an artifact.
2. A second workflow, triggered by `workflow_run`, posts the comment. It treats the artifact
   as untrusted input.

GitHub Security Lab's
[Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
walks through it. That version isn't covered or tested here.

## GitLab

On GitLab, `sfn-diagram comment gitlab` posts the same kind of comment to a merge request
for the ASL files it changes. See [GitLab CI](/ecosystem/gitlab/). The template script on
this page is written for GitHub Actions, and a GitLab version isn't covered here.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `Context lookups have been disabled. … Missing context keys: …` | The stack uses a context lookup, such as `valueFromLookup` or `fromLookup`, with no cached value | Run `cdk synth` locally with AWS credentials and commit `cdk.context.json` |
| The comment says `⚠️ Couldn't read` a state machine | The job log has a `Skipped <name>: <reason>` line for it | Fix what the reason names. The rows below cover the common ones |
| `Skipped template.yaml: Map keys must be unique at line 49, column 3:` or another YAML error | The template isn't valid YAML on that side | Fix the template. Until then the comment shows only the "Couldn't read" note |
| `Skipped …: its definition is in a separate file. Use the GitHub Action on that file.` | The state machine uses `DefinitionUri`, `DefinitionS3Location` or CDK's `DefinitionBody.fromFile` | Use the [GitHub Action](#asl-files-the-github-action) on that ASL file |
| The workflow didn't run after a push | No file under `paths` differs from the base branch any more | Expected. See [Adapting it](#adapting-it) |
