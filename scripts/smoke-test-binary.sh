#!/usr/bin/env bash
#
# Smoke-test a standalone CLI binary produced by scripts/build-binaries.mjs.
#
# Checks that the binary reports the package.json version, renders the same
# SVG byte-for-byte as `node dist/bin.js`, reads ASL from stdin, and refuses
# `--format png` with the standalone pointer instead of a missing-module error.
# When docker is available it also runs the binary inside a bare Debian image
# to prove it needs no Node.js on the host (Linux binaries only, and only when
# the host CPU matches the binary - an arm64 binary cannot run in an x64
# container without emulation).
#
# Runs on every PR (unit-test.yml) for the linux-x64, linux-arm64, and
# windows-x64 binaries built on their native runners, and against the uploaded
# release assets (release-please.yml). macOS binaries are covered by the
# macOS build job, which has to re-sign them first. Needs a built dist/ in
# the repo. Portable across Linux, macOS, and Git Bash on Windows, so keep
# it to POSIX tools that Git for Windows ships (mktemp, cmp, grep).
#
# Usage:
#   scripts/smoke-test-binary.sh binaries/sfn-diagram-linux-x64
#   bash scripts/smoke-test-binary.sh binaries/sfn-diagram-windows-x64.exe

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

echo "== svg parity with node dist/bin.js"
"$binary" "$fixture" --format svg > "$tmp/binary.svg"
node "$repo_root/dist/bin.js" "$fixture" --format svg > "$tmp/node.svg"
cmp "$tmp/binary.svg" "$tmp/node.svg" ||
    fail "binary SVG differs from node dist/bin.js SVG"

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

# Map the binary's architecture suffix and the host CPU onto the same names so
# the container check only runs when the binary can execute natively here.
binary_arch=""
case "$(basename "$binary")" in
    *-x64*) binary_arch="x64" ;;
    *-arm64*) binary_arch="arm64" ;;
esac
host_arch=""
case "$(uname -m)" in
    x86_64 | amd64) host_arch="x64" ;;
    aarch64 | arm64) host_arch="arm64" ;;
esac

case "$(basename "$binary")" in
    *linux*)
        if [ "$binary_arch" != "$host_arch" ]; then
            echo "== host is $(uname -m), skipping the Node-less container check for a $binary_arch binary"
        elif command -v docker >/dev/null 2>&1; then
            echo "== runs without node (docker debian:bookworm-slim)"
            docker run --rm \
                -v "$(cd "$(dirname "$binary")" && pwd):/b:ro" \
                -v "$repo_root/tests/fixtures:/f:ro" \
                debian:bookworm-slim \
                "/b/$(basename "$binary")" /f/simple.asl.json --format svg \
                | cmp - "$tmp/node.svg" ||
                fail "binary output inside a Node-less container differs from node dist/bin.js"
        else
            echo "== docker not available, skipping the Node-less container check"
        fi
        ;;
esac

echo "smoke-test-binary: ok ($binary)"
