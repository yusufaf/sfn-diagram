---
title: Generate AWS Step Functions diagrams from CDK and SAM templates
description: "Draw a Step Functions state machine straight from a CDK synth output or a SAM template, before you deploy it: which file to point at, how to pick one machine, and how to diff two revisions."
sidebar:
  label: CDK and SAM templates
---

When a state machine lives in the AWS CDK or AWS SAM, its Amazon States Language (ASL) is
hard to see. CDK writes it into the CloudFormation template as a `DefinitionString` built
from `Fn::Join` pieces, and SAM keeps it as YAML inside the template. Neither is easy to
read as a workflow while you're editing the stack.

sfn-diagram reads the template itself. It finds the state machine resource, flattens the
CloudFormation intrinsics around the definition, and draws the result. It doesn't deploy
anything or need AWS credentials. That makes it fast enough to run on every change.

This guide shows how to use the CLI with each tool. The full flag list is in
[the CLI guide](/guides/cli/).

## AWS CDK

### 1. Synthesize

```bash
npx cdk synth --quiet
```

`cdk synth` writes one CloudFormation template per stack to `cdk.out/`. The file is named
after the stack's construct ID, the second argument to `new Stack(app, 'OrdersStack')`,
so `cdk.out/OrdersStack.template.json`. A `stackName` you set in the stack's props doesn't
change the file name. `--quiet` stops synth from also printing the template.

