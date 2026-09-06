#!/usr/bin/env bash
#
# Smoke-test a standalone CLI binary produced by scripts/build-binaries.mjs.
#
# Checks that the binary reports the package.json version, renders the same
# SVG byte-for-byte as `node dist/cli.js`, reads ASL from stdin, and refuses
# `--format png` with the standalone pointer instead of a missing-module error.
# When docker is available it also runs the binary inside a bare Debian image
# to prove it needs no Node.js on the host (Linux binaries only).
#
# Runs on every PR (unit-test.yml, linux-x64 only) and against the uploaded
# release assets (release-please.yml). Needs a built dist/ in the repo.
#
# Usage:
#   scripts/smoke-test-binary.sh binaries/sfn-diagram-linux-x64

set -euo pipefail

binary="${1:?usage: smoke-test-binary.sh <path-to-binary>}"
if [ ! -x "$binary" ]; then
    chmod +x "$binary"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$repo_root/tests/fixtures/simple.asl.json"
cfn_fixture="$repo_root/tests/fixtures/cfn/cdk-synth.json"
expected_version="$(cd "$repo_root" && node -p "require('./package.json').version")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
    echo "::error::$1"
    exit 1
}

echo "== version"
actual_version="$("$binary" --version)"
[ "$actual_version" = "$expected_version" ] ||
    fail "binary reports version '$actual_version', package.json says '$expected_version'"

echo "== svg parity with node dist/cli.js"
"$binary" "$fixture" --format svg > "$tmp/binary.svg"
node "$repo_root/dist/cli.js" "$fixture" --format svg > "$tmp/node.svg"
cmp "$tmp/binary.svg" "$tmp/node.svg" ||
    fail "binary SVG differs from node dist/cli.js SVG"

echo "== mermaid from stdin"
"$binary" - --format mermaid < "$fixture" | grep -q 'stateDiagram-v2' ||
    fail "binary did not render Mermaid from stdin"

echo "== cloudformation template input"
"$binary" "$cfn_fixture" --format svg | grep -q '<svg' ||
    fail "binary did not render an SVG from a CloudFormation template"

echo "== --format png is refused with a pointer"
set +e
png_stderr="$("$binary" "$fixture" --format png -o "$tmp/out.png" 2>&1 >/dev/null)"
png_status=$?
set -e
[ "$png_status" -eq 1 ] || fail "expected exit 1 for --format png, got $png_status"
echo "$png_stderr" | grep -q 'not available in the standalone binary' ||
    fail "unexpected --format png stderr: $png_stderr"

case "$(basename "$binary")" in
    *linux*)
        if command -v docker >/dev/null 2>&1; then
            echo "== runs without node (docker debian:bookworm-slim)"
            docker run --rm \
                -v "$(cd "$(dirname "$binary")" && pwd):/b:ro" \
                -v "$repo_root/tests/fixtures:/f:ro" \
                debian:bookworm-slim \
                "/b/$(basename "$binary")" /f/simple.asl.json --format svg \
                | cmp - "$tmp/node.svg" ||
                fail "binary output inside a Node-less container differs from node dist/cli.js"
        else
            echo "== docker not available, skipping the Node-less container check"
        fi
        ;;
esac

echo "smoke-test-binary: ok ($binary)"
