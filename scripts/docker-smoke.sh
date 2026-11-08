#!/usr/bin/env bash
#
# Smoke-test a sfn-diagram container image: that it runs, renders an SVG from
# stdin, lets the PNG engine find a probed font without scanning, ships no package
# manager, and produces real PNG bytes. Optionally that it reports an expected
# --version.
#
# One copy of this used to live in .github/workflows/docker.yml (against the pushed
# ghcr.io image) and another in .github/workflows/unit-test.yml (against the image
# built on the PR), which is #230: a change to either had to be made twice or the
# two silently diverged. Being a script rather than a composite action, it also runs
# on a developer machine against any image ref:
#
#   docker build -t sfn-diagram-local .
#   scripts/docker-smoke.sh --image sfn-diagram-local --png-out /tmp/diagram.png
#
# Set DOCKER to run a different container CLI, e.g. DOCKER=podman.
#
# The font check asks the engine itself, with the system-font scan off, so it
# follows pngFonts.ts's probe table without restating a path from it.
#
# Usage:
#   scripts/docker-smoke.sh --image <ref> --png-out <path> [--expect-version <version>]

set -euo pipefail

image=""
png_out=""
expect_version=""

usage() {
    echo "usage: docker-smoke.sh --image <ref> --png-out <path> [--expect-version <version>]" >&2
    [ $# -eq 0 ] || echo "docker-smoke.sh: $1" >&2
    exit 2
}

while [ $# -gt 0 ]; do
    # `${2:?...}` would abort with a raw bash expansion error and exit 1 here, which
    # is the wrong code for a usage mistake - a missing value gets the same exit 2
    # as an unknown flag.
    case "$1" in
        --image)
            [ $# -ge 2 ] || usage "--image needs a value"
            image="$2"
            shift 2
            ;;
        --png-out)
            [ $# -ge 2 ] || usage "--png-out needs a value"
            png_out="$2"
            shift 2
            ;;
        --expect-version)
            [ $# -ge 2 ] || usage "--expect-version needs a value"
            expect_version="$2"
            shift 2
            ;;
        *)
            usage "unknown argument '$1'"
            ;;
    esac
done

if [ -z "$image" ] || [ -z "$png_out" ]; then
    usage "--image and --png-out are both required"
fi

docker="${DOCKER:-docker}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$repo_root/tests/fixtures/simple.asl.json"

# The 8-byte PNG signature, and a floor that a header-only or empty file cannot
# clear. Both were duplicated across the two workflows alongside everything else.
png_signature='89504e470d0a1a0a'
png_min_bytes=1000

fail() {
    echo "::error::$1"
    exit 1
}

# Always run it, even with nothing to compare against: `--version` reads the
# version out of the image, so it fails if the entrypoint cannot start or the
# runtime stage is missing package.json - breakage that renders fine and would
# otherwise only surface after publishing. Only the comparison is optional.
echo "== version"
if ! actual_version="$("$docker" run --rm "$image" --version)"; then
    fail "image could not report its version - the entrypoint did not run"
fi
if [ -n "$expect_version" ] && [ "$actual_version" != "$expect_version" ]; then
    fail "image reports version '$actual_version', expected '$expect_version'"
fi

echo "== svg from stdin"
"$docker" run --rm -i "$image" - --format svg < "$fixture" | grep -q '<svg' ||
    fail "image did not render a valid SVG from stdin"

# #555: with the system-font scan forced off, the PNG engine renders only from a font
# file in pngFonts.ts's probe table, and throws if the image holds none of them. With
# the scan on, a probe miss still exits 0 - in whatever face resvg falls back to
# (monospace, on Alpine before its Liberation path was probed), which the byte checks
# below cannot see. Asking the engine rather than testing a path from the table needs
# no shell in the image and cannot drift from the table (#230).
echo "== the PNG engine finds a probed font without scanning"
"$docker" run --rm -i -e SFN_DIAGRAM_PNG_LOAD_SYSTEM_FONTS=false "$image" - --format png \
    -o /dev/stdout < "$fixture" > /dev/null ||
    fail "the PNG engine found no probed font in the image - labels would render in a fallback face, or not at all"

# #554: node:24-slim bundles npm, corepack and yarn. The runtime never runs them,
# and npm's own node_modules carried every node-pkg finding the image scans reported.
echo "== no package manager ships in the image"
if ! leftovers="$("$docker" run --rm --entrypoint sh "$image" -c \
    'for tool in npm npx corepack yarn yarnpkg; do command -v "$tool"; done
     ls -d /usr/local/lib/node_modules/* /opt/yarn-* 2>/dev/null; true')"; then
    fail "could not list package managers in the image"
fi
[ -z "$leftovers" ] ||
    fail "image still ships a package manager: $(printf '%s' "$leftovers" | tr '\n' ' ')"

# #153: the image advertised --format png for three releases while the PNG engine
# was absent from node_modules. Assert real PNG bytes, not just an exit code.
echo "== png bytes"
mkdir -p "$(dirname "$png_out")"
"$docker" run --rm -i "$image" - --format png -o /dev/stdout < "$fixture" > "$png_out"
head -c 8 "$png_out" | od -An -tx1 | tr -d ' \n' | grep -qx "$png_signature" ||
    fail "image did not render a valid PNG (bad signature)"
[ "$(wc -c < "$png_out")" -gt "$png_min_bytes" ] ||
    fail "PNG from the image is implausibly small (under $png_min_bytes bytes)"

echo "docker-smoke: ok ($image)"
