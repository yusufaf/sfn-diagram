#!/usr/bin/env bash
#
# Smoke-test a sfn-diagram container image: that it runs, renders an SVG from
# stdin, ships the font the PNG engine actually probes for, and produces real PNG
# bytes. Optionally that it reports an expected --version.
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
# The font path is not written down here. It comes from scripts/font-probes.mjs,
# which reads src/exporters/pngFonts.ts, because resvg renders no text at all
# without a real font file and a check against a path nothing probes any more is
# worse than no check. tests/ci/fontProbes.test.ts pins that reader to the table.
#
# Usage:
#   scripts/docker-smoke.sh --image <ref> --png-out <path> [--expect-version <version>]

set -euo pipefail

image=""
png_out=""
expect_version=""

while [ $# -gt 0 ]; do
    case "$1" in
        --image)
            image="${2:?--image needs a value}"
            shift 2
            ;;
        --png-out)
            png_out="${2:?--png-out needs a value}"
            shift 2
            ;;
        --expect-version)
            expect_version="${2:?--expect-version needs a value}"
            shift 2
            ;;
        *)
            echo "usage: docker-smoke.sh --image <ref> --png-out <path> [--expect-version <version>]" >&2
            exit 2
            ;;
    esac
done

if [ -z "$image" ] || [ -z "$png_out" ]; then
    echo "usage: docker-smoke.sh --image <ref> --png-out <path> [--expect-version <version>]" >&2
    exit 2
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

if [ -n "$expect_version" ]; then
    echo "== version"
    actual_version="$("$docker" run --rm "$image" --version)"
    [ "$actual_version" = "$expect_version" ] ||
        fail "image reports version '$actual_version', expected '$expect_version'"
fi

echo "== svg from stdin"
"$docker" run --rm -i "$image" - --format svg < "$fixture" | grep -q '<svg' ||
    fail "image did not render a valid SVG from stdin"

echo "== the font the PNG engine probes for is present"
font_path="$(node "$repo_root/scripts/font-probes.mjs" --platform linux | head -n 1)"
[ -n "$font_path" ] || fail "could not determine the font path pngFonts.ts probes first"
"$docker" run --rm --entrypoint sh "$image" -c "test -f '$font_path'" ||
    fail "image is missing $font_path - resvg would render text-free diagrams"

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
