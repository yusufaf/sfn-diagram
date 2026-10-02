# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting instead: go to the
[Security tab](https://github.com/yusufaf/sfn-diagram/security/advisories/new) and
open a draft advisory. That keeps the report private until a fix is released, and
gives us a place to discuss it and request a CVE.

Useful things to include, if you have them: the affected package and version, a
minimal ASL definition or command that reproduces it, and what an attacker gains.

`sfn-diagram` is maintained by one person in their spare time, so no response-time
guarantee is offered. Reports are read and taken seriously, but if something is
urgent for you, say so in the report rather than assuming a schedule.

## Supported versions

Fixes land in the latest minor release of each published package. There are no
long-term support branches and no backports to earlier minors, so upgrading to the
current version is the supported path to a fix.

| Package | Supported |
| --- | --- |
| `sfn-diagram` | latest minor |
| `sfn-diagram-react` | latest minor |
| `vscode-sfn-diagram` | latest minor |
| `sfn-diagram-action` | latest minor |

## Scope

What is in scope: anything in this repository and the artifacts it publishes — the
npm and JSR packages, the Docker image, the standalone binaries, the Homebrew
formula, the VS Code extension, and the GitHub Action.

Worth knowing before reporting:

- **A malicious ASL definition is untrusted input.** `sfn-diagram` parses
  definitions and renders them to SVG, HTML, and Mermaid. Anything in a definition
  that escapes its escaping — into the generated HTML/SVG, or into Mermaid output
  rendered elsewhere — is a vulnerability, and that is the most interesting place
  to look.
- **`sfn-diagram --from-aws`, `--diff <arn>`, and `--execution <arn>` read from
  AWS** using the caller's own credentials via the AWS SDK's standard chain. The
  tool never stores or transmits them anywhere else.
- **The CLI does not execute a state machine**, fetch arbitrary URLs, or run code
  out of a definition.

What is out of scope: vulnerabilities in a dependency with no exploitable path
through this project's own code — report those upstream. Dependabot and a weekly
`pnpm audit` sweep already track advisories in the lockfile.

## What this project already does

- npm (`sfn-diagram`, `sfn-diagram-react`) publishes with
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements) over
  OIDC; JSR publishes tokenlessly over OIDC.
- The Docker image ships SLSA provenance (`mode=max`) and an SBOM.
- The standalone binaries carry
  [build provenance attestations](https://docs.github.com/actions/security-guides/using-artifact-attestations),
  verifiable with `gh attestation verify <binary> --repo yusufaf/sfn-diagram`.
- CodeQL (`security-extended`) scans the TypeScript sources and the workflow files
  on every PR, every push to `main`, and weekly.
- `actions/dependency-review-action` blocks a PR that introduces a dependency with
  a high-severity advisory.
