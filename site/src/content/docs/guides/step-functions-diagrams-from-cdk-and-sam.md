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

:::note[Which version you need]
CDK templates and plain CloudFormation work with sfn-diagram 1.8.0, the current npm release.
Three things need 1.9.0 or later, which hadn't been released as of October 2026:
- reading SAM `AWS::Serverless::StateMachine` resources;
- filling in `DefinitionSubstitutions`;
- six of the lint rules.

Each section below says where this applies. Run `npx sfn-diagram --version` to check yours.
:::

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
and ends in a hash, for example `ProdOrdersStack2EDBF9CE.template.json`.

### 2. Render

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json -o orders.svg
```

JSON templates are detected automatically, so no extra flag is needed. If the stack has
exactly one state machine, that's all you need.

### 3. Pick a state machine when there are several

With two or more state machines, the CLI stops and lists their logical IDs:

```text
Error: Template has multiple state machines (OrderWorkflow0015CDD9, RefundWorkflow9F22E5E9). Pass resourceId (or --resource) to choose one.
```

For a `StateMachine` construct, CDK appends a hash to the logical ID, so the construct ID you
wrote (`OrderWorkflow`) isn't the ID in the template. `--resource` needs the exact ID, so copy it from the error:

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json --resource OrderWorkflow0015CDD9 -o orders.svg
```

The hash comes from the construct's path in your app, not from its contents. It stays the
same from one synth to the next unless you rename or move the construct, so it's safe to
put in a script.

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
| `Fn::Sub` | The text with its variables filled in from its own map, or from `DefinitionSubstitutions` (1.9.0 or later). Any other `${…}` reference stays as written |
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
  resourceId: 'OrderWorkflow0015CDD9',
  template: Template.fromStack(stack).toJSON(),
});
writeFileSync('orders.svg', generateSvg({ aslDefinition }).svg);
```

Leave out `resourceId` when the stack has a single state machine. CDK apps in Python, Java,
C# and Go use the CLI against `cdk.out/` instead. They already need Node to synthesize, so
`npx` works there too (see [Use from Python, Go, Java, and other languages](/guides/other-languages/)).

## AWS SAM

SAM gives you two ways to define a state machine, and each needs a different command.

Reading a SAM template needs sfn-diagram 1.9.0 or later. Version 1.8.0 doesn't recognize
`AWS::Serverless::StateMachine` and reports
`Template contains no AWS::StepFunctions::StateMachine resource.` instead. Rendering the ASL
file behind a `DefinitionUri` works with any version.

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
```

Here the definition isn't in the template, so sfn-diagram can't read it from there. It
refuses and tells you why:

```text
Error: State machine 'RefundStateMachine' loads its definition from DefinitionUri ('statemachine/refund.asl.json'), which cannot be read from the template alone. Render that ASL file directly (download it first if it is in S3), or inline the definition in the template.
```

Render the ASL file instead:

```bash
npx sfn-diagram statemachine/refund.asl.json -o refund.svg
```

`sam build` doesn't help here, because it keeps `DefinitionUri` as a file path.
`DefinitionSubstitutions` entries aren't applied either, so a `${ChargeFunctionArn}`
placeholder appears as written. To render every definition in the folder in one run, use a
glob:

```bash
npx sfn-diagram 'statemachine/*.asl.json' --out-dir diagrams
```

## Plain CloudFormation

An `AWS::StepFunctions::StateMachine` resource in a hand-written template works the same
way. JSON templates are detected automatically; YAML ones need `--resolve-cfn`. The
definition can be in `DefinitionString` or `Definition`. A definition stored in S3 through
`DefinitionS3Location` gets the same refusal as SAM's `DefinitionUri`, so download the file
and render it directly.

On 1.8.0, two things differ:
- A `DefinitionS3Location` machine fails with
  `State machine '…' has no DefinitionString or Definition.` instead.
- `DefinitionSubstitutions` aren't applied, so `${Name}` placeholders stay as written. That
  includes a CDK `StateMachine` created with `definitionSubstitutions`.

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
  --resource OrderWorkflow0015CDD9 --format mermaid -o orders-diff.mmd
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
projects that use `DefinitionUri`.

## Lint before you deploy

`--check` runs the same template extraction and then lints the definition:

```bash
npx sfn-diagram cdk.out/OrdersStack.template.json --resource OrderWorkflow0015CDD9 --check
```

Findings come in two severities. Errors are mistakes Step Functions would reject, such as a
state with both `End` and `Next`, or a `Retry` on a Pass state. Version 1.9.0 adds more,
including a Wait state with no duration and a Choice with no rules. Any error makes
`--check` exit 1, so it fails a CI job. Warnings point at likely bugs, such
as a Choice with no `Default` or a state nothing can reach. They're printed, but on their
own they still exit 0. See [Linting](/guides/cli/#linting) for the full rule list.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `ASL definition is not valid JSON` | A YAML template without `--resolve-cfn`, or a `cdk synth` printout saved to a file | Add `--resolve-cfn`, or read the file in `cdk.out/` |
| `Template has multiple state machines (…)` | More than one state machine in the template | Pass one of the listed IDs with `--resource` |
| `Resource '…' is not a state machine` (1.8.0: `… is not an AWS::StepFunctions::StateMachine`) | The `--resource` value doesn't match exactly. With a CDK `StateMachine`, this is usually the ID without its hash suffix | Copy an ID from the `Found:` list in the message |
| `ASL definition missing required field: StartAt` on a `cdk.out/` file | That template has no state machine, so it wasn't detected as one. Often the machine is in a nested stack | Point at the template that declares the machine. A CDK nested stack gets its own `*.nested.template.json` file in `cdk.out/` |
| `Template contains no AWS::StepFunctions::StateMachine …` | The same mistake with `--resolve-cfn`. On 1.8.0, also any SAM template | Same fix. For SAM, use 1.9.0 or later |
| `… loads its definition from DefinitionUri …` | The definition is in a separate file | Render that `.asl.json` file directly |
