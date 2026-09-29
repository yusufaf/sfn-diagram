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

echo "== the font the PNG engine probes for is present"
# Assigned in its own `if`, not inline: under `set -e` an inline assignment from a
# failing command aborts before the guard below can turn it into an annotation, so
# a missing `node` would fail the step with nothing but bash's own message.
if ! font_path="$(node "$repo_root/scripts/font-probes.mjs" --platform linux | head -n 1)"; then
    fail "could not run scripts/font-probes.mjs to find the path pngFonts.ts probes first"
fi
[ -n "$font_path" ] || fail "scripts/font-probes.mjs printed no font path for linux"
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
