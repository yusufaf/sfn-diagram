---
title: Render diagrams over HTTP (sfn-diagram serve)
description: Run sfn-diagram as a small HTTP server so services in any language can render and lint Step Functions definitions with one POST.
sidebar:
  label: HTTP server
---

`sfn-diagram serve` starts an HTTP server that renders and lints state machine definitions. A long-running service in Python, Go, Java or anything else can then draw diagrams with one `POST`, instead of starting a CLI process per diagram. It uses the same renderer, options and config file as the [command line](/guides/cli/), and accepts the same inputs: ASL JSON, CloudFormation/SAM/CDK templates, or Terraform.

It is new in 2.1.0 and needs no extra dependencies.

## Start it

```bash
npx sfn-diagram serve                    # http://127.0.0.1:8080
npx sfn-diagram serve --port 9000
sfn-diagram serve --port 0               # pick a free port; the address is printed on stderr
```

The [standalone binary](/installation/#cli-without-node) works the same way, without Node.js.

With [Docker](/guides/cli/#docker), bind all interfaces inside the container and publish the port:

```bash
docker run --rm -p 127.0.0.1:8080:8080 ghcr.io/yusufaf/sfn-diagram:latest serve --host 0.0.0.0
```

The server prints `sfn-diagram serve: listening on http://…` to stderr once it is ready, and stops cleanly on `SIGINT` or `SIGTERM`. It gives in-flight requests up to five seconds to finish.

| Option | Default | |
| --- | --- | --- |
| `--port <n>` | `8080` | `0` picks a free port |
| `--host <addr>` | `127.0.0.1` | Use `0.0.0.0` in a container |
| `--config <path>` | searched upward from the working directory | The [configuration file](/guides/cli/#configuration-file), applied under every request |

### Health checks

`GET /healthz` returns `200` with `{"status":"ok","version":"2.1.0"}`. For Docker Compose:

```yaml
services:
  sfn-diagram:
    image: ghcr.io/yusufaf/sfn-diagram:latest
    command: ["serve", "--host", "0.0.0.0"]
    ports: ["127.0.0.1:8080:8080"]
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
      interval: 30s
```

The image is Alpine-based, so busybox `wget` is there for the check; it has no `curl`. In Kubernetes, use an HTTP probe:

```yaml
readinessProbe:
  httpGet: { path: /healthz, port: 8080 }
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
```

## Endpoints

| Request | Body | Response |
| --- | --- | --- |
| `POST /render?<options>` | The definition | The diagram |
| `POST /lint?<options>` | The definition | Lint findings as JSON |
| `GET /healthz` (or `HEAD`) | | `{"status":"ok","version":"…"}` |

### `POST /render`

The body is the raw definition: an ASL JSON document, a CloudFormation/SAM/CDK template, or a Terraform configuration (HCL or JSON). JSON templates and Terraform are detected from the content. A YAML template needs `resolve-cfn`, as on the command line. A leading byte order mark is ignored. The response is the diagram with a matching `Content-Type`:

| `format` | `Content-Type` |
| --- | --- |
| `svg` (default) | `image/svg+xml; charset=utf-8` |
| `mermaid` | `text/plain; charset=utf-8` |
| `html` | `text/html; charset=utf-8` |
| `png` | `image/png` |

Text output ends with a newline, so it matches the CLI's stdout byte for byte.

When reading a template produced warnings (an intrinsic function it could not resolve, for example), the response still succeeds and carries two headers:

- `Sfn-Diagram-Warning-Count`: the number of warnings.
- `Sfn-Diagram-Warnings`: the distinct warnings as a JSON array, with every non-ASCII character escaped. It is capped at 2048 characters. When some are left out, the last entry says how many. `POST /lint` returns every warning in its body.

### `POST /lint`

Returns `200` with the same entry `--check --check-format json` writes for a file, without the `file` field:

```json
{
  "diagnostics": [
    {
      "code": "dangling-transition",
      "message": "State \"A\": Next references non-existent state \"Missing\"",
      "path": "/States/A/Next",
      "severity": "error"
    }
  ],
  "kind": "lint",
  "warnings": []
}
```

A finding, even an error-severity one, is still a `200`: the request succeeded, and the findings are its result. Only `resolve-cfn` and `resource` are accepted as options.

### Errors

Every error is JSON, `{"kind":"error","message":"…","warnings":[…]}`:

| Status | When |
| --- | --- |
| `400` | An unknown or invalid option, a switch given a value other than `true`, or a format-only option with another format |
| `404` | An unknown path |
| `405` | A wrong method; the `Allow` header lists the right one |
| `413` | A body over 2 MiB |
| `422` | The definition could not be read or rendered, or a PNG would be over 40 million pixels |
| `501` | `format=png` in the standalone binary |
| `500` | An unexpected error; the details go to the server's stderr |

## Options

Query parameters are the [CLI's flags](/guides/cli/) without the leading `--`:

```text
/render?format=mermaid&layout=LR&theme=dark&hide-catch&collapse=ProcessItems
```

- A flag that takes a value is written `name=value`. Error messages use the CLI's spelling, for example `Invalid --layout: XX`.
- A switch is written bare (`hide-catch`) or as `hide-catch=true`. Any other value is a `400`.
- `redact-fields` can repeat, and the values add up. For any other option the last one wins.
- `collapse` and `collapse=` both mean "collapse every container". A query string cannot tell an empty value from no value.
- `theme` takes `light`, `dark` or `auto`. A custom theme comes from the server's config file.

Some CLI flags are refused, because they would let a client touch the server's files or credentials, or change how the process runs: `output`, `out-dir`, `config`, `diff`, `execution`, `from-aws`, `follow`, `follow-timeout`, `poll-interval`, `watch`, `check`, `check-format`, `preserve-tree`, `load-system-fonts`, `no-load-system-fonts`, `help` and `version`. Diff and execution overlays need a second input and are not available over HTTP yet.

## PNG

`format=png` works in the Docker image, and from the npm package when `@resvg/resvg-js` is installed next to it:

```bash
npx --package sfn-diagram --package @resvg/resvg-js sfn-diagram serve
```

Without `@resvg/resvg-js`, a PNG request gets a `422` that names the package. The standalone binary cannot rasterize, so it answers `501`.

A PNG over 40 million pixels (width × height × `scale`²) is refused with a `422` before rendering. Lower `scale`, `padding` or the node sizes, or ask for `svg`.

## Security

- **It binds to `127.0.0.1` by default.** Only use `--host 0.0.0.0` on a trusted network, or behind a reverse proxy that does the access control. The server has no authentication, TLS or CORS handling.
- **Requests cannot reach the server's files or AWS credentials.** The flags that would are refused (see [Options](#options)).
- **Each request is bounded:** the body is capped at 2 MiB, and PNG output at 40 million pixels.
- **The only outbound requests are for AWS service icons**, with `show-icons` and `format=html` or `png`. The server fetches them from `cdn.jsdelivr.net`, with a five-second timeout each. Nothing in a request can choose what is fetched. Without network access, an icon stays a link in HTML (the browser loads it) and is left out of a PNG.

## Examples

### curl

```bash
curl --data-binary @state.asl.json 'http://127.0.0.1:8080/render?format=svg' -o diagram.svg
curl --data-binary @template.yaml 'http://127.0.0.1:8080/render?format=png&resolve-cfn' -o diagram.png
curl --data-binary @state.asl.json 'http://127.0.0.1:8080/lint'
```

`--data-binary` sends the file unchanged. Plain `-d` strips newlines, which breaks YAML templates.

### Python (requests)

```python
import requests

with open("state.asl.json", "rb") as f:
    response = requests.post(
        "http://127.0.0.1:8080/render",
        params={"format": "svg", "layout": "LR"},
        data=f,
        timeout=30,
    )
if not response.ok:
    raise RuntimeError(response.json()["message"])
with open("diagram.svg", "wb") as out:
    out.write(response.content)
```

### Go (net/http)

```go
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	definition, err := os.Open("state.asl.json")
	if err != nil {
		panic(err)
	}
	defer definition.Close()

	response, err := http.Post(
		"http://127.0.0.1:8080/render?format=mermaid",
		"application/json",
		definition,
	)
	if err != nil {
		panic(err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		panic(err)
	}
	if response.StatusCode != http.StatusOK {
		panic(fmt.Sprintf("sfn-diagram: %d %s", response.StatusCode, body))
	}
	fmt.Print(string(body))
}
```

The request's `Content-Type` is ignored, so send whatever your client defaults to.