The printed copy is YAML, so `cdk synth > template.json` gives you YAML in a file
named `.json`, and that file won't be recognized as a template. Read the file in `cdk.out/`
instead. If you use CDK Stages, each stage gets an `assembly-*` subfolder named after it,
such as `cdk.out/assembly-Prod/`. The template's file name inside starts with the stage name
and ends in a hash, for example `ProdOrdersStack2EDBF9CE.template.json`. To skip hunting for
it, render `cdk.out` itself (see [Every state machine in `cdk.out`](#every-state-machine-in-cdkout)).

### 2. Render

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json -o orders.svg
```

JSON templates are detected automatically, so no extra flag is needed. If the stack has
exactly one state machine, that's all you need.

### 3. Pick a state machine when there are several

With two or more state machines, the CLI stops and lists each one's logical ID next to its
construct path:

```text
Error: Template has multiple state machines: OrderWorkflow0015CDD9 (OrdersStack/OrderWorkflow), RefundWorkflow9F22E5E9 (OrdersStack/RefundWorkflow). Pass resourceId (or --resource) to choose one.
```

Pass the construct ID you wrote in `new sfn.StateMachine(this, 'OrderWorkflow', …)`:

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json --resource OrderWorkflow -o orders.svg
```

`--resource` takes any of these:

- the construct ID, or for a state machine inside another construct, the path through your
  constructs (`Orders/Workflow`)
- the full construct path from the error (`OrdersStack/OrderWorkflow`)
- the end of a path, such as `Workflow`, when only one state machine's path ends that way
- the logical ID itself (`OrderWorkflow0015CDD9`), which always wins

A value that fits more than one state machine is an error that lists them, so it never
picks one silently. Inside a nested stack, the path is relative to the nested stack, not to
its parent.

### Every state machine in `cdk.out`

Point the CLI at the `cdk.out` directory to render every state machine the app defines:

```bash
npx cdk synth --quiet
npx sfn-diagram cdk.out --out-dir diagrams
```

The CLI recognizes the directory by its `manifest.json`. It reads every stack, every Stage's
`assembly-*` folder (Stages inside Stages too), and every nested stack's
`*.nested.template.json`, so you don't need to know which hashed file holds which machine.
Each output is named after the machine's construct path with `/` turned into `.`:

```text
diagrams/OrdersStack.OrderWorkflow.svg
diagrams/OrdersStack.Nested.NestedWorkflow.svg
diagrams/Prod.OrdersStack.OrderWorkflow.svg
```

The construct path comes from the `aws:cdk:path` metadata the CDK CLI writes by default.
If path metadata is turned off, the name is the stack's path plus the logical ID instead,
such as `Prod.OrdersStack.OrderWorkflow0015CDD9.svg`.

`--resource` filters the machines across all stacks:

- a full construct path (`OrdersStack/OrderWorkflow`) or a logical ID picks just the
  machines it names. `OrdersStack/OrderWorkflow` doesn't also pick
  `Prod/OrdersStack/OrderWorkflow`.
- a shorter path keeps each stack's match, so `OrderWorkflow` picks the machine in both
  `OrdersStack` and `Prod/OrdersStack`.
- any name the CLI lists in an error is accepted, including the fallback names.

When one machine is left, `-o` writes it to that file:

```bash
npx sfn-diagram cdk.out --resource Prod/OrdersStack/OrderWorkflow -o orders.svg
```

With several left and no `--out-dir`, the CLI lists them and exits 2. `--check` lints every
machine and exits 1 if any has an error (see [Lint before you deploy](#lint-before-you-deploy)).
`--watch` watches the whole directory, so it picks up the next `cdk synth`. `--diff`,
`--execution` and `--preserve-tree` take a single template, so pass the stack's template
with `--resource` for those.

### A definition in its own file (`DefinitionBody.fromFile`)

A stack can keep the ASL in its own file, such as one exported from Workflow Studio:

```ts
new sfn.StateMachine(this, 'RefundWorkflow', {
  definitionBody: sfn.DefinitionBody.fromFile('refund.asl.json'),
});
```

`cdk synth` uploads that file as an asset, so the template has only a
`DefinitionS3Location`, not the definition. It also stages a copy of the file in `cdk.out/`
and lists it in `RefundStack.assets.json` beside the template. The CLI finds the copy
through that manifest, fills in `DefinitionSubstitutions`, and renders it, so the usual
command works:

```bash
npx sfn-diagram cdk.out/RefundStack.template.json -o refund.svg
```

This also works for a Stage template in an `assembly-*` subfolder, for each side of a
`--diff` (copy all of `cdk.out/`, as in [See what a change does to the
graph](#see-what-a-change-does-to-the-graph)), and for a template passed to the
[MCP server](/guides/mcp/) by `path`. For a live preview while you edit, watch the ASL file
itself (`sfn-diagram refund.asl.json --watch`). `--watch` on the template sees only the
template, not the `.assets.json` that `cdk synth` writes after it, so run the command again
after `cdk synth` instead.

These cases stop with `… cannot be read from the template alone`. Render the ASL file
directly instead:

- a template piped in on stdin, or sent to `serve` or to MCP as `source`
- a template copied away from its `.assets.json`
- a nested stack's `*.nested.template.json`, whose assets are listed in its parent's
  manifest. This includes rendering all of `cdk.out`: that machine fails, and the rest still
  render
- a template from `Template.fromStack()` in a [CDK test](#render-from-a-cdk-test), which has
  no `readFile` or `templateFileName`

In your own code, pass `templateFileName` along with `readFile` to
[`extractAslFromTemplate`](/reference/cfn/functions/extractaslfromtemplate/), as in the
[`DefinitionUri` example](#definitionuri-pointing-at-a-file) below, for example
`templateFileName: 'cdk.out/RefundStack.template.json'`.

### What the placeholders mean

A template still contains references that only CloudFormation can resolve at deploy time,
such as the ARN of a Lambda function created in the same stack. sfn-diagram swaps each of
them for a readable placeholder:

| In the template | In the diagram |
|---|---|
| `{ "Fn::GetAtt": ["ValidateFn1051E81A", "Arn"] }` | `<ValidateFn1051E81A.Arn>` |
| `{ "Ref": "OrdersTable" }` | `<Ref:OrdersTable>` |
| `{ "Ref": "AWS::Partition" }` | `${AWS::Partition}` |
| `Fn::Join` | The joined text |
| `Fn::Sub` | The text with its variables filled in from its own map or from `DefinitionSubstitutions`. Any other `${…}` reference stays as written |
| Any other `Fn::*` | `<Fn::Name>`, plus a `warning:` line on stderr |

The states, transitions, Choice rules, Retry and Catch all come straight from the
definition, so the shape of the graph is exact. Only these values are stand-ins. To see
them, render with `--format html` and click a state to open its ASL.

### Render from a CDK test

In a TypeScript or JavaScript CDK app you can skip `cdk synth` and render inside a test.
`Template.fromStack()` from `aws-cdk-lib/assertions` returns the template as an object, and
[`extractAslFromTemplate`](/reference/cfn/functions/extractaslfromtemplate/) accepts that
object as it is:

```ts
import { writeFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { generateSvg } from 'sfn-diagram';
import { extractAslFromTemplate } from 'sfn-diagram/cfn';
import { OrdersStack } from '../lib/orders-stack';

const stack = new OrdersStack(new App(), 'OrdersStack');
const { aslDefinition, warnings } = extractAslFromTemplate({
  resourceId: 'OrderWorkflow',
  template: Template.fromStack(stack).toJSON(),
});
writeFileSync('orders.svg', generateSvg({ aslDefinition }).svg);
```

A plain `new App()` in a test writes no `aws:cdk:path` metadata (only the CDK CLI turns it
on), so only the path relative to the stack (`OrderWorkflow`, `Orders/Workflow`) or the
logical ID works there. Leave out `resourceId` when the stack has a single state machine. CDK apps in Python, Java,
C# and Go use the CLI against `cdk.out/` instead. They already need Node to synthesize, so
`npx` works there too (see [Use from Python, Go, Java, and other languages](/guides/other-languages/)).

## AWS SAM

SAM gives you two ways to define a state machine, and each needs a different command.

### Inline `Definition`

```yaml
# template.yaml
Transform: AWS::Serverless-2016-10-31
Resources:
  OrderStateMachine:
    Type: AWS::Serverless::StateMachine
    Properties:
      Definition:
        StartAt: Charge card
        States:
          Charge card:
            Type: Task
            Resource: arn:aws:states:::lambda:invoke
            Parameters:
              FunctionName: ${ChargeFunctionArn}
              Payload.$: $
            Next: Notify customer
          Notify customer:
            Type: Task
            Resource: arn:aws:states:::sns:publish
            Parameters:
              TopicArn: !Ref OrderTopic
              Message.$: $
            End: true
      DefinitionSubstitutions:
        ChargeFunctionArn: !GetAtt ChargeFunction.Arn
```

```bash
npx sfn-diagram template.yaml --resolve-cfn --resource OrderStateMachine -o orders.svg
```

Unlike JSON, a YAML template isn't detected automatically, so `--resolve-cfn` is
required. Without it the CLI tries to read the YAML as ASL and fails with
`ASL definition is not valid JSON`. Short-form tags such as `!Ref`, `!GetAtt` and `!Sub`
are understood, and `DefinitionSubstitutions` are filled in. In the example above,
`FunctionName` becomes `<ChargeFunction.Arn>` and `TopicArn` becomes `<Ref:OrderTopic>`.

You write SAM logical IDs yourself, so `--resource` takes the name you gave the resource.
You can leave it out if the template has only one state machine.

### `DefinitionUri` pointing at a file

```yaml
  RefundStateMachine:
    Type: AWS::Serverless::StateMachine
    Properties:
      DefinitionUri: statemachine/refund.asl.json
      DefinitionSubstitutions:
        ChargeFunctionArn: !GetAtt ChargeFunction.Arn
```

Render the template as usual:

```bash
npx sfn-diagram template.yaml --resolve-cfn -o refund.svg
```

The CLI reads `statemachine/refund.asl.json` relative to the template, not to the
directory you run it from. It fills in `DefinitionSubstitutions` the way CloudFormation
does, so a `${ChargeFunctionArn}` placeholder in the file becomes `<ChargeFunction.Arn>`.
The file can be JSON or YAML. If it's missing, the error names the full path that was
tried. The same works for each side of a `--diff` and for a template passed to the
[MCP server](/guides/mcp/) by `path`. `--watch` re-renders when the template changes but
doesn't yet notice edits to the `DefinitionUri` file, so save the template too, or watch
the ASL file directly.

Some cases still can't be read and stop with `… cannot be read from the template alone`:

- an `s3://` URI or an S3 location object, since the file is in S3. Download it and render
  it directly.
- a template piped in on stdin, or sent to [`sfn-diagram serve`](/guides/serve/) or to MCP as
  `source`, since there's no directory to read the file from. Pass the template as a file.

A `DefinitionUri` that starts with `//` or `\\` (a network or device path) is refused too,
because reading it would make the machine contact that host. Errors about the file
never quote its contents, so for a syntax error, render the file itself to see the
parser's message.

To render every definition in the folder in one run, a glob over the ASL files works as
well:

```bash
npx sfn-diagram 'statemachine/*.asl.json' --out-dir diagrams
```

In your own code, pass a `readFile` callback to
[`extractAslFromTemplate`](/reference/cfn/functions/extractaslfromtemplate/). Without one, a
`DefinitionUri` is reported rather than read, which is what browsers and edge runtimes get:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractAslFromTemplate } from 'sfn-diagram/cfn';

const templatePath = 'template.yaml';
const { aslDefinition } = extractAslFromTemplate({
  readFile: ({ path }) => readFileSync(join(dirname(templatePath), path), 'utf-8'),
  template: readFileSync(templatePath, 'utf-8'),
});
```

## Plain CloudFormation

An `AWS::StepFunctions::StateMachine` resource in a hand-written template works the same
way. JSON templates are detected automatically; YAML ones need `--resolve-cfn`. The
definition can be in `DefinitionString` or `Definition`. A definition stored in S3 through
`DefinitionS3Location` can't be read from the template, so download the file and render it
directly. A CDK asset in `cdk.out/` is the exception (see
[A definition in its own file](#a-definition-in-its-own-file-definitionbodyfromfile)).

## See what a change does to the graph

Synthesize before and after a change, then diff the two templates. Both sides go through
the same extraction, so `--resource` picks the machine in each:

```bash
# Before the change: synthesize and keep a copy as the baseline
npx cdk synth --quiet
rm -rf base.out && cp -r cdk.out base.out
# ...edit the stack, then synthesize again...
npx cdk synth --quiet
npx sfn-diagram cdk.out/OrdersStack.template.json --diff base.out/OrdersStack.template.json \
  --resource OrderWorkflow --format mermaid -o orders-diff.mmd
```

The diagram colors added states green, modified states yellow and removed states red. A
summary goes to stderr:

```text
Diff summary:
  Added:     Wait for settlement
  Modified:  Charge card
  Unchanged: 4
```

The baseline can also be what's deployed now. Pass a state machine ARN to `--diff`, and the
template is compared with the live definition (see
[What it combines with](/guides/cli/#what-it-combines-with)).

For pull requests, the [GitHub Action](/ecosystem/github-action/) comments a diagram and
diff for changed ASL files (`*.asl.json` and `*.asl` by default, set by its `asl-glob`
input). It reads ASL files, not templates, so it fits SAM
projects that use `DefinitionUri`. For a CDK app or a template with an inline definition,
[Preview Step Functions diagram changes on pull requests](/guides/preview-step-functions-diagram-changes-on-pull-requests/)
has a tested workflow that synthesizes both sides and comments the diff.

## Lint before you deploy

`--check` runs the same template extraction and then lints the definition:

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json --resource OrderWorkflow --check
```

To lint every state machine in the app at once, pass the `cdk.out` directory:

```bash
npx sfn-diagram cdk.out --check
```

Findings come in two severities. Errors are mistakes Step Functions would reject, such as a
Wait state with no duration, a Choice with no rules, or a state with both `End` and `Next`.
Any error makes `--check` exit 1, so it fails a CI job. Warnings point at likely bugs, such
as a Choice with no `Default` or a state nothing can reach. They're printed, but on their
own they still exit 0. See [Linting](/guides/cli/#linting) for the full rule list.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `ASL definition is not valid JSON` | A YAML template without `--resolve-cfn`, or a `cdk synth` printout saved to a file | Add `--resolve-cfn`, or read the file in `cdk.out/` |
| `Template has multiple state machines: …` | More than one state machine in the template | Pass a listed logical ID or construct path with `--resource` |
| `Resource '…' is not a state machine` | The `--resource` value matches no state machine's logical ID or construct path | Pick one from the `Found:` list, which shows each construct path next to its logical ID |
| `Resource '…' matches more than one state machine` | The value, often the end of a path, fits several state machines | Pass a longer path, such as `Orders/Workflow`, or the logical ID |
| `ASL definition missing required field: StartAt` on a `cdk.out/` file | That template has no state machine, so it wasn't detected as one. Often the machine is in a nested stack | Render `cdk.out` itself, which finds nested stacks, or point at the machine's own `*.nested.template.json` |
| `… is a directory but not a CDK cloud assembly` | The directory has no `manifest.json` with an `artifacts` object | Pass `cdk.out` itself after `cdk synth`, a file, or a quoted glob |
| `No state machine in cloud assembly … matches --resource '…'` | The `--resource` value names no machine in any stack | Pick one from the `Found:` list of construct paths |
| `--resource '…' matches N state machines in the cloud assembly` | Several machines are left and there's no `--out-dir` | Pass `--out-dir`, or one of the listed names as `--resource` |
| `Template contains no AWS::StepFunctions::StateMachine or AWS::Serverless::StateMachine resource` | The same mistake with `--resolve-cfn` | Same fix |
| `… loads its definition from DefinitionUri (…), which could not be read: … does not exist` | The `DefinitionUri` path, taken relative to the template, points at no file | Fix the path in the template, or move the template back beside its `statemachine/` folder |
| `DefinitionUri file '…' … is not valid JSON` (or YAML) | The definition file has a syntax error. The message never quotes the file | Render the file directly to see the parser's message |
| `… loads its definition from DefinitionUri …, which cannot be read from the template alone` | The definition is in S3, or the template came from stdin, `serve` or MCP `source` | Download and render the file directly, or pass the template as a file |
| `… DefinitionS3Location, which cannot be read from the template alone. The CDK asset manifest …` or `… Its CDK asset '…' could not be read: …` | The template was copied away from `cdk.out/`, or `cdk.out/` is stale | Render the template inside a fresh `cdk synth` output, or render the ASL file directly |
| `CDK asset '…' … is not valid JSON` (or YAML, or not an ASL definition) | The staged definition file has a syntax error. The message never quotes the file | Render the source ASL file to see the parser's message |
