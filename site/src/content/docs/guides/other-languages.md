---
title: Use from Python, Go, Java, and other languages
description: "How to run sfn-diagram outside the JavaScript ecosystem: the CLI as a language boundary, standalone binaries, Homebrew, Docker, and subprocess snippets."
---

sfn-diagram is written in TypeScript, but generating a diagram is a build-time or
CI-time task, not something your application does at runtime. That makes the
**CLI** the natural boundary: any language that can spawn a process can render a
diagram, and you never need to write JavaScript.

## If you use the AWS CDK, you already have Node

The CDK ships in Python, Java, C#, and Go through [jsii](https://aws.github.io/jsii/),
and every one of those bindings requires Node.js at synth time. So in a CDK project
of any language, this already works:

```bash
npx sfn-diagram cdk.out/MyStack.template.json --resource MyStateMachine -o diagram.svg
```

See [the CLI guide](/guides/cli/) for the full option list, including CloudFormation
and SAM template input.

## No Node? Install a standalone binary

Each release attaches self-contained executables for Linux (x64, arm64), macOS (Apple
silicon, Intel), and Windows (x64), plus a `SHA256SUMS` file. They bundle the CLI and
its runtime in one file, so nothing else needs to be installed.

**Homebrew** (macOS and Linux):

```bash
brew install yusufaf/tap/sfn-diagram
```

**Direct download** (substitute your platform; see the
[releases page](https://github.com/yusufaf/sfn-diagram/releases) for the full list):

```bash
curl -fsSL -o sfn-diagram \
  https://github.com/yusufaf/sfn-diagram/releases/latest/download/sfn-diagram-linux-x64
chmod +x sfn-diagram
./sfn-diagram --version
```

On Windows, download `sfn-diagram-windows-x64.exe`.

The binaries render **SVG, Mermaid, and HTML**. `--format png` needs a headless
browser and is not available in the standalone build; use the
[Docker image](/guides/cli/#docker), which bundles Chromium, or the npm package with
`node-html-to-image` installed.

## Docker

The [Docker image](/guides/cli/#docker) is the other zero-install option, and the only
one that supports PNG. It reads from a mounted directory or from stdin:

```bash
docker run --rm -i ghcr.io/yusufaf/sfn-diagram:latest - --format svg \
  < state.asl.json > diagram.svg
```

## Calling the CLI from your language

Pass `-` as the input to read the definition from stdin; the diagram is written to
stdout. Every option from the CLI guide applies.

### Python

```python
import json
import subprocess

def render_svg(definition: dict, layout: str = "TB") -> str:
    result = subprocess.run(
        ["sfn-diagram", "-", "--format", "svg", "--layout", layout],
        input=json.dumps(definition),
        capture_output=True,
        check=True,
        text=True,
    )
    return result.stdout
```

Swap `"sfn-diagram"` for `["npx", "sfn-diagram"]` in a CDK project, or for
`["docker", "run", "--rm", "-i", "ghcr.io/yusufaf/sfn-diagram:latest"]` if you prefer
the image.

### Go

```go
package sfndiagram

import (
	"bytes"
	"fmt"
	"os/exec"
)

func RenderSVG(definition []byte) ([]byte, error) {
	cmd := exec.Command("sfn-diagram", "-", "--format", "svg")
	cmd.Stdin = bytes.NewReader(definition)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("sfn-diagram: %w: %s", err, stderr.String())
	}
	return out, nil
}
```

### Java

```java
Process process = new ProcessBuilder("sfn-diagram", "-", "--format", "svg")
    .redirectError(ProcessBuilder.Redirect.INHERIT)
    .start();
try (var stdin = process.getOutputStream()) {
    stdin.write(definitionJson.getBytes(StandardCharsets.UTF_8));
}
String svg = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
if (process.waitFor() != 0) {
    throw new IllegalStateException("sfn-diagram failed");
}
```

## Pull requests and CI

For diagrams on pull requests you do not need any of the above: the
[GitHub Action](/ecosystem/github-action/) and the
[GitLab CI integration](/ecosystem/gitlab/) run the CLI for you, regardless of the
language the rest of the repository is written in.

## Why not a native port?

We looked at shipping native Python, Go, and Rust libraries and decided against it
for now. The renderer depends on the exact node ranking and ordering of the
[dagre](https://github.com/dagrejs/dagre) layout engine, and a port that does not
reproduce it bit-for-bit produces different diagrams from the same definition. Each
port would also be a separate product to keep in sync. If you need an in-process
library outside Node, open an issue describing the use case; the leading candidate
is a WebAssembly build of the existing core rather than a rewrite.
